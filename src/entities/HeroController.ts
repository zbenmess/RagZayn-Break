import * as THREE from 'three';
import type { HeroConfig } from '../types.js';
import { HERO_HAND as HERO_HAND_POSITION } from '../core/launch.js';

/** Position de lancer sous forme de vecteur, pour le rendu. Voir core/launch.ts. */
export const HERO_HAND = new THREE.Vector3(...HERO_HAND_POSITION);

export type HeroState = 'idle' | 'aim' | 'act' | 'celebrate';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Heros procedural low-poly construit entierement a partir de hero.json.
 * Aucun corps physique : il n'est jamais affecte par la simulation ni par les degats.
 */
export class HeroController {
  readonly group = new THREE.Group();

  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly shoulderL = new THREE.Group();
  private readonly shoulderR = new THREE.Group();
  private readonly elbowL = new THREE.Group();
  private readonly elbowR = new THREE.Group();
  private readonly hipL = new THREE.Group();
  private readonly hipR = new THREE.Group();

  private state: HeroState = 'idle';
  private time = 0;
  private stateTime = 0;
  private aimPower = 0;
  private readonly baseY: number;
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor(private readonly config: HeroConfig) {
    const { placement } = config;
    this.group.position.set(...placement.position);
    this.group.rotation.y = placement.rotationY;
    this.group.scale.setScalar(placement.scale);
    this.baseY = placement.position[1];
    this.build();
  }

