import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_TIMESTEP, PhysicsWorld } from './PhysicsWorld.js';
import { Ragdoll, RagdollFactory } from '../entities/RagdollFactory.js';
import { ToolFactory, type ToolInstance } from '../entities/ToolFactory.js';
import { DamageSystem, type DamageEvent } from '../systems/DamageSystem.js';
import type { LevelDef, ToolDef, VisualDesc } from '../types.js';

/** Part maximale du seuil qu'on peut atteindre en projetant le mannequin a la main. */
const HAND_DAMAGE_SHARE = 0.6;

export interface ObstacleInstance {
  visual: VisualDesc;
  position: [number, number, number];
}

export interface StepResult {
  hits: DamageEvent[];
  fieldDamage: number;
}

/**
 * Etat de jeu complet d'un niveau, sans aucune dependance au rendu :
 * la meme classe sert au jeu (navigateur) et a `npm run validate-levels` (Node).
 */
export class Simulation {
  readonly physics: PhysicsWorld;
  readonly ragdolls: Ragdoll[] = [];
  readonly tools: ToolInstance[] = [];
  readonly obstacles: ObstacleInstance[] = [];
  readonly damage: DamageSystem;
  readonly toolFactory: ToolFactory;
  elapsed = 0;
  private held = false;

  constructor(readonly level: LevelDef, toolDefs: Map<string, ToolDef>, readonly thresholdScale = 1) {
    this.physics = new PhysicsWorld(level.gravity);

    const ragdollFactory = new RagdollFactory(this.physics);
    for (const target of level.targets) this.ragdolls.push(ragdollFactory.create(target));

    this.damage = new DamageSystem(this.ragdolls, this.physics.groundHandle);
    // A elle seule, la projection a la main ne peut pas depasser cette part du seuil.
    this.damage.handDamageCap = level.damageThreshold * thresholdScale * HAND_DAMAGE_SHARE;

    const toolFactory = new ToolFactory(this.physics);
    this.toolFactory = toolFactory;
    for (const placed of level.tools) {
      const def = toolDefs.get(placed.id);
      if (!def) continue;
      const tool = toolFactory.create(def, placed);
      this.tools.push(tool);
      this.damage.registerTool(tool);
    }

    for (const obstacle of level.obstacles) {
      const [x, y, z] = obstacle.position;
      const [sx, sy, sz] = obstacle.size;
      const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
      const collider = this.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
          .setRestitution(obstacle.restitution)
          .setFriction(0.6)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(20),
        body,
      );
      this.damage.registerObstacle(collider.handle);
      // Les obstacles de trajectoire sont teintes differemment du decor : le
      // joueur doit voir d'un coup d'oeil ce qui barre la route de son tir.
      const color =
        obstacle.kind === 'trampoline' ? '#3FBF7F'
        : obstacle.kind === 'low_wall' ? '#E08A5B'
        : obstacle.kind === 'canopy' ? '#C4703F'
        : '#C9D3DC';

      this.obstacles.push({
        visual: { shape: 'box', size: [sx, sy, sz], color, accent: '#8FA0AE', role: obstacle.kind },
        position: [x, y, z],
      });
    }
  }

  get primaryTool(): ToolInstance | undefined {
    return this.tools.find((t) => t.placed.primary);
  }

  /** Seuil effectif, une fois le reglage de difficulte applique. */
  get threshold(): number {
    return Math.round(this.level.damageThreshold * this.thresholdScale);
  }

  get won(): boolean {
    return this.damage.total >= this.threshold;
  }

  setHeld(held: boolean): void {
    this.held = held;
  }

  /** Declenche un outil ; par defaut l'outil principal. */
  activate(
    dir: { x: number; y: number; z: number },
    power: number,
    tool = this.primaryTool,
    speedOverride?: number,
  ): boolean {
    if (!tool) return false;
    return this.toolFactory.activate(tool, dir, power, speedOverride);
  }

  /** Declenche tous les outils secondaires encore disponibles (pieges en chaine). */
  activateSecondary(dir: { x: number; y: number; z: number }, power: number): void {
    for (const tool of this.tools) {
      if (!tool.placed.primary && tool.state === 'ready') this.toolFactory.activate(tool, dir, power);
    }
  }

  /**
   * Rayon de reveil : le mannequin passe en physique libre juste avant l'impact.
   * Volontairement court, sinon un projectile arrete par un obstacle le ferait
   * s'effondrer a distance sans jamais l'avoir touche.
   */
  private static readonly WAKE_RADIUS = 1.15;

  /** Reveille les mannequins qu'un outil en vol (ou un champ actif) va toucher. */
  private updateWake(): void {
    const sleeping = this.ragdolls.filter((r) => r.frozen);
    if (sleeping.length === 0) return;

    for (const tool of this.tools) {
      if (tool.state !== 'flying') continue;
      if (tool.def.field) {
        if (this.held) for (const r of sleeping) r.wake();
        continue;
      }
      const body = tool.body;
      if (!body) continue;
      const p = body.translation();
      const reach = Simulation.WAKE_RADIUS + Math.max(...tool.def.size) * 0.5;
      for (const ragdoll of sleeping) {
        if (!ragdoll.frozen) continue;
        const c = ragdoll.center();
        if (Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) < reach + 0.4) ragdoll.wake();
      }
    }
  }

  step(): StepResult {
    this.updateWake();
    const contacts = this.physics.step();
    const hits = this.damage.process(contacts);

    let fieldDamage = 0;
    for (const tool of this.tools) {
      fieldDamage += this.toolFactory.update(tool, FIXED_TIMESTEP, this.ragdolls, this.held);
    }
    if (fieldDamage > 0) this.damage.addDirect(fieldDamage);

    this.elapsed += FIXED_TIMESTEP;
    return { hits, fieldDamage };
  }

  /** Vrai quand plus rien ne bouge : les mannequins et les outils lances sont au repos. */
  isSettled(): boolean {
    if (!this.ragdolls.every((r) => r.isSettled())) return false;
    for (const tool of this.tools) {
      if (tool.state !== 'flying' || !tool.body) continue;
      const v = tool.body.linvel();
      if (v.x * v.x + v.y * v.y + v.z * v.z > 0.08) return false;
    }
    return true;
  }

  dispose(): void {
    this.physics.free();
  }
}
