import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../core/PhysicsWorld.js';
import type { TargetSpec, Vec3, VisualDesc } from '../types.js';

/** Costume de la figurine : rouge a motif de toile, bleu uni (cf. SceneView). */
const RED = '#D3232B';
const BLUE = '#2346C8';
const SEAM = '#5A0E12';

/** Les chocs d'un mannequin simplement projete a la main comptent a cette part. */
const HAND_IMPACT_FACTOR = 0.45;

export type PartName =
  | 'pelvis' | 'torso' | 'head'
  | 'upperArmL' | 'upperArmR' | 'forearmL' | 'forearmR'
  | 'thighL' | 'thighR' | 'shinL' | 'shinR';

interface PartSpec {
  name: PartName;
  shape: 'capsule' | 'sphere' | 'box';
  /** capsule : [rayon, demi-hauteur, rayon] ; sphere : [r,r,r] ; box : demi-dimensions. */
  size: Vec3;
  center: Vec3;
  color: string;
  density: number;
}

interface JointSpec {
  parent: PartName;
  child: PartName;
  type: 'spherical' | 'revolute';
  anchorParent: Vec3;
  anchorChild: Vec3;
  axis?: Vec3;
  limits?: [number, number];
  /** Impulsion cumulee (N.s) au-dela de laquelle le membre se detache. */
  breakImpulse: number;
}

/** Figurine de super-heros : pieds au sol (y=0), hauteur ~1.75 m a l'echelle 1. */
const PARTS: PartSpec[] = [
  { name: 'pelvis',    shape: 'box',     size: [0.13, 0.09, 0.10],  center: [0, 0.95, 0],       color: BLUE,      density: 420 },
  { name: 'torso',     shape: 'box',     size: [0.15, 0.19, 0.11],  center: [0, 1.28, 0],       color: RED,      density: 400 },
  { name: 'head',      shape: 'sphere',  size: [0.145, 0.145, 0.145], center: [0, 1.63, 0],     color: RED, density: 380 },
  { name: 'upperArmL', shape: 'capsule', size: [0.050, 0.11, 0.050], center: [-0.215, 1.30, 0], color: RED,      density: 380 },
  { name: 'upperArmR', shape: 'capsule', size: [0.050, 0.11, 0.050], center: [ 0.215, 1.30, 0], color: RED,      density: 380 },
  { name: 'forearmL',  shape: 'capsule', size: [0.045, 0.115, 0.045], center: [-0.215, 1.02, 0], color: RED,     density: 380 },
  { name: 'forearmR',  shape: 'capsule', size: [0.045, 0.115, 0.045], center: [ 0.215, 1.02, 0], color: RED,     density: 380 },
  { name: 'thighL',    shape: 'capsule', size: [0.065, 0.16, 0.065], center: [-0.095, 0.66, 0], color: BLUE,      density: 420 },
  { name: 'thighR',    shape: 'capsule', size: [0.065, 0.16, 0.065], center: [ 0.095, 0.66, 0], color: BLUE,      density: 420 },
  { name: 'shinL',     shape: 'capsule', size: [0.055, 0.17, 0.055], center: [-0.095, 0.27, 0], color: RED,      density: 420 },
  { name: 'shinR',     shape: 'capsule', size: [0.055, 0.17, 0.055], center: [ 0.095, 0.27, 0], color: RED,      density: 420 },
];

