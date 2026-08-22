/**
 * Validation headless des niveaux.
 *
 *   npm run validate-levels -- --from 1 --to 2500 [--variants 6] [--write]
 *
 * Pour chaque niveau, on rejoue plusieurs « tirs raisonnables » dans la meme
 * simulation que le jeu : visee balistique vers le torse, a differentes puissances,
 * et avec les memes corrections de visee qu'un joueur (lobs par-dessus un obstacle,
 * ecarts lateraux). Le niveau est declare finissable des qu'un de ces tirs suffit.
 * Sinon on re-tire la seed via une variante ; la variante retenue est ecrite dans
 * public/config/level-fixes.json et le bilan dans validation-report.json.
 *
 * Options : --from --to --variants --write --quiet --threshold-scale <n>
 * `--threshold-scale` permet de verifier que le jeu reste finissable au reglage
 * de difficulte le plus eleve.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initPhysics, FIXED_TIMESTEP } from '../src/core/PhysicsWorld.js';
import { Simulation } from '../src/core/Simulation.js';
import { LevelGenerator, TOTAL_LEVELS } from '../src/levels/LevelGenerator.js';
import { aimShot } from '../src/core/ballistics.js';
import type { LevelDef, ToolDef } from '../src/types.js';

const root = resolve(import.meta.dirname, '..');
const readJson = (p: string) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));

const toVec = (v: readonly number[]) => ({ x: v[0], y: v[1], z: v[2] });

const argv = process.argv.slice(2);
const arg = (name: string, fallback: number) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
};
const FROM = arg('from', 1);
const TO = Math.min(TOTAL_LEVELS, arg('to', TOTAL_LEVELS));
const MAX_VARIANTS = arg('variants', 6);
const WRITE = argv.includes('--write');
const QUIET = argv.includes('--quiet');

const THRESHOLD_SCALE = arg('threshold-scale', 1);
/**
 * Marge exigee pour declarer un niveau finissable. Un tir qui depasse le seuil
 * de quelques points seulement n'est pas reproductible au doigt : le moindre
 * ecart de dosage le fait echouer.
 */
const SAFETY_MARGIN = 1.15;

const MAX_STEPS = Math.round(9 / FIXED_TIMESTEP);

/**
 * Repertoire des gestes qu'un joueur peut reellement produire, exprime comme le
 * fait InputController : un glissement (dx, dy) en fraction de la diagonale de
 * reference. La puissance vient de la longueur du geste et le dosage de la cloche
 * de sa composante verticale : les deux ne sont donc pas independants, et tester
 * des couples impossibles ferait declarer finissables des niveaux qui ne le sont
 * pas au doigt.
 */
const DRAGS: { dx: number; dy: number }[] = [
  { dx: 0, dy: 0 },        // simple tap : tir tendu, puissance moyenne
  { dx: 0, dy: 0.35 },
  { dx: 0, dy: 0.55 },
  { dx: 0, dy: 0.72 },
  { dx: 0, dy: 0.88 },
  { dx: 0, dy: 1.05 },
  { dx: 0, dy: 1.4 },
  { dx: 0.3, dy: 0.7 },
  { dx: -0.3, dy: 0.7 },
  { dx: 0.55, dy: 0.2 },
];

/** Traduit un geste en (puissance, cloche, ecart) exactement comme le jeu. */
function shotFromDrag(drag: { dx: number; dy: number }): { power: number; lift: number; side: number } {
  const length = Math.hypot(drag.dx, drag.dy);
  // Sous le seuil de glissement, le jeu envoie un tir droit a puissance 0,8.
  if (length < 0.03) return { power: 0.8, lift: 0, side: 0 };
  return {
    power: Math.min(1, length),
    lift: Math.max(-1, Math.min(1, drag.dy)),
    side: Math.max(-1, Math.min(1, drag.dx)),
  };
}

interface Attempt {
  damage: number;
  threshold: number;
  power: number;
  steps: number;
}

function runAttempt(
  level: LevelDef,
  toolDefs: Map<string, ToolDef>,
  shot: { power: number; lift: number; side: number },
): Attempt {
  const power = shot.power;
  const sim = new Simulation(level, toolDefs, THRESHOLD_SCALE);
  const primary = sim.primaryTool;
  const target = level.targets[0];
  const aimAt: [number, number, number] = [target.position[0], target.position[1] + 1.25 * target.scale, target.position[2]];

  let dir = { x: 1, y: 0.2, z: 0 };
  let speedOverride: number | undefined;
  let needsHold = false;

  if (primary) {
    const def = primary.def;
    const from = primary.placed.position;
    if (def.category === 'throw' || def.category === 'fire') {
      const speed = def.category === 'fire'
        ? (def.muzzleSpeed ?? 25) * (0.55 + power * 0.65)
        : 11 + power * 17;
      // Meme chaine que le jeu : visee automatique, dosage de la cloche, ecart lateral.
      const solved = aimShot(toVec(from), toVec(aimAt), speed, level.gravity, shot.side, shot.lift);
      dir = solved.dir;
      speedOverride = solved.speed;
    } else if (def.category === 'hold') {
      needsHold = true;
    }
  }

  sim.setHeld(true);
  sim.activate(dir, power, sim.primaryTool, speedOverride);

  let steps = 0;
  let settleFrames = 0;
  for (; steps < MAX_STEPS; steps++) {
    // Les pieges secondaires se declenchent peu apres le tir principal, comme en jeu.
    if (steps === 18) sim.activateSecondary(dir, power);
    if (needsHold && steps === Math.round(3.2 / FIXED_TIMESTEP)) sim.setHeld(false);

    sim.step();
    if (sim.won) break;

    if (steps > 90 && sim.isSettled()) {
      if (++settleFrames > 30) break;
    } else {
      settleFrames = 0;
    }
  }

  const damage = sim.damage.total;
  sim.dispose();
  return { damage, threshold: level.damageThreshold * THRESHOLD_SCALE, power, steps };
}

