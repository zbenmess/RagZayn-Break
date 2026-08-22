/** Types partages entre le jeu (navigateur) et la validation headless (Node). */

export type Vec3 = [number, number, number];

/* ------------------------------------------------------------------ Heros */

export interface HeroOutfitTop {
  type: 'tshirt' | 'longsleeve' | 'hoodie';
  color: string;
  sleeve: 'short' | 'long' | 'none';
  chestPrint: boolean;
  printColor: string;
}
export interface HeroOutfitBottom {
  type: 'shorts' | 'pants';
  color: string;
}
export interface HeroOutfitShoes {
  type: 'sneakers' | 'boots' | 'barefoot';
  color: string;
}

export interface HeroVoiceConfig {
  enabled: boolean;
  text: string;
  lang: string;
  preferredVoiceNames: string[];
  pitch: number;
  rate: number;
  volume: number;
  audioFile?: string;
}

export interface HeroConfig {
  name: string;
  age: number;
  skinTone: string;
  hairColor: string;
  hairStyle: 'short_textured' | 'short_flat' | 'curly' | 'buzz' | 'none';
  eyeColor: string;
  eyeShape: 'round_large' | 'round_small' | 'almond';
  expression: 'big_smile' | 'smile' | 'neutral' | 'excited';
  outfit: { top: HeroOutfitTop; bottom: HeroOutfitBottom; shoes: HeroOutfitShoes };
  accessories: string[];
  placement: { position: Vec3; rotationY: number; scale: number };
  voice: HeroVoiceConfig;
  ui: { winTitle: string };
}

/* ------------------------------------------------------------------ Outils */

export type ToolCategory = 'throw' | 'drop' | 'swing' | 'fire' | 'hold' | 'field';
export type ToolShape = 'sphere' | 'box' | 'cylinder';

export interface ToolFieldDef {
  type: 'wind' | 'shock' | 'beam';
  force: number;
  radius: number;
  dps?: number;
}

export interface ToolDef {
  id: string;
  label: string;
  category: ToolCategory;
  mass: number;
  size: Vec3;
  shape: ToolShape;
  color: string;
  accent: string;
  power: number;
  damageMultiplier: number;
  restitution: number;
  friction: number;
  order: number;
  muzzleSpeed?: number;
  /** Longueur du bras de levier des outils sur pivot (marteau). */
  armLength?: number;
  spin?: number;
  rollLaunch?: boolean;
  power_driven?: boolean;
  explosive?: { radius: number; impulse: number };
  field?: ToolFieldDef;
}

/* ----------------------------------------------------------------- Niveaux */

export interface TargetSpec {
  position: Vec3;
  scale: number;
  reinforced: boolean;
  /** Multiplicateur du seuil de rupture des articulations. */
  jointStrength: number;
}

export interface PlacedTool {
  id: string;
  primary: boolean;
  position: Vec3;
  /** Rotation autour de Z (radians), pour les outils orientables. */
  rotationZ: number;
  massScale: number;
  /** Vitesse initiale imposee (rouleau, canon deja arme...). */
  launchSpeed?: number;
  /** Angle de tir par defaut (fire), en radians. */
  aimAngle?: number;
}

export interface ObstacleSpec {
  /**
   * `low_wall` et `canopy` sont places entre le lanceur et la cible : le mur bas
   * oblige a lober, l'auvent limite la hauteur du lob. Ensemble ils forment une
   * fente a franchir. Les autres sont des obstacles de decor autour de la cible.
   */
  kind: 'wall' | 'pillar' | 'platform' | 'trampoline' | 'low_wall' | 'canopy';
  position: Vec3;
  size: Vec3;
  restitution: number;
}

export interface LevelDef {
  level: number;
  variant: number;
  tier: number;
  isBoss: boolean;
  isTutorial: boolean;
  gravity: number;
  damageThreshold: number;
  targets: TargetSpec[];
  tools: PlacedTool[];
  obstacles: ObstacleSpec[];
  label: string;
}

/* ------------------------------------------------------------------ Visuel */

export interface VisualDesc {
  shape: ToolShape | 'capsule';
  size: Vec3;
  color: string;
  accent?: string;
  role?: string;
}

/* --------------------------------------------------------------- Sauvegarde */

export interface SaveData {
  version: number;
  currentLevel: number;
  maxLevelReached: number;
  bestDamage: Record<string, number>;
  settings: {
    sound: boolean;
    voice: boolean;
    haptics: boolean;
    quality: 'auto' | 'high' | 'low';
    /** Multiplie le seuil de degats de chaque niveau. */
    difficulty: Difficulty;
  };
}

export type Difficulty = 'facile' | 'normal' | 'difficile';

/** Facteurs appliques au seuil de degats selon le reglage choisi. */
export const DIFFICULTY_SCALE: Record<Difficulty, number> = {
  facile: 0.7,
  normal: 1,
  difficile: 1.35,
};

/**
 * Aide a la visee selon la difficulte : 1 vise automatiquement le mannequin,
 * 0 laisse le joueur viser entierement lui-meme (angle et puissance).
 */
export const AIM_ASSIST: Record<Difficulty, number> = {
  facile: 1,
  normal: 0.4,
  difficile: 0,
};


