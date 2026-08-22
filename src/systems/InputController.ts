import type { InteractionVerb } from '../entities/ToolFactory.js';

export interface AimData {
  /** Glissement normalise (-1..1) : x vers la droite, y vers le haut de l'ecran. */
  swipe: { x: number; y: number };
  power: number;
  /** Position ecran courante, pour la trajectoire de visee. */
  screen: { x: number; y: number };
  start: { x: number; y: number };
}

export interface InputCallbacks {
  onFirstGesture(): void;
  onAimStart(): void;
  onAimUpdate(aim: AimData): void;
  onRelease(aim: AimData): void;
  onHoldStart(): void;
  onHoldEnd(): void;
  onTap(): void;
}

/** Distance minimale (en fraction du plus petit cote) avant de considerer un glissement. */
const DRAG_THRESHOLD = 0.03;

/**
 * Gestes tactiles : glisser-lacher pour viser et lancer, tap pour declencher un
 * objet suspendu, maintien pour pousser ou frapper.
 */
export class InputController {
  private verb: InteractionVerb = 'drag';
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private lastAim: AimData | null = null;
  private firstGestureDone = false;
  private locked = false;

  constructor(private readonly element: HTMLElement, private readonly cb: InputCallbacks) {
    element.addEventListener('pointerdown', this.onDown, { passive: false });
    element.addEventListener('pointermove', this.onMove, { passive: false });
    element.addEventListener('pointerup', this.onUp, { passive: false });
    element.addEventListener('pointercancel', this.onUp, { passive: false });
    // Empeche le rebond de page et le zoom sur double-tap dans Safari iOS.
    element.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  setVerb(verb: InteractionVerb): void {
    this.verb = verb;
  }

  /** Bloque les entrees pendant les transitions (victoire, chargement). */
  setLocked(locked: boolean): void {
    this.locked = locked;
    if (locked && this.pointerId !== null) {
      this.pointerId = null;
      if (this.verb === 'hold') this.cb.onHoldEnd();
    }
  }

  private reference(): number {
    return Math.min(this.element.clientWidth, this.element.clientHeight);
  }

  private computeAim(x: number, y: number): AimData {
    const dx = x - this.startX;
    const dy = y - this.startY;
    const ref = this.reference() * 0.42;
    const len = Math.hypot(dx, dy);
    const power = Math.min(1, len / ref);

    // Le glissement corrige la visee automatique ; le jeu le convertit en direction
    // 3D a partir de la geometrie du niveau (voir applyAimOffset).
    return {
      swipe: { x: Math.max(-1, Math.min(1, dx / ref)), y: Math.max(-1, Math.min(1, -dy / ref)) },
      power,
      screen: { x, y },
      start: { x: this.startX, y: this.startY },
    };
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (!this.firstGestureDone) {
      this.firstGestureDone = true;
      this.cb.onFirstGesture();
    }
    if (this.locked || this.pointerId !== null) return;

    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.lastAim = this.computeAim(e.clientX, e.clientY);

    if (this.verb === 'hold') this.cb.onHoldStart();
    else if (this.verb === 'drag' || this.verb === 'aim') this.cb.onAimStart();
  };

  private onMove = (e: PointerEvent): void => {
    if (this.pointerId !== e.pointerId || this.locked) return;
    e.preventDefault();
    if (this.verb !== 'drag' && this.verb !== 'aim') return;
    this.lastAim = this.computeAim(e.clientX, e.clientY);
    this.cb.onAimUpdate(this.lastAim);
  };

  private onUp = (e: PointerEvent): void => {
    if (this.pointerId !== e.pointerId) return;
    this.pointerId = null;
    if (this.locked) return;
    e.preventDefault();

    const aim = this.computeAim(e.clientX, e.clientY);
    const moved = Math.hypot(aim.screen.x - aim.start.x, aim.screen.y - aim.start.y) > this.reference() * DRAG_THRESHOLD;

    switch (this.verb) {
      case 'hold':
        this.cb.onHoldEnd();
        break;
      case 'tap':
        this.cb.onTap();
        break;
      case 'drag':
      case 'aim':
        // Un simple tap tire droit sur la cible avec une puissance moyenne : jouable des 2 ans.
        this.cb.onRelease(moved ? aim : { ...aim, swipe: { x: 0, y: 0 }, power: 0.8 });
        break;
      default:
        this.cb.onTap();
    }
    this.lastAim = null;
  };

  get currentAim(): AimData | null {
    return this.lastAim;
  }
}