async function main() {
  await initPhysics();

  const tools: ToolDef[] = readJson('public/config/tools.json').tools;
  const overrides = readJson('public/config/levels-overrides.json').levels ?? {};
  const generator = new LevelGenerator(tools);
  const toolDefs = new Map(tools.map((t) => [t.id, t]));

  const fixes: Record<string, number> = {};
  const caps: Record<string, number> = {};
  const failures: { level: number; best: number; threshold: number }[] = [];
  const capped: { level: number; best: number; threshold: number }[] = [];
  const ratios: number[] = [];
  const started = Date.now();
  let passed = 0;
  let needsSkill = 0;
  let withTrajectoryObstacle = 0;

  for (let n = FROM; n <= TO; n++) {
    if (overrides[String(n)]) {
      passed++;
      continue; // Niveau remplace manuellement : hors du perimetre de validation.
    }

    let ok = false;
    let best = 0;
    let bestVariant = 0;

    for (let variant = 0; variant < MAX_VARIANTS && !ok; variant++) {
      const level = generator.generate(n, variant);
      for (let i = 0; i < DRAGS.length; i++) {
        const shot = shotFromDrag(DRAGS[i]);
        const attempt = runAttempt(level, toolDefs, shot);
        if (attempt.damage > best) {
          best = attempt.damage;
          bestVariant = variant;
        }
        if (attempt.damage >= attempt.threshold * SAFETY_MARGIN) {
          ok = true;
          if (variant > 0) fixes[String(n)] = variant;
          ratios.push(attempt.damage / attempt.threshold);
          // Un tir direct ne suffisait pas : le niveau demande de l'adresse.
          if (shot.lift > 0 || shot.side !== 0) needsSkill++;
          if (level.obstacles.some((o) => o.kind === 'low_wall' || o.kind === 'canopy')) withTrajectoryObstacle++;
          break;
        }
      }
    }

    if (ok) passed++;
    else if (best > 0) {
      // Aucune variante ne convient : on ramene le seuil a ce qui est atteignable,
      // avec un peu de marge. Le niveau devient finissable par construction.
      const level = generator.generate(n, bestVariant);
      capped.push({ level: n, best: Math.round(best), threshold: level.damageThreshold });
      if (bestVariant > 0) fixes[String(n)] = bestVariant;
      caps[String(n)] = Math.floor(best * 0.88);
      passed++;
    } else {
      const level = generator.generate(n, bestVariant);
      failures.push({ level: n, best: 0, threshold: level.damageThreshold });
      if (bestVariant > 0) fixes[String(n)] = bestVariant;
    }

    if (!QUIET && n % 100 === 0) {
      const rate = (n - FROM + 1) / ((Date.now() - started) / 1000);
      process.stdout.write(
        `  ${n}/${TO} | reussis ${passed} | corriges ${Object.keys(fixes).length} | echecs ${failures.length} | ${rate.toFixed(1)} niv/s\n`,
      );
    }
  }

  const count = TO - FROM + 1;
  const mean = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
  const report = {
    generatedAt: new Date().toISOString(),
    range: { from: FROM, to: TO },
    total: count,
    passed,
    fixedBySeedVariant: Object.keys(fixes).length,
    thresholdCapped: capped.length,
    failed: failures.length,
    thresholdScale: THRESHOLD_SCALE,
    levelsWithTrajectoryObstacle: withTrajectoryObstacle,
    levelsRequiringAimCorrection: needsSkill,
    meanDamageOverThreshold: Number(mean.toFixed(3)),
    durationSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    failures: failures.slice(0, 100),
    cappedLevels: capped.slice(0, 50),
  };

  console.log('\n=== Rapport de validation ===');
  console.log(JSON.stringify({ ...report, failures: report.failures.slice(0, 10) }, null, 2));

  if (WRITE) {
    writeFileSync(
      resolve(root, 'public/config/level-fixes.json'),
      JSON.stringify(
        {
          _doc:
            'Genere par `npm run validate-levels`. `fixes` associe un niveau a une variante de seed lorsque la generation par defaut n\'etait pas finissable ; `caps` impose un seuil de degats aux rares niveaux qu\'aucune variante ne rend finissables. Ne pas editer a la main.',
          version: 1,
          fixes,
          caps,
        },
        null,
        2,
      ) + '\n',
    );
    writeFileSync(resolve(root, 'validation-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('\nEcrit : public/config/level-fixes.json, validation-report.json');
  } else {
    console.log('\n(dry-run : relancer avec --write pour enregistrer les correctifs)');
  }

  if (failures.length > count * 0.01) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
