import * as THREE from 'three';
import { FIXED_TIMESTEP } from './PhysicsWorld.js';
import { applyAimOffset, ballisticDirection, normalize, type Vec } from './ballistics.js';
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
import type { HeroConfig, LevelDef } from '../types.js';

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
  private readonly handWorld = new THREE.Vector3();

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
      onResetProgress: () => { save.reset(); this.loadLevel(1); },
    }, heroConfig.ui.winTitle);

    this.input = new InputController(canvas.parentElement ?? canvas, {
      onFirstGesture: () => {
        // Contrainte Safari iOS : audio et synthese vocale se debloquent sur un geste.
        this.audio.unlock();
        this.voice.unlock();
        if (this.save.state.settings.sound) this.audio.startAmbient();
      },
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
    this.sim = new Simulation(this.level, this.levels.toolDefs);
    this.view.build(this.sim);
    this.save.setCurrentLevel(n);

    this.accumulator = 0;
    this.timeScale = 1;
    this.winTimer = -1;
    this.settleTimer = 0;
    this.heroResetTimer = -1;
    this.aimGuide.hide();
    this.holding = false;
    this.hero.setState('idle');
    this.hero.setAim(0);

    this.ui.setLevel(this.level);
    this.ui.setProgress(0, this.level.damageThreshold);
    this.ui.hideWin();
    this.input.setLocked(false);
    this.syncVerb();
    this.ui.showHint(this.level.isTutorial ? `${this.level.label} — ${HINTS[this.activeVerb]}` : HINTS[this.activeVerb]);
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
    this.hero.handWorldPosition(this.handWorld);
    tool.body.setTranslation({ x: this.handWorld.x, y: this.handWorld.y, z: this.handWorld.z }, false);
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

  private aimPoint(): Vec {
    const [x, y, z] = this.level.targets[0].position;
    return { x, y: y + 1.25 * this.level.targets[0].scale, z };
  }

  private speedOf(tool: ToolInstance, power: number): number {
    return tool.def.category === 'fire'
      ? (tool.def.muzzleSpeed ?? 25) * (0.55 + power * 0.65)
      : 11 + power * 17;
  }

  /** Visee automatique sur le mannequin, corrigee par le glissement du joueur. */
  private directionFor(tool: ToolInstance, aim: AimData): Vec {
    const speed = this.speedOf(tool, aim.power);
    const base = ballisticDirection(this.originOf(tool), this.aimPoint(), speed, this.level.gravity);
    return applyAimOffset(base, aim.swipe.x, aim.swipe.y);
  }

  private onAimUpdate(aim: AimData): void {
    const tool = this.activeTool;
    if (!tool || tool.state !== 'ready') return;
    this.hero.setAim(aim.power);

    const speed = this.speedOf(tool, aim.power);
    const dir = this.directionFor(tool, aim);
    this.aimGuide.show(this.originOf(tool), { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }, this.level.gravity);
  }

  private onRelease(aim: AimData): void {
    const tool = this.activeTool;
    this.aimGuide.hide();
    if (!tool || tool.state !== 'ready') { this.hero.setState('idle'); return; }

    if (this.sim.activate(this.directionFor(tool, aim), aim.power, tool)) {
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

    // Un onglet remis au premier plan ne doit pas rattraper des secondes de simulation.
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
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
    let steps = 0;
    while (this.accumulator >= FIXED_TIMESTEP && steps < 5) {
      this.accumulator -= FIXED_TIMESTEP;
      steps++;
      const result = this.sim.step();
      this.handleHits(result);
    }

    this.ui.setProgress(this.sim.damage.total, this.level.damageThreshold);

    if (this.winTimer >= 0) {
      this.winTimer -= dt;
      if (this.winTimer <= 0) this.finishWin();
      return;
    }

    if (this.sim.won && !this.ui.winVisible) {
      this.beginWin();
      return;
    }

    // Tir manque : tout est retombe et il ne reste aucun outil disponible.
    const noToolsLeft = !this.sim.tools.some((t) => t.state === 'ready');
    if (noToolsLeft && this.sim.isSettled()) {
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
