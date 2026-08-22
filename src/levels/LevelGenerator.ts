import { Rng, levelSeed } from './rng.js';
import type { LevelDef, ObstacleSpec, PlacedTool, TargetSpec, ToolDef } from '../types.js';
import { HERO_HAND } from '../core/launch.js';

export const TOTAL_LEVELS = 2500;

/**
 * Facteur de conversion entre la `power` calibree d'un outil (en milliers de points)
 * et des degats bruts. Voir `npm run calibrate-tools`.
 */
export const DAMAGE_BASE = 1000;

/** Nombre de niveaux entre deux introductions d'outil (niveau tutoriel : un seul outil). */
const TUTORIAL_STEP = 10;
/** Un boss tous les N niveaux. */
const BOSS_STEP = 50;
/** Taille d'un palier de difficulte. */
const TIER_SIZE = 100;
/** Premier niveau pouvant comporter un obstacle sur la trajectoire. */
export const TRAJECTORY_FROM_LEVEL = 25;

export class LevelGenerator {
  private readonly tools: ToolDef[];
  private readonly byCategory: Map<string, ToolDef[]>;

  constructor(tools: ToolDef[]) {
    // L'ordre d'introduction est porte par `order` : il pilote le deverrouillage.
    this.tools = tools.slice().sort((a, b) => a.order - b.order);
    this.byCategory = new Map();
    for (const t of this.tools) {
      const list = this.byCategory.get(t.category) ?? [];
      list.push(t);
      this.byCategory.set(t.category, list);
    }
  }

  get toolCount(): number {
    return this.tools.length;
  }

  /** Nombre d'outils disponibles au niveau donne (un nouvel outil tous les 10 niveaux). */
  unlockedCount(level: number): number {
    return Math.min(this.tools.length, Math.floor((level - 1) / TUTORIAL_STEP) + 1);
  }

  /** Outil mis en avant lors d'un niveau tutoriel. */
  featuredTool(level: number): ToolDef {
    const step = Math.floor((level - 1) / TUTORIAL_STEP);
    const index = step < this.tools.length ? step : step % this.tools.length;
    return this.tools[index];
  }

