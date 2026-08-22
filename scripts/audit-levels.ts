/**
 * Audit structurel du generateur de niveaux.
 *
 *   npm run audit-levels
 *
 * Verifie sur les 2500 niveaux : presence d'un outil interactif principal,
 * respect des regles « tutoriel tous les 10 » et « boss tous les 50 »,
 * validite des seuils et des cibles, repartition des outils, determinisme.
 * Complementaire de `validate-levels`, qui teste la jouabilite reelle.
 */
import { readFileSync } from 'node:fs';
import { LevelManager } from '../src/levels/LevelManager.js';
import type { ToolDef } from '../src/types.js';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const tools: ToolDef[] = read('public/config/tools.json').tools;
const lm = new LevelManager(tools, read('public/config/levels-overrides.json'), read('public/config/level-fixes.json'));

const asPrimary = new Map<string, number>();
const asAny = new Map<string, number>();
let noInteractive = 0, tutoWrong = 0, bossWrong = 0, thresholdBad = 0, targetsBad = 0;
const interactive = new Set(tools.filter((t) => t.category !== 'field').map((t) => t.id));

for (let n = 1; n <= 2500; n++) {
  const lv = lm.get(n);
  const primary = lv.tools.find((t) => t.primary);
  if (!primary || !interactive.has(primary.id)) noInteractive++;
  if (primary) asPrimary.set(primary.id, (asPrimary.get(primary.id) ?? 0) + 1);
  for (const t of lv.tools) asAny.set(t.id, (asAny.get(t.id) ?? 0) + 1);

  const isTuto = (n - 1) % 10 === 0;
  if (lv.isTutorial !== isTuto) tutoWrong++;
  // Un niveau tutoriel presente un seul outil (deux si l'outil du jour est un decor).
  if (isTuto && lv.tools.length > 2) tutoWrong++;
  if (lv.isBoss !== (n % 50 === 0)) bossWrong++;
  if (!(lv.damageThreshold > 0) || !Number.isFinite(lv.damageThreshold)) thresholdBad++;
  if (lv.targets.length < 1 || lv.targets.some((t) => !Number.isFinite(t.position[0]))) targetsBad++;
}

console.log('niveaux sans outil interactif principal :', noInteractive);
console.log('regle "tutoriel tous les 10" violee     :', tutoWrong);
console.log('regle "boss tous les 50" violee         :', bossWrong);
console.log('seuils invalides                        :', thresholdBad);
console.log('cibles invalides                        :', targetsBad);

console.log('\noutil            | principal | present');
for (const t of tools) {
  console.log(`${t.id.padEnd(16)} | ${String(asPrimary.get(t.id) ?? 0).padStart(9)} | ${String(asAny.get(t.id) ?? 0).padStart(7)}`);
}
const jamais = tools.filter((t) => t.category !== 'field' && !asPrimary.has(t.id));
console.log('\noutils jamais principaux :', jamais.length ? jamais.map((t) => t.id).join(', ') : 'aucun');

// Determinisme : deux generations independantes doivent coincider
const a = new LevelManager(tools, read('public/config/levels-overrides.json'), read('public/config/level-fixes.json'));
const b = new LevelManager(tools, read('public/config/levels-overrides.json'), read('public/config/level-fixes.json'));
let diff = 0;
for (const n of [1, 7, 137, 999, 1500, 2499]) if (JSON.stringify(a.get(n)) !== JSON.stringify(b.get(n))) diff++;
console.log('generations divergentes  :', diff);