const JOINTS: JointSpec[] = [
  { parent: 'pelvis', child: 'torso', type: 'spherical',
    anchorParent: [0, 0.09, 0], anchorChild: [0, -0.19, 0], breakImpulse: 78 },
  { parent: 'torso', child: 'head', type: 'spherical',
    anchorParent: [0, 0.19, 0], anchorChild: [0, -0.145, 0], breakImpulse: 34 },

  { parent: 'torso', child: 'upperArmL', type: 'spherical',
    anchorParent: [-0.15, 0.13, 0], anchorChild: [0, 0.11, 0], breakImpulse: 26 },
  { parent: 'torso', child: 'upperArmR', type: 'spherical',
    anchorParent: [0.15, 0.13, 0], anchorChild: [0, 0.11, 0], breakImpulse: 26 },

  { parent: 'upperArmL', child: 'forearmL', type: 'revolute', axis: [1, 0, 0], limits: [-2.35, 0],
    anchorParent: [0, -0.11, 0], anchorChild: [0, 0.17, 0], breakImpulse: 22 },
  { parent: 'upperArmR', child: 'forearmR', type: 'revolute', axis: [1, 0, 0], limits: [-2.35, 0],
    anchorParent: [0, -0.11, 0], anchorChild: [0, 0.17, 0], breakImpulse: 22 },

  { parent: 'pelvis', child: 'thighL', type: 'spherical',
    anchorParent: [-0.095, -0.09, 0], anchorChild: [0, 0.20, 0], breakImpulse: 44 },
  { parent: 'pelvis', child: 'thighR', type: 'spherical',
    anchorParent: [0.095, -0.09, 0], anchorChild: [0, 0.20, 0], breakImpulse: 44 },

  { parent: 'thighL', child: 'shinL', type: 'revolute', axis: [1, 0, 0], limits: [0, 2.1],
    anchorParent: [0, -0.21, 0], anchorChild: [0, 0.18, 0], breakImpulse: 32 },
  { parent: 'thighR', child: 'shinR', type: 'revolute', axis: [1, 0, 0], limits: [0, 2.1],
    anchorParent: [0, -0.21, 0], anchorChild: [0, 0.18, 0], breakImpulse: 32 },
];

export interface RagdollPart {
  name: PartName;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  visual: VisualDesc;
  detached: boolean;
  /** Impulsion cumulee subie par ce membre (N.s). */
  stress: number;
}

export interface RagdollJoint {
  spec: JointSpec;
  joint: RAPIER.ImpulseJoint | null;
  breakImpulse: number;
}

export class Ragdoll {
  readonly parts = new Map<PartName, RagdollPart>();
  readonly joints: RagdollJoint[] = [];
  readonly colliderHandles = new Set<number>();
  detachedCount = 0;
  /** Tant que vrai, le mannequin tient sa pose et n'est pas soumis a la gravite. */
  frozen = true;
  /**
   * Vrai des qu'un outil a reellement touche ce mannequin. Tant que c'est faux,
   * sa chute au sol ne rapporte aucun point : faire tomber la cible sans jamais
   * l'atteindre ne doit pas suffire a terminer un niveau.
   */
  struck = false;
  /**
   * Vrai des que le joueur l'a attrape a la main. Les chocs comptent alors, mais
   * moins qu'apres un vrai coup : projeter la poupee reste un complement, pas un
   * raccourci pour terminer le niveau sans se servir des outils.
   */
  handled = false;

