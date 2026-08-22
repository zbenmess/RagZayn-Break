import type { ContactEvent } from '../core/PhysicsWorld.js';
import type { Ragdoll, RagdollPart } from '../entities/RagdollFactory.js';
import type { ToolInstance } from '../entities/ToolFactory.js';

/** Conversion impulsion (N.s) -> points de degats. */
export const DAMAGE_SCALE = 9.5;
/**
 * Exposant sous-lineaire : sans lui, une presse de 260 kg marquerait trente fois
 * plus qu'une boule de bowling et les scores deviendraient illisibles.
 */
export const DAMAGE_EXPONENT = 0.72;
/** Prime accordee a chaque membre arrache. */
export const LIMB_BONUS = 160;
/**
 * Les chocs contre le sol comptent moins qu'un coup porte par un outil, et ne
 * comptent pas du tout tant que le mannequin n'a pas ete touche.
 */
const GROUND_FACTOR = 0.11;
const OBSTACLE_FACTOR = 0.55;

export interface DamageEvent {
  amount: number;
  /** Position approximative du choc, pour les effets visuels et le son. */
  part: RagdollPart;
  broke: number;
  toolId: string | null;
}

export class DamageSystem {
  /** Degats issus des outils : coups, explosions, champs de force, membres arraches. */
  private toolDamage = 0;
  /** Degats issus des chocs d'un mannequin simplement projete a la main. */
  private handDamage = 0;
  /**
   * Plafond des degats a la main. Attraper la poupee et la fracasser reste
   * payant, mais ne peut pas terminer un niveau a soi seul : il faut placer un
   * vrai coup. Sans ce plafond, un mannequin qui roule au sol genere des dizaines
   * de petits chocs que la courbe sous-lineaire finit par cumuler jusqu'a la
   * victoire.
   */
  handDamageCap = Number.POSITIVE_INFINITY;
  limbsDetached = 0;

  get total(): number {
    return this.toolDamage + Math.min(this.handDamage, this.handDamageCap);
  }
  private readonly toolByCollider = new Map<number, ToolInstance>();
  private readonly obstacleColliders = new Set<number>();

  constructor(private readonly ragdolls: Ragdoll[], private readonly groundHandle: number) {}

  registerTool(tool: ToolInstance): void {
    if (tool.collider) this.toolByCollider.set(tool.collider.handle, tool);
  }

  registerObstacle(handle: number): void {
    this.obstacleColliders.add(handle);
  }

  /** Degats hors contact (explosion, champ de force) : toujours imputes aux outils. */
  addDirect(amount: number): void {
    this.toolDamage += amount;
  }

  /** Traite les chocs du pas de simulation et retourne ceux qui touchent un mannequin. */
  process(contacts: ContactEvent[]): DamageEvent[] {
    const out: DamageEvent[] = [];

    for (const contact of contacts) {
      const hit = this.resolve(contact.handleA) ?? this.resolve(contact.handleB);
      if (!hit) continue;
      const otherHandle = hit.handle === contact.handleA ? contact.handleB : contact.handleA;

      let factor = 1;
      let toolId: string | null = null;
      const tool = this.toolByCollider.get(otherHandle);
      if (tool) {
        factor = tool.def.damageMultiplier;
        toolId = tool.def.id;
        hit.ragdoll.markStruck();
      } else if (otherHandle === this.groundHandle) {
        factor = GROUND_FACTOR * hit.ragdoll.impactFactor;
      } else if (this.obstacleColliders.has(otherHandle)) {
        factor = OBSTACLE_FACTOR * hit.ragdoll.impactFactor;
      } else if (this.isRagdoll(otherHandle)) {
        // Choc entre deux membres : negligeable.
        factor = 0.12;
      }

      const impulse = contact.impulse;
      const amount = Math.pow(impulse, DAMAGE_EXPONENT) * factor * DAMAGE_SCALE;

      const broke = hit.ragdoll.applyStress(hit.part, impulse * factor);
      if (broke > 0) this.limbsDetached += broke;

      // Un mannequin que le joueur a seulement projete a la main alimente le
      // compteur plafonne ; des qu'un outil l'a touche, tout compte pleinement.
      const gain = amount + broke * LIMB_BONUS;
      if (hit.ragdoll.struck) this.toolDamage += gain;
      else this.handDamage += gain;
      out.push({ amount, part: hit.part, broke, toolId });
    }
    return out;
  }

  private isRagdoll(handle: number): boolean {
    return this.ragdolls.some((r) => r.hasCollider(handle));
  }

  private resolve(handle: number): { ragdoll: Ragdoll; part: RagdollPart; handle: number } | null {
    for (const ragdoll of this.ragdolls) {
      const part = ragdoll.partByCollider(handle);
      if (part) return { ragdoll, part, handle };
    }
    return null;
  }
}
