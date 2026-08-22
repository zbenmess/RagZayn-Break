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

/** Angle maximal d'une cloche : au-dela le projectile monte trop et le tir traine. */
const MAX_LOB_ANGLE = 1.16; // ~66 degres

export interface Shot {
  dir: Vec;
  speed: number;
}

/**
 * Tir complet produit par le geste du joueur : direction *et* vitesse.
 *
 * Un glissement vers le haut redresse progressivement le depart, jusqu'a une
 * vraie cloche. La vitesse est alors recalculee pour que le projectile retombe
 * quand meme sur le mannequin : sans cela, sur quelques metres, la solution haute
 * partirait presque a la verticale et mettrait six secondes a redescendre.
 * Le glissement lateral reste un ecart libre, et un geste vers le bas rabat le tir.
 */
export function aimShot(
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

  // Vitesse necessaire pour atteindre la cible sous cet angle.
  const c = Math.cos(angle);
  const reach = d * Math.tan(angle) - h;
  const speed = reach > 0.05 && c > 0.05
    ? Math.min(40, Math.max(4, Math.sqrt((g * d * d) / (2 * c * c * reach))))
    : baseSpeed;

  const hx = dx / d;
  const hz = dz / d;
  const dir = { x: hx * c, y: Math.sin(angle), z: hz * c };
  return { dir: applyAimOffset(dir, swipeX, 0), speed };
}
