/**
 * Validation headless des niveaux.
 *
 *   npm run validate-levels -- --from 1 --to 2500 [--variants 6] [--write]
 *
 * Pour chaque niveau, on rejoue un « tir raisonnable » (visee balistique vers le torse,
 * puissance realiste) dans la meme simulation que le jeu. Si le seuil de degats n'est
 * pas atteint, on re-tire la seed via une variante ; la variante retenue est ecrite
 * dans public/config/level-fixes.json et le bilan dans validation-report.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initPhysics, FIXED_TIMESTEP } from '../src/core/PhysicsWorld.js';
import { Simulation } from '../src/core/Simulation.js';
import { LevelGenerator, TOTAL_LEVELS } from '../src/levels/LevelGenerator.js';
import { ballisticDirection } from '../src/core/ballistics.js';
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

const MAX_STEPS = Math.round(9 / FIXED_TIMESTEP);
const POWERS = [0.85, 1.0, 0.65];

interface Attempt {
  damage: number;
  threshold: number;
  power: number;
  steps: number;
}

function runAttempt(level: LevelDef, toolDefs: Map<string, ToolDef>, power: number): Attempt {
  const sim = new Simulation(level, toolDefs);
  const primary = sim.primaryTool;
  const target = level.targets[0];
  const aimAt: [number, number, number] = [target.position[0], target.position[1] + 1.25 * target.scale, target.position[2]];

  let dir = { x: 1, y: 0.2, z: 0 };
  let needsHold = false;

  if (primary) {
    const def = primary.def;
    const from = primary.placed.position;
    if (def.category === 'throw') {
      dir = ballisticDirection(toVec(from), toVec(aimAt), 11 + power * 17, level.gravity);
    } else if (def.category === 'fire') {
      dir = ballisticDirection(toVec(from), toVec(aimAt), (def.muzzleSpeed ?? 25) * (0.55 + power * 0.65), level.gravity);
    } else if (def.category === 'hold') {
      needsHold = true;
    }
  }

  sim.setHeld(true);
  sim.activate(dir, power);

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
  return { damage, threshold: level.damageThreshold, power, steps };
}

async function main() {
  await initPhysics();

  const tools: ToolDef[] = readJson('public/config/tools.json').tools;
  const overrides = readJson('public/config/levels-overrides.json').levels ?? {};
  const generator = new LevelGenerator(tools);
  const toolDefs = new Map(tools.map((t) => [t.id, t]));

  const fixes: Record<string, number> = {};
  const failures: { level: number; best: number; threshold: number }[] = [];
  const ratios: number[] = [];
  const started = Date.now();
  let passed = 0;

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
      for (const power of POWERS) {
        const attempt = runAttempt(level, toolDefs, power);
        if (attempt.damage > best) {
          best = attempt.damage;
          bestVariant = variant;
        }
        if (attempt.damage >= attempt.threshold) {
          ok = true;
          if (variant > 0) fixes[String(n)] = variant;
          ratios.push(attempt.damage / attempt.threshold);
          break;
        }
      }
    }

    if (ok) passed++;
    else {
      const level = generator.generate(n, bestVariant);
      failures.push({ level: n, best: Math.round(best), threshold: level.damageThreshold });
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
    failed: failures.length,
    meanDamageOverThreshold: Number(mean.toFixed(3)),
    durationSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    failures: failures.slice(0, 100),
  };

  console.log('\n=== Rapport de validation ===');
  console.log(JSON.stringify({ ...report, failures: report.failures.slice(0, 10) }, null, 2));

  if (WRITE) {
    writeFileSync(
      resolve(root, 'public/config/level-fixes.json'),
      JSON.stringify(
        {
          _doc: 'Genere par `npm run validate-levels`. Associe un numero de niveau a un indice de variante de seed lorsque la generation par defaut n\'etait pas finissable. Ne pas editer a la main.',
          version: 1,
          fixes,
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
