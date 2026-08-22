import { FIXED_TIMESTEP } from './PhysicsWorld.js';
import { aimShot, normalize, type Shot, type Vec } from './ballistics.js';
import { Simulation } from './Simulation.js';
import { SceneView } from '../render/SceneView.js';
import { Effects, AimGuide } from './Effects.js';
import { HeroController, HERO_HAND } from '../entities/HeroController.js';
import { LevelManager } from '../levels/LevelManager.js';
import { AudioManager } from '../systems/AudioManager.js';
import { VoiceManager } from '../systems/VoiceManager.js';
import { SaveManager } from '../systems/SaveManager.js';
import { InputController, type AimData } from '../systems/InputController.js';
import { UIManager } from '../ui/UIManager.js';
import type { ToolInstance } from '../entities/ToolFactory.js';
import type { RagdollPart } from '../entities/RagdollFactory.js';
import * as THREE from 'three';
import { AIM_ASSIST, DIFFICULTY_SCALE, type HeroConfig, type LevelDef } from '../types.js';

/** Vitesse maximale que le doigt peut imprimer au mannequin, en m/s. */
const GRAB_MAX_SPEED = 11;
/** Raideur de la saisie : plus c'est haut, plus le membre colle au doigt. */
const GRAB_STIFFNESS = 14;

const HINTS: Record<string, string> = {
  drag: 'Glisse vers le mannequin pour lancer',
  tap: 'Touche l\u2019écran pour lâcher',
  hold: 'Maintiens ton doigt appuyé',
  aim: 'Glisse pour viser, relâche pour tirer',
  none: 'Regarde le résultat !',
};

/** Duree du ralenti de victoire, en secondes de temps reel. */
const WIN_SLOWMO = 1;
/** Delai avant remise en place automatique quand le tir a echoue. */
const RETRY_DELAY = 2.4;

export class Game {
  private sim!: Simulation;
  private level!: LevelDef;
  private readonly view: SceneView;
  private readonly hero: HeroController;
  private readonly effects: Effects;
  private readonly aimGuide: AimGuide;
  private readonly input: InputController;
  private readonly ui: UIManager;

  private accumulator = 0;
  private lastTime = 0;
  private timeScale = 1;
  private winTimer = -1;
  private settleTimer = 0;
  private heroResetTimer = -1;
  private running = false;
  private holding = false;
  private grabbed: RagdollPart | null = null;
  private readonly grabTarget = new THREE.Vector3();
  private readonly grabDepth = new THREE.Vector3();

