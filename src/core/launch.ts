import type { Vec3 } from '../types.js';

/**
 * Point de depart des projectiles lances a la main, en coordonnees monde :
 * la main de Zayn au repos.
 *
 * Cette constante est la seule source de verite, volontairement placee dans un
 * module sans dependance au rendu pour que le generateur de niveaux (qui tourne
 * aussi dans Node) et le jeu la partagent. Les deux avaient deja diverge deux
 * fois en etant declarees separement, et la validation simulait alors une
 * trajectoire qui n'etait pas celle du jeu.
 */
export const HERO_HAND: Vec3 = [-0.85, 0.24, 2.99];
