import { LevelGenerator, TOTAL_LEVELS } from './LevelGenerator.js';
import type { LevelDef, ToolDef } from '../types.js';

export interface LevelOverridesFile {
  levels: Record<string, Partial<LevelDef>>;
}
export interface LevelFixesFile {
  fixes: Record<string, number>;
}

/**
 * Fournit les niveaux au jeu : generation deterministe, variantes corrigees par la
 * validation headless, puis remplacements manuels de `levels-overrides.json`.
 */
export class LevelManager {
  readonly generator: LevelGenerator;
  readonly total = TOTAL_LEVELS;
  readonly toolDefs: Map<string, ToolDef>;
  private readonly cache = new Map<number, LevelDef>();

  constructor(
    tools: ToolDef[],
    private readonly overrides: LevelOverridesFile = { levels: {} },
    private readonly fixes: LevelFixesFile = { fixes: {} },
  ) {
    this.generator = new LevelGenerator(tools);
    this.toolDefs = new Map(tools.map((t) => [t.id, t]));
  }

  clamp(level: number): number {
    if (!Number.isFinite(level)) return 1;
    return Math.min(this.total, Math.max(1, Math.floor(level)));
  }

  get(level: number): LevelDef {
    const n = this.clamp(level);
    const cached = this.cache.get(n);
    if (cached) return cached;

    const variant = this.fixes.fixes?.[String(n)] ?? 0;
    const generated = this.generator.generate(n, variant);
    const override = this.overrides.levels?.[String(n)];
    const def: LevelDef = override ? { ...generated, ...override, level: n } : generated;

    this.cache.set(n, def);
    return def;
  }

  /** Une page du selecteur de niveaux. */
  page(pageIndex: number, pageSize = 100): { level: number; isBoss: boolean; isTutorial: boolean }[] {
    const start = pageIndex * pageSize + 1;
    const out = [];
    for (let n = start; n < start + pageSize && n <= this.total; n++) {
      out.push({ level: n, isBoss: n % 50 === 0, isTutorial: (n - 1) % 10 === 0 });
    }
    return out;
  }
}
