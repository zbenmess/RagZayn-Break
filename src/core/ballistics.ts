/** Resolution balistique partagee par le jeu, le calibrage et la validation. */
export interface Vec {
  x: number;
  y: number;
  z: number;
}

export function normalize(v: Vec): Vec {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

export function cross(a: Vec, b: Vec): Vec {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/**
 * Direction de tir (unitaire) atteignant `to` depuis `from` a la vitesse donnee.
 *
 * Le probleme balistique admet deux solutions : la trajectoire *tendue*, rapide et
 * rasante, et la trajectoire *en cloche*, qui monte puis retombe sur la cible.
 * La seconde est indispensable pour passer au-dessus d'un obstacle : sur quelques
 * metres a pleine vitesse, une simple correction de visee ferait passer le
 * projectile au-dessus du mur mais aussi au-dessus de la cible.
 * Si la cible est hors de portee, on vise simplement dans sa direction.
 */
export function ballisticDirection(
  from: Vec,
  to: Vec,
  speed: number,
  gravity: number,
  arc: 'flat' | 'high' = 'flat',
): Vec {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  const h = to.y - from.y;
  const g = Math.abs(gravity);
  const v2 = speed * speed;
  const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);

  const angle = disc < 0 || d < 1e-3
    ? Math.atan2(h, Math.max(d, 0.001))
    : Math.atan((v2 + (arc === 'high' ? Math.sqrt(disc) : -Math.sqrt(disc))) / (g * d));

  const c = Math.cos(angle);
  const hx = d < 1e-3 ? 1 : dx / d;
  const hz = d < 1e-3 ? 0 : dz / d;
  return { x: hx * c, y: Math.sin(angle), z: hz * c };
}

/**
 * Applique l'ecart du joueur autour d'une direction de reference, sans jamais
 * l'inverser. Un simple tap tire donc droit sur la cible.
 */
export function applyAimOffset(base: Vec, swipeX: number, swipeY: number, spread = 0.5): Vec {
  const worldUp = { x: 0, y: 1, z: 0 };
  const right = normalize(cross(base, worldUp));
  const up = normalize(cross(right, base));
  return normalize({
    x: base.x + right.x * swipeX * spread + up.x * swipeY * spread,
    y: base.y + right.y * swipeX * spread + up.y * swipeY * spread,
    z: base.z + right.z * swipeX * spread + up.z * swipeY * spread,
  });
}

/** Angle maximal d'une cloche assistee : au-dela le projectile monte trop. */
const MAX_LOB_ANGLE = 1.16; // ~66 degres

/** Bornes de vitesse en visee libre : le joueur dose lui-meme avec la longueur du geste. */
const FREE_SPEED_MIN = 8;
const FREE_SPEED_MAX = 30;
/** Angles autorises en visee libre : un peu vers le bas, presque a la verticale. */
const FREE_ANGLE_MIN = -0.3;
const FREE_ANGLE_MAX = 1.72;

export interface Shot {
  dir: Vec;
  speed: number;
}

/**
 * Tir vise entierement par le joueur : la *direction* du geste donne l'angle de
 * depart, sa *longueur* donne la vitesse. Rien n'est corrige, on peut donc rater.
 *
 * Le tir reste dans le plan vertical qui relie le lanceur a la cible : c'est ce
 * plan que la camera montre de face, si bien qu'un geste vers le haut a l'ecran
 * fait monter le projectile a l'ecran.
 */
function freeShot(from: Vec, to: Vec, swipeX: number, swipeY: number, power: number): Shot {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz) || 1;

  const raw = Math.atan2(swipeY, swipeX);
  const angle = Math.max(FREE_ANGLE_MIN, Math.min(FREE_ANGLE_MAX, raw));
  const c = Math.cos(angle);

  return {
    dir: { x: (dx / d) * c, y: Math.sin(angle), z: (dz / d) * c },
    speed: FREE_SPEED_MIN + Math.min(1, power) * (FREE_SPEED_MAX - FREE_SPEED_MIN),
  };
}

/**
 * Tir assiste : la visee vise automatiquement le mannequin, et le glissement vers
 * le haut dose une cloche dont la vitesse est recalculee pour retomber sur la
 * cible. C'est ce qui permet de franchir un obstacle sans savoir viser.
 */
function assistedShot(
  from: Vec,
  to: Vec,
  baseSpeed: number,
  gravity: number,
  swipeX: number,
  swipeY: number,
): Shot {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  const h = to.y - from.y;
  const g = Math.abs(gravity);

  const flat = ballisticDirection(from, to, baseSpeed, gravity, 'flat');
  const lift = Math.max(0, Math.min(1, swipeY));
  if (lift <= 0 || d < 0.2) {
    return { dir: applyAimOffset(flat, swipeX, Math.min(0, swipeY)), speed: baseSpeed };
  }

  const flatAngle = Math.asin(Math.max(-1, Math.min(1, flat.y)));
  const angle = flatAngle + (MAX_LOB_ANGLE - flatAngle) * lift;

  const c = Math.cos(angle);
  const reach = d * Math.tan(angle) - h;
  const speed = reach > 0.05 && c > 0.05
    ? Math.min(40, Math.max(4, Math.sqrt((g * d * d) / (2 * c * c * reach))))
    : baseSpeed;

  const dir = { x: (dx / d) * c, y: Math.sin(angle), z: (dz / d) * c };
  return { dir: applyAimOffset(dir, swipeX, 0), speed };
}

/**
 * Tir final, melange des deux modes selon l'aide a la visee.
 *
 * `assist` vaut 1 pour une visee entierement automatique (un simple appui touche
 * la cible), 0 pour une visee entierement libre ou le joueur choisit lui-meme
 * l'angle et la puissance, et une valeur intermediaire pour un guidage partiel.
 */
export function aimShot(
  from: Vec,
  to: Vec,
  baseSpeed: number,
  gravity: number,
  swipeX: number,
  swipeY: number,
  assist = 1,
): Shot {
  const assisted = assistedShot(from, to, baseSpeed, gravity, swipeX, swipeY);
  if (assist >= 0.999) return assisted;

  const free = freeShot(from, to, swipeX, swipeY, Math.hypot(swipeX, swipeY));
  if (assist <= 0.001) return free;

  const mix = (a: number, b: number) => a + (b - a) * assist;
  return {
    dir: normalize({
      x: mix(free.dir.x, assisted.dir.x),
      y: mix(free.dir.y, assisted.dir.y),
      z: mix(free.dir.z, assisted.dir.z),
    }),
    speed: mix(free.speed, assisted.speed),
  };
}
