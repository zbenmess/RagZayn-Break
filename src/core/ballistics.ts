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
 * Direction de tir (unitaire) permettant d'atteindre `to` depuis `from` a la
 * vitesse donnee. On retient la trajectoire tendue ; si la cible est hors de
 * portee, on vise simplement dans sa direction.
 */
export function ballisticDirection(from: Vec, to: Vec, speed: number, gravity: number): Vec {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  const h = to.y - from.y;
  const g = Math.abs(gravity);
  const v2 = speed * speed;
  const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);

  const angle = disc < 0 || d < 1e-3
    ? Math.atan2(h, Math.max(d, 0.001))
    : Math.atan((v2 - Math.sqrt(disc)) / (g * d));

  const c = Math.cos(angle);
  const hx = d < 1e-3 ? 1 : dx / d;
  const hz = d < 1e-3 ? 0 : dz / d;
  return { x: hx * c, y: Math.sin(angle), z: hz * c };
}

/**
 * Applique la correction du joueur : le glissement ecarte le tir de la visee
 * automatique, sans jamais l'inverser. Un simple tap tire donc droit sur la cible.
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
