import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../core/PhysicsWorld.js';
import type { Ragdoll } from './RagdollFactory.js';
import type { PlacedTool, ToolDef, VisualDesc } from '../types.js';

export type ToolState = 'ready' | 'flying' | 'spent';

/** Verbe d'interaction attendu par l'outil (pilote InputController et les tutoriels). */
export type InteractionVerb = 'drag' | 'tap' | 'hold' | 'aim' | 'none';

export interface ToolInstance {
  def: ToolDef;
  placed: PlacedTool;
  body: RAPIER.RigidBody | null;
  collider: RAPIER.Collider | null;
  /** Support fixe (crochet, pivot, socle) purement visuel cote rendu. */
  anchor: { position: [number, number, number]; kind: 'hook' | 'pivot' | 'muzzle' | 'none' };
  joint: RAPIER.ImpulseJoint | null;
  visual: VisualDesc;
  state: ToolState;
  verb: InteractionVerb;
  /** Explosif : arme apres le premier contact. */
  fuse: number;
  exploded: boolean;
  /** Evite de rejouer le son d'explosion a chaque frame. */
  explosionPlayed: boolean;
}

export const VERB_BY_CATEGORY: Record<ToolDef['category'], InteractionVerb> = {
  throw: 'drag',
  drop: 'tap',
  swing: 'hold',
  fire: 'aim',
  hold: 'hold',
  field: 'none',
};

export class ToolFactory {
  constructor(private readonly physics: PhysicsWorld) {}

