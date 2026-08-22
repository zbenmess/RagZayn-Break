import { readFileSync } from 'node:fs';
import { initPhysics, FIXED_TIMESTEP } from '../src/core/PhysicsWorld.js';
import { Simulation } from '../src/core/Simulation.js';
import { LevelManager } from '../src/levels/LevelManager.js';
import { ballisticDirection } from '../src/core/ballistics.js';
import type { ToolDef } from '../src/types.js';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

async function main() {
  await initPhysics();
  const tools: ToolDef[] = read('public/config/tools.json').tools;
  const levels = new LevelManager(tools, read('public/config/levels-overrides.json'), read('public/config/level-fixes.json'));

  console.log('Niv | outils                          | verbe  | seuil |  obtenu | membres | verdict');
  console.log('----+---------------------------------+--------+-------+---------+---------+--------');
  let ok = 0;
  for (let n = 1; n <= 20; n++) {
    const level = levels.get(n);
    const sim = new Simulation(level, levels.toolDefs);
    const primary = sim.primaryTool!;
    const t = level.targets[0];
    const aim = { x: t.position[0], y: t.position[1] + 1.25 * t.scale, z: t.position[2] };
    const from = { x: primary.placed.position[0], y: primary.placed.position[1], z: primary.placed.position[2] };
    const speed = primary.def.category === 'fire'
      ? (primary.def.muzzleSpeed ?? 25) * (0.55 + 0.8 * 0.65)
      : 11 + 0.8 * 17;
    // Tir « au doigt mouille » : simple tap, visee automatique, aucune correction.
    const dir = ballisticDirection(from, aim, speed, level.gravity);

    sim.setHeld(true);
    sim.activate(dir, 0.8);
    let settle = 0;
    for (let i = 0; i < Math.round(9 / FIXED_TIMESTEP); i++) {
      if (i === 18) sim.activateSecondary(dir, 0.8);
      if (i === Math.round(3.2 / FIXED_TIMESTEP)) sim.setHeld(false);
      sim.step();
      if (sim.won) break;
      if (i > 90 && sim.isSettled()) { if (++settle > 30) break; } else settle = 0;
    }
    const won = sim.won;
    if (won) ok++;
    console.log(
      `${String(n).padStart(3)} | ${level.tools.map((x) => x.id).join('+').padEnd(31)} | ${primary.verb.padEnd(6)} | ${String(level.damageThreshold).padStart(5)} | ${String(Math.round(sim.damage.total)).padStart(7)} | ${String(sim.damage.limbsDetached).padStart(7)} | ${won ? 'OK' : 'ECHEC'}`,
    );
    sim.dispose();
  }
  console.log(`\n${ok}/20 niveaux termines avec un simple tap (visee automatique).`);
}
main();