  private mat(color: string, flat = true): THREE.MeshLambertMaterial {
    const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), flatShading: flat });
    this.disposables.push(m);
    return m;
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.disposables.push(g);
    return g;
  }

  private mesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geo(g), m);
    mesh.castShadow = true;
    return mesh;
  }

  /** Proportions : 2 ans => grosse tete, membres courts, ventre rond. */
  private get proportions() {
    const t = clamp01((this.config.age - 2) / 8);
    return {
      head: lerp(1, 0.76, t),
      limb: lerp(1, 1.4, t),
      belly: lerp(1, 0.62, t),
      torsoH: lerp(1, 1.25, t),
    };
  }

  private build(): void {
    const c = this.config;
    const p = this.proportions;
    const skin = this.mat(c.skinTone);
    const topColor = this.mat(c.outfit.top.color);
    const bottomColor = this.mat(c.outfit.bottom.color);

    /* ------------------------------------------------------------- Jambes */
    const legLen = 0.15 * p.limb;
    for (const side of [-1, 1] as const) {
      const hip = side < 0 ? this.hipL : this.hipR;
      hip.position.set(side * 0.075, 0.19 * p.limb, 0);
      this.group.add(hip);

      const thigh = this.mesh(new THREE.CapsuleGeometry(0.055, legLen * 0.6, 3, 8), skin);
      thigh.position.y = -legLen * 0.45;
      hip.add(thigh);

      const shin = this.mesh(new THREE.CapsuleGeometry(0.05, legLen * 0.55, 3, 8), skin);
      shin.position.y = -legLen * 1.2;
      hip.add(shin);

      if (c.outfit.shoes.type !== 'barefoot') {
        const shoeColor = this.mat(c.outfit.shoes.color);
        const shoe = this.mesh(new THREE.BoxGeometry(0.115, 0.062, 0.17), shoeColor);
        shoe.position.set(0, -legLen * 1.62, 0.035);
        hip.add(shoe);
        if (c.outfit.shoes.type === 'boots') {
          const cuff = this.mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.09, 8), shoeColor);
          cuff.position.set(0, -legLen * 1.42, 0);
          hip.add(cuff);
        }
      }
    }

    /* -------------------------------------------------------------- Short */
    const shortsH = c.outfit.bottom.type === 'shorts' ? 0.15 : 0.3 * p.limb;
    const shorts = this.mesh(new THREE.BoxGeometry(0.245, shortsH, 0.185), bottomColor);
    shorts.position.y = 0.19 * p.limb + (c.outfit.bottom.type === 'shorts' ? 0.005 : -0.055);
    this.group.add(shorts);

    /* -------------------------------------------------------------- Torse */
    this.torso.position.y = 0.28 * p.limb;
    this.group.add(this.torso);

    const chest = this.mesh(new THREE.BoxGeometry(0.25, 0.24 * p.torsoH, 0.19), topColor);
    chest.position.y = 0.12 * p.torsoH;
    this.torso.add(chest);

    // Ventre rond du bambin.
    const belly = this.mesh(new THREE.SphereGeometry(0.125 * p.belly + 0.045, 14, 10), topColor);
    belly.scale.set(1, 0.85, 0.8);
    belly.position.set(0, 0.075 * p.torsoH, 0.03);
    this.torso.add(belly);

    if (c.outfit.top.chestPrint) {
      const print = this.mesh(new THREE.CircleGeometry(0.058, 16), this.mat(c.outfit.top.printColor, false));
      print.position.set(0, 0.135 * p.torsoH, 0.098);
      print.castShadow = false;
      this.torso.add(print);
    }

    /* --------------------------------------------------------------- Bras */
    const armLen = 0.115 * p.limb;
    const sleeveLong = c.outfit.top.sleeve === 'long' || c.outfit.top.type === 'hoodie';
    for (const side of [-1, 1] as const) {
      const shoulder = side < 0 ? this.shoulderL : this.shoulderR;
      const elbow = side < 0 ? this.elbowL : this.elbowR;
      shoulder.position.set(side * 0.145, 0.2 * p.torsoH, 0);
      this.torso.add(shoulder);

      const upper = this.mesh(
        new THREE.CapsuleGeometry(0.043, armLen, 3, 8),
        c.outfit.top.sleeve === 'none' ? skin : topColor,
      );
      upper.position.y = -armLen * 0.62;
      shoulder.add(upper);

      elbow.position.y = -armLen * 1.28;
      shoulder.add(elbow);

      const fore = this.mesh(new THREE.CapsuleGeometry(0.038, armLen * 0.9, 3, 8), sleeveLong ? topColor : skin);
      fore.position.y = -armLen * 0.55;
      elbow.add(fore);

      const hand = this.mesh(new THREE.SphereGeometry(0.048, 10, 8), skin);
      hand.position.y = -armLen * 1.15;
      elbow.add(hand);

    }

    /* --------------------------------------------------------------- Tete */
    this.head.position.y = 0.29 * p.torsoH;
    this.torso.add(this.head);
    this.buildHead(skin);

    /* -------------------------------------------------------- Accessoires */
    for (const accessory of c.accessories) this.buildAccessory(accessory);
  }

  private buildHead(skin: THREE.Material): void {
    const c = this.config;
    const p = this.proportions;
    const r = 0.155 * p.head;

    const skull = this.mesh(new THREE.SphereGeometry(r, 18, 14), skin);
    skull.scale.set(1, 1.04, 0.96);
    skull.position.y = r * 0.85;
    this.head.add(skull);

    const faceY = r * 0.85;

    /* Yeux */
    const eyeScale = c.eyeShape === 'round_large' ? 1 : c.eyeShape === 'round_small' ? 0.75 : 0.9;
    const white = this.mat('#FFFFFF', false);
    const iris = this.mat(c.eyeColor, false);
    for (const side of [-1, 1] as const) {
      const eye = this.mesh(new THREE.SphereGeometry(r * 0.3 * eyeScale, 12, 10), white);
      eye.castShadow = false;
      eye.position.set(side * r * 0.36, faceY + r * 0.08, r * 0.8);
      if (c.eyeShape === 'almond') eye.scale.set(1.15, 0.62, 1);
      this.head.add(eye);

      const pupil = this.mesh(new THREE.SphereGeometry(r * 0.17 * eyeScale, 10, 8), iris);
      pupil.castShadow = false;
      pupil.position.set(side * r * 0.37, faceY + r * 0.07, r * 0.94);
      this.head.add(pupil);

      // Joues rondes.
      const cheek = this.mesh(new THREE.SphereGeometry(r * 0.26, 10, 8), this.mat('#F0A98F', false));
      cheek.castShadow = false;
      cheek.scale.set(1, 0.72, 0.5);
      cheek.position.set(side * r * 0.6, faceY - r * 0.24, r * 0.7);
      this.head.add(cheek);
    }

    /* Nez */
    const nose = this.mesh(new THREE.SphereGeometry(r * 0.13, 8, 6), skin);
    nose.position.set(0, faceY - r * 0.1, r * 0.95);
    this.head.add(nose);

    /* Bouche */
    const wide = c.expression === 'big_smile' || c.expression === 'excited';
    const mouth = this.mesh(
      new THREE.TorusGeometry(r * (wide ? 0.34 : 0.26), r * 0.07, 6, 16, Math.PI),
      this.mat('#8A3B3B', false),
    );
    mouth.castShadow = false;
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, faceY - r * 0.38, r * 0.86);
    this.head.add(mouth);

    if (wide) {
      // Sourire large montrant les dents.
      const teeth = this.mesh(new THREE.BoxGeometry(r * 0.5, r * 0.14, r * 0.06), this.mat('#FFFFFF', false));
      teeth.castShadow = false;
      teeth.position.set(0, faceY - r * 0.33, r * 0.9);
      this.head.add(teeth);
    }

    /* Oreilles */
    for (const side of [-1, 1] as const) {
      const ear = this.mesh(new THREE.SphereGeometry(r * 0.17, 8, 6), skin);
      ear.scale.set(0.6, 1, 0.8);
      ear.position.set(side * r * 0.98, faceY, 0);
      this.head.add(ear);
    }

    /* Cheveux */
    if (c.hairStyle !== 'none') this.buildHair(r, faceY);
  }

  private buildHair(r: number, faceY: number): void {
    const hair = this.mat(this.config.hairColor);
    const style = this.config.hairStyle;

    if (style === 'buzz') {
      const cap = this.mesh(new THREE.SphereGeometry(r * 1.02, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), hair);
      cap.position.y = faceY;
      this.head.add(cap);
      return;
    }

    const cap = this.mesh(new THREE.SphereGeometry(r * 1.06, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
    cap.position.y = faceY;
    cap.scale.set(1, 0.98, 1);
    this.head.add(cap);

    if (style === 'curly') {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const curl = this.mesh(new THREE.SphereGeometry(r * 0.24, 8, 6), hair);
        curl.position.set(Math.cos(a) * r * 0.74, faceY + r * 0.6 + Math.sin(i * 2.3) * r * 0.1, Math.sin(a) * r * 0.6);
        this.head.add(curl);
      }
      return;
    }

    if (style === 'short_textured') {
      // Meches courtes ebouriffees sur le dessus, cotes degages.
      const tufts = 7;
      for (let i = 0; i < tufts; i++) {
        const a = (i / tufts) * Math.PI * 2 + 0.4;
        const radial = r * (0.24 + (i % 3) * 0.12);
        const tuft = this.mesh(new THREE.BoxGeometry(r * 0.28, r * 0.3, r * 0.26), hair);
        tuft.position.set(Math.cos(a) * radial, faceY + r * 0.86 + (i % 2) * r * 0.1, Math.sin(a) * radial * 0.85 - r * 0.08);
        tuft.rotation.set(0.25 * Math.sin(i), a, 0.22 * Math.cos(i * 1.7));
        this.head.add(tuft);
      }
    }

    // Nuque.
    const nape = this.mesh(new THREE.BoxGeometry(r * 1.5, r * 0.42, r * 0.5), hair);
    nape.position.set(0, faceY + r * 0.02, -r * 0.72);
    this.head.add(nape);
  }

  private buildAccessory(kind: string): void {
    const p = this.proportions;
    const r = 0.155 * p.head;
    if (kind === 'cap') {
      const cap = this.mesh(new THREE.SphereGeometry(r * 1.1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), this.mat('#D94848'));
      cap.position.y = r * 0.9;
      this.head.add(cap);
      const brim = this.mesh(new THREE.BoxGeometry(r * 1.6, r * 0.12, r * 0.9), this.mat('#B03A3A'));
      brim.position.set(0, r * 1.28, r * 0.85);
      this.head.add(brim);
    } else if (kind === 'glasses') {
      for (const side of [-1, 1] as const) {
        const lens = this.mesh(new THREE.TorusGeometry(r * 0.3, r * 0.05, 6, 14), this.mat('#333333', false));
        lens.position.set(side * r * 0.36, r * 0.93, r * 0.92);
        this.head.add(lens);
      }
    } else if (kind === 'backpack') {
      const bag = this.mesh(new THREE.BoxGeometry(0.2, 0.22, 0.1), this.mat('#3FBF7F'));
      bag.position.set(0, 0.14, -0.15);
      this.torso.add(bag);
    }
  }

  /* --------------------------------------------------------------- Animation */

  setState(state: HeroState): void {
    if (this.state === state) return;
    this.state = state;
    this.stateTime = 0;
  }

  /** Puissance de visee courante (0..1) : le bras se charge en arriere. */
  setAim(power: number): void {
    this.aimPower = clamp01(power);
  }

  get currentState(): HeroState {
    return this.state;
  }

  update(dt: number): void {
    this.time += dt;
    this.stateTime += dt;
    const t = this.time;

    let bob = Math.sin(t * 2.4) * 0.008;
    let lean = 0;
    let armR = 0;
    let armL = 0;
    let elbowR = -0.35;
    let elbowL = -0.35;
    let spread = 0.12;
    let headTilt = Math.sin(t * 1.6) * 0.05;
    let rootY = this.baseY;
    let twist = 0;
    let absoluteYaw: number | null = null;

    switch (this.state) {
      case 'aim': {
        lean = 0.1 + this.aimPower * 0.1;
        armR = 0.55 + this.aimPower * 0.45;
        elbowR = -0.12;
        armL = 0.18;
        twist = -0.18 * this.aimPower;
        headTilt = 0.04;
        break;
      }
      case 'act': {
        // Lancer / frappe : 0.35 s de detente.
        const k = clamp01(this.stateTime / 0.35);
        const ease = 1 - Math.pow(1 - k, 3);
        lean = 0.14 - ease * 0.16;
        armR = lerp(1.0, -1.0, ease);
        elbowR = lerp(-0.12, -0.05, ease);
        armL = lerp(0.18, -0.3, ease);
        twist = lerp(-0.2, 0.22, ease);
        break;
      }
      case 'celebrate': {
        const k = this.stateTime;
        const hop = Math.max(0, Math.sin(k * 6.2));
        rootY = this.baseY + hop * 0.14;
        armR = -2.75 + Math.sin(k * 9) * 0.16;
        armL = -2.75 - Math.sin(k * 9) * 0.16;
        elbowR = elbowL = -0.18;
        spread = 0.4;
        lean = -0.08;
        headTilt = -0.16 + Math.sin(k * 5) * 0.06;
        absoluteYaw = 0.12 + Math.sin(k * 3.4) * 0.18;
        bob = 0;
        break;
      }
      default: {
        armR = 0.05 + Math.sin(t * 2.1) * 0.12;
        armL = 0.05 - Math.sin(t * 2.1) * 0.12;
        lean = 0.02 + Math.sin(t * 2.4) * 0.01;
      }
    }

    const k = 1 - Math.pow(0.001, dt); // lissage exponentiel independant du framerate
    this.group.position.y = lerp(this.group.position.y, rootY + bob, k);
    const yaw = absoluteYaw ?? this.config.placement.rotationY + twist;
    this.group.rotation.y = lerp(this.group.rotation.y, yaw, k);
    this.torso.rotation.x = lerp(this.torso.rotation.x, lean, k);
    this.head.rotation.x = lerp(this.head.rotation.x, headTilt, k);

    this.shoulderR.rotation.x = lerp(this.shoulderR.rotation.x, armR, k);
    this.shoulderL.rotation.x = lerp(this.shoulderL.rotation.x, armL, k);
    this.shoulderR.rotation.z = lerp(this.shoulderR.rotation.z, -spread, k);
    this.shoulderL.rotation.z = lerp(this.shoulderL.rotation.z, spread, k);
    this.elbowR.rotation.x = lerp(this.elbowR.rotation.x, elbowR, k);
    this.elbowL.rotation.x = lerp(this.elbowL.rotation.x, elbowL, k);

    const step = this.state === 'celebrate' ? Math.sin(this.stateTime * 6.2) * 0.25 : 0;
    this.hipR.rotation.x = lerp(this.hipR.rotation.x, step, k);
    this.hipL.rotation.x = lerp(this.hipL.rotation.x, -step, k);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