  create(def: ToolDef, placed: PlacedTool): ToolInstance {
    const verb = VERB_BY_CATEGORY[def.category];
    const visual: VisualDesc = {
      shape: def.shape,
      size: def.size,
      color: def.color,
      accent: def.accent,
      role: def.id,
    };

    const instance: ToolInstance = {
      def, placed, body: null, collider: null,
      anchor: { position: [...placed.position], kind: 'none' },
      joint: null, visual, state: 'ready', verb, fuse: -1, exploded: false, explosionPlayed: false,
    };

    if (def.category === 'hold' && def.field && def.field.type !== 'shock') {
      // Ventilateur et laser n'ont pas de corps physique : ce sont des champs de force.
      return instance;
    }

    const [x, y, z] = placed.position;
    const isStatic = def.category === 'field' || (def.category === 'hold' && def.field?.type === 'shock');

    const bodyDesc = (isStatic ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.fixed())
      .setTranslation(x, y, z)
      .setCcdEnabled(true);
    const body = this.physics.world.createRigidBody(bodyDesc);

    const [sx, sy, sz] = def.size;
    const mass = def.mass * placed.massScale;
    let desc: RAPIER.ColliderDesc;
    let volume: number;
    if (def.shape === 'sphere') {
      desc = RAPIER.ColliderDesc.ball(sx);
      volume = (4 / 3) * Math.PI * sx ** 3;
    } else if (def.shape === 'cylinder') {
      desc = RAPIER.ColliderDesc.cylinder(sy / 2, sx / 2);
      volume = Math.PI * (sx / 2) ** 2 * sy;
    } else {
      desc = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2);
      volume = sx * sy * sz;
    }
    desc
      .setDensity(isStatic ? 1 : Math.max(1, mass / Math.max(volume, 1e-3)))
      .setFriction(def.friction)
      .setRestitution(def.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(20);

    body.setLinearDamping(0.12);
    body.setAngularDamping(0.2);
    instance.body = body;
    instance.collider = this.physics.world.createCollider(desc, body);
    instance.anchor = {
      position: [x, y + (def.category === 'drop' ? sy / 2 + 0.9 : 0), z],
      kind: def.category === 'drop' ? 'hook' : def.category === 'swing' ? 'pivot' : def.category === 'fire' ? 'muzzle' : 'none',
    };

    if (def.category === 'swing') {
      // Marteau sur pivot : la masse est retenue en l'air jusqu'au declenchement.
      body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      body.setGravityScale(0, true);
      const pivot = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
      const arm = def.armLength ?? sx / 2 + 0.6;
      const data = RAPIER.JointData.revolute(
        { x: 0, y: 0, z: 0 },
        { x: -arm, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      );
      instance.joint = this.physics.world.createImpulseJoint(data, pivot, body, true);
      body.setTranslation(
        { x: x + Math.cos(placed.rotationZ) * arm, y: y + Math.sin(placed.rotationZ) * arm, z },
        true,
      );
      instance.anchor = { position: [x, y, z], kind: 'pivot' };
    }

    return instance;
  }

  /**
   * Declenche l'outil. `dir` est normalise, `power` dans [0,1].
   * Retourne false si l'outil a deja ete utilise.
   */
  activate(tool: ToolInstance, dir: { x: number; y: number; z: number }, power: number): boolean {
    if (tool.state !== 'ready') return false;
    const def = tool.def;

    if (def.category === 'hold' || def.category === 'field') {
      tool.state = 'flying';
      return true;
    }
    if (!tool.body) return false;

    const body = tool.body;
    switch (def.category) {
      case 'throw': {
        body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        const speed = 11 + power * 17;
        body.setLinvel({ x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }, true);
        if (def.spin) body.setAngvel({ x: 0, y: 0, z: def.spin }, true);
        if (def.explosive) tool.fuse = 2.6;
        break;
      }
      case 'drop': {
        body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        if (def.rollLaunch) {
          body.setLinvel({ x: tool.placed.launchSpeed ?? 10, y: 0, z: 0 }, true);
          body.setAngvel({ x: 0, y: 0, z: -(tool.placed.launchSpeed ?? 10) / Math.max(0.2, def.size[0] / 2) }, true);
        } else if (def.power_driven) {
          // La presse est motorisee : elle descend plus vite que la chute libre.
          body.setLinvel({ x: 0, y: -6.5, z: 0 }, true);
        }
        break;
      }
      case 'swing': {
        body.setGravityScale(1, true);
        body.applyTorqueImpulse({ x: 0, y: 0, z: -(140 + power * 260) * tool.placed.massScale }, true);
        break;
      }
      case 'fire': {
        body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        const speed = (def.muzzleSpeed ?? 25) * (0.55 + power * 0.65);
        body.setLinvel({ x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }, true);
        break;
      }
    }
    tool.state = 'flying';
    return true;
  }

  /**
   * Met a jour les effets continus (champs de force, meche des explosifs).
   * Retourne les degats infliges pendant ce pas.
   */
  update(tool: ToolInstance, dt: number, ragdolls: Ragdoll[], held: boolean): number {
    let damage = 0;
    const def = tool.def;

    if (def.field && tool.state === 'flying' && held) {
      damage += this.applyField(tool, dt, ragdolls);
    }

    if (def.explosive && tool.fuse > 0 && !tool.exploded) {
      tool.fuse -= dt;
      const body = tool.body;
      const slow = body ? body.linvel() : null;
      const speed2 = slow ? slow.x ** 2 + slow.y ** 2 + slow.z ** 2 : 0;
      if (tool.fuse <= 0 || speed2 < 1.2) {
        damage += this.explode(tool, ragdolls);
      }
    }
    return damage;
  }

  private applyField(tool: ToolInstance, dt: number, ragdolls: Ragdoll[]): number {
    const field = tool.def.field!;
    const [fx, fy, fz] = tool.placed.position;
    let damage = 0;

    for (const ragdoll of ragdolls) {
      let touched = 0;
      for (const part of ragdoll.parts.values()) {
        const p = part.body.translation();
        let inside = false;
        let force = { x: 0, y: 0, z: 0 };

        if (field.type === 'wind') {
          const d = Math.hypot(p.x - fx, p.y - fy, p.z - fz);
          inside = d < field.radius;
          if (inside) force = { x: field.force * (1 - d / field.radius), y: field.force * 0.16, z: 0 };
        } else if (field.type === 'beam') {
          const d = Math.hypot(p.x - fx, p.z - fz);
          inside = d < field.radius && p.y < fy;
          if (inside) force = { x: 0, y: -field.force, z: 0 };
        } else {
          const d = Math.hypot(p.x - fx, p.z - fz);
          inside = d < field.radius && p.y < fy + 1.4;
          if (inside) force = { x: 0, y: field.force, z: 0 };
        }

        if (!inside) continue;
        touched++;
        part.body.applyImpulse({ x: force.x * dt, y: force.y * dt, z: force.z * dt }, true);
        part.stress += field.force * dt * 0.02;
      }

      // Les degats d'un champ valent pour le mannequin entier, au prorata des
      // membres exposes : les compter membre par membre rendait le laser
      // instantane (onze fois le debit annonce).
      if (field.dps && touched > 0) {
        damage += field.dps * dt * tool.def.damageMultiplier * (touched / ragdoll.parts.size);
      }
    }
    return damage;
  }

  private explode(tool: ToolInstance, ragdolls: Ragdoll[]): number {
    tool.exploded = true;
    tool.state = 'spent';
    const blast = tool.def.explosive!;
    const body = tool.body;
    if (!body) return 0;
    const c = body.translation();
    let damage = 0;

    for (const ragdoll of ragdolls) {
      for (const part of ragdoll.parts.values()) {
        const p = part.body.translation();
        const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > blast.radius) continue;
        const falloff = 1 - d / blast.radius;
        const n = d < 1e-3 ? { x: 0, y: 1, z: 0 } : { x: dx / d, y: dy / d, z: dz / d };
        const j = blast.impulse * falloff;
        part.body.applyImpulse({ x: n.x * j, y: n.y * j + j * 0.35, z: n.z * j }, true);
        const gain = j * 2.4;
        damage += gain;
        ragdoll.applyStress(part, j * 0.11);
      }
    }
    return damage;
  }
}
