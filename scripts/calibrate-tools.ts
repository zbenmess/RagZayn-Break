/**
 * Calibrage de la puissance des outils.
 *
 *   npm run calibrate-tools -- [--samples 14] [--write]
 *
 * Chaque outil est teste seul, sur une cible standard, avec un tir raisonnable
 * repete sur plusieurs placements. La mediane des degats devient sa `power`
 * (exprimee en milliers de points), ce qui rend les seuils du generateur
 * comparables d'un outil a l'autre.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initPhysics, FIXED_TIMESTEP } from '../src/core/PhysicsWorld.js';
import { Simulation } from '../src/core/Simulation.js';
import { LevelGenerator, DAMAGE_BASE } from '../src/levels/LevelGenerator.js';
import { ballisticDirection } from '../src/core/ballistics.js';
import { Rng } from '../src/levels/rng.js';
import type { LevelDef, ToolDef } from '../src/types.js';

const root = resolve(import.meta.dirname, '..');
const toVec = (v: readonly number[]) => ({ x: v[0], y: v[1], z: v[2] });

const argv = process.argv.slice(2);
const SAMPLES = argv.includes('--samples') ? Number(argv[argv.indexOf('--samples') + 1]) : 14;
const WRITE = argv.includes('--write');

async function main() {
  await initPhysics();
  const file = JSON.parse(readFileSync(resolve(root, 'public/config/tools.json'), 'utf8'));
  const tools: ToolDef[] = file.tools;
  const defs = new Map(tools.map((t) => [t.id, t]));
  const generator = new LevelGenerator(tools);

  const results: { id: string; median: number; power: number }[] = [];

  for (const def of tools) {
    if (def.category === 'field') {
      results.push({ id: def.id, median: 0, power: def.power });
      continue;
    }
    const samples: number[] = [];

    for (let s = 0; s < SAMPLES; s++) {
      const rng = new Rng(1000 + s * 37);
      // Niveau etalon : un seul outil, cible standard, aucun obstacle.
      const probe = generator.generate(1 + s * 7, s);
      const level: LevelDef = {
        ...probe,
        level: 0,
        gravity: -9.81,
        obstacles: [],
        targets: [{ position: [rng.range(-0.4, 0.4), 0, rng.range(-0.3, 0.3)], scale: 1, reinforced: false, jointStrength: 1 }],
        tools: [],
        damageThreshold: 0,
      };
      // On reutilise le placement du generateur pour cet outil precis.
      const placedSample = generator.generate(1 + s * 7, s);
      const placed = { ...placedSample.tools[0], id: def.id, primary: true, massScale: 1 };
      const rebuilt = new LevelGenerator([def]).generate(1 + s * 7, s);
      level.tools = [{ ...rebuilt.tools[0], massScale: 1 }];
      void placed;

      const sim = new Simulation(level, defs);
      const target = level.targets[0];
      const aim: number[] = [target.position[0], 1.25, target.position[2]];
      const primary = sim.primaryTool!;
      let dir = { x: 1, y: 0.15, z: 0 };
      if (def.category === 'throw') dir = ballisticDirection(toVec(primary.placed.position), toVec(aim), 11 + 0.85 * 17, level.gravity);
      else if (def.category === 'fire') dir = ballisticDirection(toVec(primary.placed.position), toVec(aim), (def.muzzleSpeed ?? 25) * (0.55 + 0.85 * 0.65), level.gravity);

      sim.setHeld(true);
      sim.activate(dir, 0.85);
      const maxSteps = Math.round(9 / FIXED_TIMESTEP);
      let settle = 0;
      for (let i = 0; i < maxSteps; i++) {
        if (def.category === 'hold' && i === Math.round(3.2 / FIXED_TIMESTEP)) sim.setHeld(false);
        sim.step();
        if (i > 120 && sim.isSettled()) { if (++settle > 30) break; } else settle = 0;
      }
      samples.push(sim.damage.total);
      sim.dispose();
    }

    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    results.push({ id: def.id, median, power: Number((median / DAMAGE_BASE).toFixed(2)) });
  }

  console.log('outil'.padEnd(18), 'degats median'.padStart(14), 'power'.padStart(8));
  for (const r of results) {
    console.log(r.id.padEnd(18), String(Math.round(r.median)).padStart(14), String(r.power).padStart(8));
  }

  if (WRITE) {
    let raw = readFileSync(resolve(root, 'public/config/tools.json'), 'utf8');
    for (const r of results) {
      if (r.median === 0) continue;
      const def = defs.get(r.id)!;
      raw = raw.replace(
        new RegExp(`("id": "${r.id}"[\\s\\S]*?"power": )[0-9.]+`),
        `$1${Math.max(0.2, r.power)}`,
      );
      void def;
    }
    writeFileSync(resolve(root, 'public/config/tools.json'), raw);
    JSON.parse(readFileSync(resolve(root, 'public/config/tools.json'), 'utf8'));
    console.log('\ntools.json mis a jour (champ power).');
  } else {
    console.log('\n(dry-run : relancer avec --write)');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