  /**
   * Genere le niveau `level` de facon deterministe.
   * `variant` permet de re-tirer une seed lorsque la validation headless juge le niveau infaisable.
   */
  generate(level: number, variant = 0): LevelDef {
    const rng = new Rng(levelSeed(level, variant));
    const tier = Math.floor((level - 1) / TIER_SIZE);
    const tierRatio = Math.min(1, tier / 24);
    const isTutorial = (level - 1) % TUTORIAL_STEP === 0;
    const isBoss = level % BOSS_STEP === 0;

    /* ------------------------------------------------------------ Cibles */
    const targetX = rng.range(-0.5, 0.5) + tierRatio * rng.range(-0.7, 0.9);
    const targetZ = rng.range(-0.35, 0.35);
    const targets: TargetSpec[] = [];
    const doubleTarget = isBoss && rng.chance(0.5);

    if (doubleTarget) {
      targets.push(
        { position: [targetX - 0.75, 0, targetZ - 0.2], scale: 1, reinforced: false, jointStrength: 1.15 },
        { position: [targetX + 0.75, 0, targetZ + 0.2], scale: 1, reinforced: false, jointStrength: 1.15 },
      );
    } else {
      targets.push({
        position: [targetX, 0, targetZ],
        scale: isBoss ? 1.25 : rng.range(0.94, 1.06),
        reinforced: isBoss,
        jointStrength: isBoss ? 2.1 : 1 + tierRatio * 0.55,
      });
    }

    /* ------------------------------------------------------------- Outils */
    const unlocked = this.tools.slice(0, this.unlockedCount(level));
    const interactive = unlocked.filter((t) => t.category !== 'field');
    const placed: PlacedTool[] = [];

    let primaryDef: ToolDef;
    let featuredField: ToolDef | null = null;
    if (isTutorial) {
      const featured = this.featuredTool(level);
      if (featured.category === 'field') {
        // Un element de decor ne se declenche pas : on le presente avec le projectile de base.
        featuredField = featured;
        primaryDef = interactive[0];
      } else {
        primaryDef = featured;
      }
    } else {
      // Le boss favorise les outils lourds : on tire deux fois et on garde le plus puissant.
      const a = rng.pick(interactive);
      const b = rng.pick(interactive);
      primaryDef = isBoss ? (a.power >= b.power ? a : b) : a;
    }
    placed.push(this.place(primaryDef, true, targets[0], rng, tierRatio));

    if (featuredField) placed.push(this.place(featuredField, false, targets[0], rng, tierRatio));

    // Niveau « un seul tir, un obstacle a franchir » : on renonce alors aux pieges
    // secondaires, sinon un objet largue d'en haut passerait par-dessus le mur et
    // rendrait l'obstacle sans effet.
    const isShot = primaryDef.category === 'throw' || primaryDef.category === 'fire';
    const wantsObstacle =
      !isTutorial && level >= TRAJECTORY_FROM_LEVEL && isShot && rng.chance(0.44 + tierRatio * 0.4);

    if (!isTutorial && !wantsObstacle) {
      const extraChance = 0.22 + tierRatio * 0.45;
      const pool = rng.shuffle(unlocked.filter((t) => t.id !== primaryDef.id));
      const extras = Math.min(pool.length, (rng.chance(extraChance) ? 1 : 0) + (rng.chance(extraChance * 0.5) ? 1 : 0));
      for (let i = 0; i < extras; i++) {
        placed.push(this.place(pool[i], false, targets[0], rng, tierRatio));
      }
    }

    /* ---------------------------------------------------------- Obstacles */
    const obstacles: ObstacleSpec[] = wantsObstacle
      ? this.trajectoryObstacles(placed[0], targets[0], rng, tierRatio)
      : [];
    if (!isTutorial && rng.chance(0.18 + tierRatio * 0.3)) {
      const kind = rng.pick(['wall', 'pillar', 'platform'] as const);
      const side = rng.chance(0.5) ? -1 : 1;
      if (kind === 'wall') {
        obstacles.push({
          kind: 'wall',
          position: [targetX + side * rng.range(1.6, 2.6), 1.2, targetZ],
          size: [0.28, 2.4, 2.2],
          restitution: 0.35,
        });
      } else if (kind === 'pillar') {
        obstacles.push({
          kind: 'pillar',
          position: [targetX + side * rng.range(1.1, 1.9), 0.9, targetZ + rng.range(-0.5, 0.5)],
          size: [0.32, 1.8, 0.32],
          restitution: 0.2,
        });
      } else {
        obstacles.push({
          kind: 'platform',
          position: [targetX, rng.range(0.35, 0.6), targetZ],
          size: [1.9, 0.22, 1.6],
          restitution: 0.15,
        });
      }
    }
    if (placed.some((p) => p.id === 'trampoline_wall')) {
      obstacles.push({
        kind: 'wall',
        position: [targetX + 2.9, 1.5, targetZ],
        size: [0.3, 3.0, 2.6],
        restitution: 0.55,
      });
    }

    /* ------------------------------------------------------------- Seuil */
    // `power` est calibre par `npm run calibrate-tools` : c'est le score median
    // (en milliers de points) d'un tir raisonnable avec cet outil. Le multiplicateur
    // de degats y est deja inclus, il ne doit donc pas etre recompte ici.
    const expected = placed.reduce((sum, p) => {
      const def = this.def(p.id);
      const weight = p.primary ? 1 : 0.35;
      return sum + def.power * Math.sqrt(p.massScale) * weight;
    }, 0);

    let difficulty = 0.38 + tierRatio * 0.4;
    if (isTutorial) difficulty *= 0.72;
    if (isBoss) difficulty *= 1.25;
    // Les tout premiers niveaux doivent tomber du premier coup, meme pour un tout-petit.
    if (level <= 30) difficulty *= 0.62 + (level / 30) * 0.3;
    const targetsFactor = targets.length > 1 ? 1.45 : 1;

    const damageThreshold = Math.round(expected * DAMAGE_BASE * difficulty * targetsFactor);

    return {
      level,
      variant,
      tier,
      isBoss,
      isTutorial,
      gravity: -9.81 * rng.range(0.9, 1.12),
      damageThreshold,
      targets,
      tools: placed,
      obstacles,
      label: isBoss ? 'Boss' : isTutorial ? `Nouveau : ${(featuredField ?? primaryDef).label}` : primaryDef.label,
    };
  }

