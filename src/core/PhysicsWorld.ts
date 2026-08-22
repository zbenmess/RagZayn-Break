import RAPIER from '@dimforge/rapier3d-compat';

let ready = false;

/** Rapier est compile en WebAssembly : il faut l'initialiser une fois avant tout usage. */
export async function initPhysics(): Promise<void> {
  if (ready) return;
  await RAPIER.init();
  ready = true;
}

export const FIXED_TIMESTEP = 1 / 60;

/** Evenement de contact normalise, consomme par le systeme de degats. */
export interface ContactEvent {
  handleA: number;
  handleB: number;
  /** Impulsion approchee du choc, en N.s. */
  impulse: number;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly events: RAPIER.EventQueue;

  constructor(gravityY: number) {
    this.world = new RAPIER.World({ x: 0, y: gravityY, z: 0 });
    this.world.timestep = FIXED_TIMESTEP;
    this.events = new RAPIER.EventQueue(true);
    this.buildGround();
  }

  /** Sol infini invisible : seules les ombres portees le rendent lisible a l'ecran. */
  private buildGround(): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const collider = RAPIER.ColliderDesc.cuboid(60, 0.5, 60)
      .setTranslation(0, -0.5, 0)
      .setFriction(0.85)
      .setRestitution(0.08)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(30);
    this.groundHandle = this.world.createCollider(collider, body).handle;
  }

  groundHandle = -1;

  setGravity(y: number): void {
    this.world.gravity = { x: 0, y, z: 0 };
  }

  /** Avance la simulation d'un pas fixe et retourne les chocs de ce pas. */
  step(): ContactEvent[] {
    this.world.step(this.events);
    const contacts: ContactEvent[] = [];
    this.events.drainContactForceEvents((event) => {
      contacts.push({
        handleA: event.collider1(),
        handleB: event.collider2(),
        impulse: event.totalForceMagnitude() * FIXED_TIMESTEP,
      });
    });
    return contacts;
  }

  free(): void {
    this.events.free();
    this.world.free();
  }
}

export { RAPIER };