  constructor(readonly spec: TargetSpec, private readonly physics: PhysicsWorld) {
    const s = spec.scale;
    const [ox, oy, oz] = spec.position;
    const densityScale = spec.reinforced ? 1.35 : 1;

    for (const p of PARTS) {
      const body = physics.world.createRigidBody(
        // Le mannequin tient la pose (corps fixes) jusqu'a l'approche d'un impact :
        // sans cela un ragdoll libre s'effondrerait tout seul des la premiere frame.
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(ox + p.center[0] * s, oy + p.center[1] * s, oz + p.center[2] * s)
          .setLinearDamping(0.18)
          .setAngularDamping(0.35)
          .setCcdEnabled(true),
      );

      let desc: RAPIER.ColliderDesc;
      if (p.shape === 'capsule') desc = RAPIER.ColliderDesc.capsule(p.size[1] * s, p.size[0] * s);
      else if (p.shape === 'sphere') desc = RAPIER.ColliderDesc.ball(p.size[0] * s);
      else desc = RAPIER.ColliderDesc.cuboid(p.size[0] * s, p.size[1] * s, p.size[2] * s);

      desc
        .setDensity(p.density * densityScale)
        .setFriction(0.7)
        .setRestitution(0.05)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(20);

      const collider = physics.world.createCollider(desc, body);
      this.colliderHandles.add(collider.handle);
      this.parts.set(p.name, {
        name: p.name,
        body,
        collider,
        visual: {
          // Convention partagee avec le rendu : box = dimensions completes,
          // sphere = rayon, capsule = [rayon, demi-hauteur, rayon].
          shape: p.shape === 'sphere' ? 'sphere' : p.shape === 'capsule' ? 'capsule' : 'box',
          size:
            p.shape === 'box'
              ? [p.size[0] * 2 * s, p.size[1] * 2 * s, p.size[2] * 2 * s]
              : [p.size[0] * s, p.size[1] * s, p.size[2] * s],
          color: p.color,
          accent: SEAM,
          role: p.name,
        },
        detached: false,
        stress: 0,
      });
    }

    for (const j of JOINTS) {
      const parent = this.parts.get(j.parent)!;
      const child = this.parts.get(j.child)!;
      const a1 = { x: j.anchorParent[0] * s, y: j.anchorParent[1] * s, z: j.anchorParent[2] * s };
      const a2 = { x: j.anchorChild[0] * s, y: j.anchorChild[1] * s, z: j.anchorChild[2] * s };

      let data: RAPIER.JointData;
      if (j.type === 'revolute') {
        const axis = j.axis ?? [1, 0, 0];
        data = RAPIER.JointData.revolute(a1, a2, { x: axis[0], y: axis[1], z: axis[2] });
        if (j.limits) {
          data.limitsEnabled = true;
          data.limits = [j.limits[0], j.limits[1]];
        }
      } else {
        data = RAPIER.JointData.spherical(a1, a2);
      }

      const joint = physics.world.createImpulseJoint(data, parent.body, child.body, true);
      joint.setContactsEnabled(false);
      this.joints.push({ spec: j, joint, breakImpulse: j.breakImpulse * spec.jointStrength * s });
    }
  }

  /** Bascule le mannequin en physique libre (au premier contact ou a l'approche d'un outil). */
  wake(): void {
    if (!this.frozen) return;
    this.frozen = false;
    for (const part of this.parts.values()) {
      part.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    }
  }

  /** Centre approximatif, utilise pour le declenchement de proximite et la camera. */
  center(): { x: number; y: number; z: number } {
    const t = this.parts.get('torso')!.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  /** A appeler des qu'un outil touche ce mannequin (choc, explosion ou champ). */
  markStruck(): void {
    this.struck = true;
  }

  /** A appeler quand le joueur attrape le mannequin a la main. */
  markHandled(): void {
    this.handled = true;
  }

  /** Part des degats de choc reellement comptee, selon ce qui a mis la cible en jeu. */
  get impactFactor(): number {
    if (this.struck) return 1;
    return this.handled ? HAND_IMPACT_FACTOR : 0;
  }

  hasCollider(handle: number): boolean {
    return this.colliderHandles.has(handle);
  }

  partByCollider(handle: number): RagdollPart | undefined {
    for (const part of this.parts.values()) if (part.collider.handle === handle) return part;
    return undefined;
  }

  /** Ajoute du stress a un membre et detache les articulations qui cedent. Retourne le nombre de ruptures. */
  applyStress(part: RagdollPart, impulse: number): number {
    this.wake();
    part.stress += impulse;
    let broken = 0;
    for (const link of this.joints) {
      if (!link.joint) continue;
      const child = this.parts.get(link.spec.child)!;
      const parent = this.parts.get(link.spec.parent)!;
      // Le stress se propage : un choc sur la main arrache l'epaule si l'avant-bras encaisse trop.
      const load = Math.max(child.stress, parent.stress * 0.55);
      if (load > link.breakImpulse) {
        this.physics.world.removeImpulseJoint(link.joint, true);
        link.joint = null;
        child.detached = true;
        this.detachedCount++;
        broken++;
      }
    }
    return broken;
  }

  /** Vrai lorsque le mannequin est immobile : sert a la detection de fin de tir. */
  isSettled(): boolean {
    if (this.frozen) return true;
    for (const part of this.parts.values()) {
      const v = part.body.linvel();
      if (v.x * v.x + v.y * v.y + v.z * v.z > 0.12) return false;
    }
    return true;
  }
}

export class RagdollFactory {
  constructor(private readonly physics: PhysicsWorld) {}

  create(spec: TargetSpec): Ragdoll {
    return new Ragdoll(spec, this.physics);
  }
}