  /**
   * Obstacles places entre le lanceur et la cible. Ils ne concernent que les tirs
   * (projectiles et canons) : un objet largue d'en haut passerait au-dessus.
   * Le mur bas oblige a lober par-dessus ; l'auvent plafonne le lob. Les deux
   * ensemble laissent une fente qu'il faut viser.
   */
  private trajectoryObstacles(
    launcher: PlacedTool,
    target: TargetSpec,
    rng: Rng,
    tierRatio: number,
  ): ObstacleSpec[] {
    const [tx, , tz] = target.position;
    const aimY = 1.25 * target.scale;
    const [, oy, oz] = launcher.position;

    const z = tz + rng.range(1.1, 1.9);
    const x = tx + rng.range(-0.25, 0.25);

    // Hauteur du tir direct au droit de l'obstacle. Le mur depasse cette ligne :
    // le tir tendu est donc bloque a coup sur, et il faut lober pour passer.
    const span = oz - tz;
    const progress = span > 0.1 ? Math.min(1, Math.max(0, (oz - z) / span)) : 0.5;
    const lineY = oy + (aimY - oy) * progress;
    const margin = 0.32 + tierRatio * 0.75 + rng.range(0, 0.22);
    const wallHeight = Math.max(0.6, lineY + margin);

    const out: ObstacleSpec[] = [
      {
        kind: 'low_wall',
        position: [x, wallHeight / 2, z],
        size: [3.6, wallHeight, 0.22],
        restitution: 0.25,
      },
    ];

    // Au-dela du premier palier, une fente : l'auvent plafonne le lob et il faut
    // faire passer le projectile dans l'intervalle.
    if (tierRatio > 0.04 && rng.chance(0.32 + tierRatio * 0.45)) {
      const slot = 1.45 - tierRatio * 0.5 + rng.range(-0.08, 0.15);
      out.push({
        kind: 'canopy',
        position: [x, wallHeight + slot + 0.14, z],
        size: [3.6, 0.28, 1.0],
        restitution: 0.2,
      });
    }
    return out;
  }

  def(id: string): ToolDef {
    const found = this.tools.find((t) => t.id === id);
    if (!found) throw new Error(`Outil inconnu : ${id}`);
    return found;
  }

  /** Positionne un outil selon sa categorie, autour de la cible principale. */
  private place(def: ToolDef, primary: boolean, target: TargetSpec, rng: Rng, tierRatio: number): PlacedTool {
    const [tx, , tz] = target.position;
    const massScale = rng.range(0.85, 1.15 + tierRatio * 0.35);
    const base: PlacedTool = {
      id: def.id,
      primary,
      position: [tx, 0, tz],
      rotationZ: 0,
      massScale,
    };

    switch (def.category) {
      case 'throw':
        // Lance depuis la main du heros : constante partagee avec le jeu.
        base.position = [...HERO_HAND];
        break;
      case 'drop':
        base.position = [tx + rng.range(-0.35, 0.35), rng.range(3.4, 4.5) + tierRatio * 1.1, tz + rng.range(-0.25, 0.25)];
        if (def.rollLaunch) {
          base.position = [tx - rng.range(5.5, 7.5), 0.85, tz];
          base.launchSpeed = rng.range(9, 13) + tierRatio * 4;
        }
        break;
      case 'swing': {
        // Le pivot est place a une longueur de bras de la cible : la tete du marteau
        // balaie exactement le torse en passant a l'horizontale.
        const arm = def.armLength ?? 1.5;
        base.position = [tx - arm, 1.3 + rng.range(-0.1, 0.2), tz + rng.range(-0.1, 0.1)];
        base.rotationZ = rng.range(0.75, 1.25);
        break;
      }
      case 'fire':
        base.position = [-1.6, rng.range(0.75, 1.25), tz + rng.range(1.6, 2.6)];
        base.aimAngle = rng.range(0.12, 0.42);
        base.launchSpeed = (def.muzzleSpeed ?? 25) * rng.range(0.9, 1.1);
        break;
      case 'hold':
        if (def.field?.type === 'wind') base.position = [tx - rng.range(2.6, 3.4), rng.range(1.1, 1.7), tz];
        else if (def.field?.type === 'beam') base.position = [tx + rng.range(-0.3, 0.3), rng.range(3.4, 4.1), tz];
        else base.position = [tx, 0.08, tz];
        break;
      case 'field':
        base.position = [tx + rng.range(1.2, 2.0), 0.12, tz];
        break;
    }
    return base;
  }
}