  constructor(
    canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    private readonly levels: LevelManager,
    heroConfig: HeroConfig,
    private readonly save: SaveManager,
    private readonly audio: AudioManager,
    private readonly voice: VoiceManager,
  ) {
    const quality = save.state.settings.quality === 'low' ? 'low' : 'high';
    this.view = new SceneView(canvas, quality);
    this.hero = new HeroController(heroConfig);
    this.view.add(this.hero.group);
    this.effects = new Effects(this.view.root);
    this.aimGuide = new AimGuide(this.view.root);

    this.ui = new UIManager(uiRoot, levels, save, {
      onRestart: () => this.loadLevel(this.level.level),
      onNextLevel: () => this.loadLevel(this.level.level + 1),
      onSelectLevel: (n) => this.loadLevel(n),
      onToggleSound: (on) => { this.audio.setEnabled(on); save.updateSettings({ sound: on }); },
      onToggleVoice: (on) => { this.voice.setEnabled(on); save.updateSettings({ voice: on }); },
      onToggleHaptics: (on) => save.updateSettings({ haptics: on }),
      onSetDifficulty: (difficulty) => {
        save.updateSettings({ difficulty });
        this.loadLevel(this.level.level); // le seuil change : on repart proprement
      },
      onResetProgress: () => { save.reset(); this.loadLevel(1); },
      onTestVoice: () => {
        // Declenche depuis un appui reel : c'est le contexte que Safari iOS
        // accepte le plus surement pour la synthese vocale.
        this.audio.unlock();
        this.voice.unlock();
        this.voice.celebrate();
      },
      voiceLabel: () => this.voice.voiceName,
    }, heroConfig.ui.winTitle);

    this.input = new InputController(canvas.parentElement ?? canvas, {
      onFirstGesture: () => {
        // Contrainte Safari iOS : audio et synthese vocale se debloquent sur un geste.
        this.audio.unlock();
        this.voice.unlock();
        if (this.save.state.settings.sound) this.audio.startAmbient();
      },
      onPickTarget: (x, y) => this.startGrab(x, y),
      onGrabMove: (x, y) => this.moveGrab(x, y),
      onGrabEnd: () => this.endGrab(),
      onAimStart: () => this.hero.setState('aim'),
      onAimUpdate: (aim) => this.onAimUpdate(aim),
      onRelease: (aim) => this.onRelease(aim),
      onHoldStart: () => this.onHoldStart(),
      onHoldEnd: () => this.onHoldEnd(),
      onTap: () => this.onTap(),
    });

    this.audio.setEnabled(save.state.settings.sound);
    this.voice.setEnabled(save.state.settings.voice);

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 220));
    this.resize();
  }

  /* ------------------------------------------------------------- Niveaux */

  loadLevel(levelNumber: number): void {
    const n = this.levels.clamp(levelNumber);
    this.sim?.dispose();

    this.level = this.levels.get(n);
    this.sim = new Simulation(this.level, this.levels.toolDefs, DIFFICULTY_SCALE[this.save.state.settings.difficulty]);
    this.view.build(this.sim);
    this.save.setCurrentLevel(n);

    this.accumulator = 0;
    this.timeScale = 1;
    this.winTimer = -1;
    this.settleTimer = 0;
    this.heroResetTimer = -1;
    this.aimGuide.hide();
    this.effects.reset();
    this.holding = false;
    this.grabbed = null;
    this.hero.setState('idle');
    this.hero.setAim(0);

    this.ui.setLevel(this.level);
    this.ui.setProgress(0, this.sim.threshold);
    this.ui.hideWin();
    this.input.setLocked(false);
    this.syncVerb();
    const verbHint = this.aimAssist < 0.5 && (this.activeVerb === 'drag' || this.activeVerb === 'aim')
      ? 'Vise toi-même : la direction du geste donne l\u2019angle, sa longueur la force'
      : HINTS[this.activeVerb];
    this.ui.showHint(this.level.isTutorial ? `${this.level.label} — ${verbHint}` : verbHint);
    this.placeHeldTool();
  }

  /** Outil courant : le principal tant qu'il est disponible, puis les pieges. */
  private get activeTool(): ToolInstance | undefined {
    return this.sim.tools.find((t) => t.state === 'ready') ?? this.sim.tools.find((t) => t.def.field);
  }

  private get activeVerb(): string {
    return this.activeTool?.verb ?? 'none';
  }

  private syncVerb(): void {
    const tool = this.activeTool;
    this.input.setVerb(tool ? tool.verb : 'none');
  }

  /** L'objet a lancer est pose dans la main de Zayn tant qu'il n'est pas parti. */
  private placeHeldTool(): void {
    const tool = this.activeTool;
    if (!tool?.body || tool.def.category !== 'throw' || tool.state !== 'ready') return;
    tool.body.setTranslation({ x: HERO_HAND.x, y: HERO_HAND.y, z: HERO_HAND.z }, false);
  }

  /* ------------------------------------------------------------- Entrees */

  /** Point de depart d'un projectile : la main de Zayn, ou l'outil lui-meme. */
  private originOf(tool: ToolInstance): Vec {
    if (tool.body) {
      const t = tool.body.translation();
      return { x: t.x, y: t.y, z: t.z };
    }
    if (tool.def.category === 'throw') return { x: HERO_HAND.x, y: HERO_HAND.y, z: HERO_HAND.z };
    const [x, y, z] = tool.placed.position;
    return { x, y, z };
  }

  /**
   * Point vise : le torse du mannequin la ou il se trouve maintenant, et non sa
   * position de depart. Sans cela, apres l'avoir projete a la main ou renverse
   * d'un premier coup, la visee continuait de pointer le sol vide.
   */
  private aimPoint(): Vec {
    const ragdoll = this.sim.ragdolls[0];
    const torso = ragdoll?.parts.get('torso');
    if (torso && !ragdoll.frozen) {
      const t = torso.body.translation();
      return { x: t.x, y: t.y, z: t.z };
    }
    const [x, y, z] = this.level.targets[0].position;
    return { x, y: y + 1.25 * this.level.targets[0].scale, z };
  }

  private speedOf(tool: ToolInstance, power: number): number {
    return tool.def.category === 'fire'
      ? (tool.def.muzzleSpeed ?? 25) * (0.55 + power * 0.65)
      : 11 + power * 17;
  }

  /** Visee automatique sur le mannequin, corrigee par le glissement du joueur. */
  private get aimAssist(): number {
    return AIM_ASSIST[this.save.state.settings.difficulty];
  }

  private shotFor(tool: ToolInstance, aim: AimData): Shot {
    return aimShot(
      this.originOf(tool),
      this.aimPoint(),
      this.speedOf(tool, aim.power),
      this.level.gravity,
      aim.swipe.x,
      aim.swipe.y,
      this.aimAssist,
    );
  }

  private onAimUpdate(aim: AimData): void {
    const tool = this.activeTool;
    if (!tool || tool.state !== 'ready') return;
    this.hero.setAim(aim.power);

    const { dir, speed } = this.shotFor(tool, aim);
    this.aimGuide.show(this.originOf(tool), { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }, this.level.gravity);
  }

  private onRelease(aim: AimData): void {
    const tool = this.activeTool;
    this.aimGuide.hide();
    if (!tool || tool.state !== 'ready') { this.hero.setState('idle'); return; }

    // Sans visee automatique, un appui sans geste ne veut rien dire : plutot que
    // de gaspiller le tir, on rappelle qu'il faut viser.
    if (aim.tapped && this.aimAssist < 0.5) {
      this.hero.setState('idle');
      this.ui.showHint('Glisse pour viser : la direction donne l\u2019angle, la longueur la force');
      return;
    }

    const shot = this.shotFor(tool, aim);
    if (this.sim.activate(shot.dir, aim.power, tool, shot.speed)) {
      this.hero.setState('act');
      this.heroResetTimer = 0.75;
      this.audio.whoosh();
      this.syncVerb();
    }
  }

  private onHoldStart(): void {
    const tool = this.activeTool;
    if (!tool) return;
    this.holding = true;
    this.sim.setHeld(true);
    if (tool.state === 'ready') {
      const target = this.aimPoint();
      const origin = this.originOf(tool);
      const dir = normalize({ x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z });
      this.sim.activate(dir, 0.85, tool);
    }
    this.hero.setState('act');
    this.heroResetTimer = 1.2;
  }

  private onHoldEnd(): void {
    this.holding = false;
    this.sim.setHeld(false);
    this.syncVerb();
  }

  private onTap(): void {
    const tool = this.activeTool;
    if (!tool || tool.state !== 'ready') return;
    this.hero.setState('act');
    this.heroResetTimer = 0.75;
    this.sim.activate({ x: 0, y: -1, z: 0 }, 0.85, tool);
    this.audio.whoosh();
    this.syncVerb();
  }

  /* ------------------------------------------------------- Saisie a la main */

  /**
   * Attrape un membre du mannequin sous le doigt. Le mannequin passe en physique
   * libre et compte comme touche : le projeter contre un mur ou le sol rapporte
   * donc des points, au meme titre qu'un coup porte par un outil.
   */
  private startGrab(x: number, y: number): boolean {
    if (this.ui.winVisible) return false;
    const part = this.view.pickRagdollPart(x, y, window.innerWidth, window.innerHeight);
    if (!part) return false;

    const ragdoll = this.sim.ragdolls.find((r) => r.parts.get(part.name) === part);
    ragdoll?.wake();
    ragdoll?.markHandled();

    this.grabbed = part;
    const t = part.body.translation();
    this.grabDepth.set(t.x, t.y, t.z);
    this.grabTarget.copy(this.grabDepth);
    this.aimGuide.hide();
    return true;
  }

  private moveGrab(x: number, y: number): void {
    if (!this.grabbed) return;
    this.view.screenToWorldAtDepth(x, y, window.innerWidth, window.innerHeight, this.grabDepth, this.grabTarget);
  }

  private endGrab(): void {
    if (!this.grabbed) return;
    // On relache sans rien annuler : la vitesse acquise projette le mannequin.
    this.grabbed.body.setAngularDamping(0.35);
    this.grabbed = null;
  }

  /** Tire le membre saisi vers le doigt, a vitesse bornee. */
  private updateGrab(): void {
    const part = this.grabbed;
    if (!part) return;
    const p = part.body.translation();
    const vx = (this.grabTarget.x - p.x) * GRAB_STIFFNESS;
    const vy = (this.grabTarget.y - p.y) * GRAB_STIFFNESS;
    const vz = (this.grabTarget.z - p.z) * GRAB_STIFFNESS;
    const speed = Math.hypot(vx, vy, vz);
    const k = speed > GRAB_MAX_SPEED ? GRAB_MAX_SPEED / speed : 1;
    part.body.setLinvel({ x: vx * k, y: vy * k, z: vz * k }, true);
    part.body.setAngularDamping(3);
  }

  /* --------------------------------------------------------------- Boucle */

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);

    // Un onglet remis au premier plan ne doit pas rattraper des secondes de
    // simulation. La borne reste assez large pour qu'un appareil descendu a
    // 10 images par seconde suive quand meme le temps reel : en dessous, le jeu
    // passerait au ralenti et un tir valide pourrait echouer.
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    this.stepSimulation(dt);
    this.hero.update(dt);
    this.effects.update(dt);
    this.view.sync(dt, this.holding);
    this.view.render(dt);
  };

  private stepSimulation(dt: number): void {
    if (this.heroResetTimer > 0) {
      this.heroResetTimer -= dt;
      if (this.heroResetTimer <= 0 && this.hero.currentState === 'act') this.hero.setState('idle');
    }
    this.placeHeldTool();

    this.accumulator += dt * this.timeScale;
    // 8 sous-pas couvrent 133 ms, soit plus que la borne de dt ci-dessus : le
    // temps simule ne peut donc pas prendre de retard, sans risque d'emballement.
    let steps = 0;
    while (this.accumulator >= FIXED_TIMESTEP && steps < 8) {
      this.accumulator -= FIXED_TIMESTEP;
      steps++;
      this.updateGrab();
      const result = this.sim.step();
      this.handleHits(result);
    }

    this.ui.setProgress(this.sim.damage.total, this.sim.threshold);

    if (this.winTimer >= 0) {
      this.winTimer -= dt;
      if (this.winTimer <= 0) this.finishWin();
      return;
    }

    if (this.sim.won && !this.ui.winVisible) {
      this.beginWin();
      return;
    }

    // Une fois l'ecran de victoire affiche, plus rien ne doit toucher au niveau :
    // sans cette garde, la reprise automatique le rechargeait au bout de quelques
    // secondes, derriere l'ecran, si le joueur ne se pressait pas d'appuyer.
    if (this.ui.winVisible) return;

    // Tir manque : tout est retombe et il ne reste aucun outil disponible.
    // On ne relance jamais pendant que le joueur maintient son doigt : un champ
    // de force qui plaque le mannequin au sol suffirait sinon a declencher la
    // remise a zero alors qu'il est encore en train de jouer.
    if (this.sim.tools.length === 0) return; // niveau remplace a la main, sans outil
    const noToolsLeft = !this.sim.tools.some((t) => t.state === 'ready');
    if (noToolsLeft && !this.holding && !this.grabbed && this.sim.isSettled()) {
      this.settleTimer += dt;
      if (this.settleTimer > RETRY_DELAY) this.loadLevel(this.level.level);
      else if (this.settleTimer > 0.6) this.ui.showHint('Raté ! On recommence…');
    } else {
      this.settleTimer = 0;
    }
  }

  private handleHits(result: ReturnType<Simulation['step']>): void {
    for (const hit of result.hits) {
      if (hit.amount < 8) continue;
      const intensity = Math.min(1, hit.amount / 900);
      const p = hit.part.body.translation();
      this.effects.burst(p, intensity);
      this.audio.impact(intensity, true);
      this.view.addShake(intensity * 0.2);
      if (hit.broke > 0) {
        this.audio.crack();
        this.view.addShake(0.16);
        if (this.save.state.settings.haptics) navigator.vibrate?.(25);
      }
    }
    for (const tool of this.sim.tools) {
      if (tool.exploded && !tool.explosionPlayed) {
        tool.explosionPlayed = true;
        this.audio.explosion();
        this.view.addShake(0.4);
      }
    }
  }

  private beginWin(): void {
    this.timeScale = 0.22; // ralenti d'une seconde avant l'ecran de victoire
    this.winTimer = WIN_SLOWMO;
    this.input.setLocked(true);
    this.aimGuide.hide();
  }

  private finishWin(): void {
    this.timeScale = 1;
    this.winTimer = -1;
    this.holding = false;
    this.sim.setHeld(false);
    const damage = this.sim.damage.total;
    const best = this.save.bestFor(this.level.level);
    this.save.recordWin(this.level.level, damage);
    this.hero.setState('celebrate');
    this.audio.win();
    this.voice.celebrate();
    if (this.save.state.settings.haptics) navigator.vibrate?.([20, 60, 30]);
    this.ui.showWin(this.level, damage, this.sim.damage.limbsDetached, best);
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, this.save.state.settings.quality === 'low' ? 1.5 : 2.25);
    this.view.resize(width, height, ratio);
  }

  dispose(): void {
    this.running = false;
    this.sim?.dispose();
    this.hero.dispose();
    this.effects.dispose();
    this.aimGuide.dispose();
  }
}
