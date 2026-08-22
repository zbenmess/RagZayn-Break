import type { SaveData } from '../types.js';

const KEY = 'ragzayn-break.save.v1';

const DEFAULTS: SaveData = {
  version: 1,
  currentLevel: 1,
  maxLevelReached: 1,
  bestDamage: {},
  settings: { sound: true, voice: true, haptics: true, quality: 'auto' },
};

/** Progression locale : aucun compte, aucun reseau, tout reste sur l'iPhone. */
export class SaveManager {
  private data: SaveData;

  constructor() {
    this.data = this.load();
  }

  private load(): SaveData {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULTS);
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      return {
        ...structuredClone(DEFAULTS),
        ...parsed,
        settings: { ...DEFAULTS.settings, ...(parsed.settings ?? {}) },
        bestDamage: parsed.bestDamage ?? {},
      };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch { /* mode navigation privee : la partie reste jouable */ }
  }

  get state(): Readonly<SaveData> {
    return this.data;
  }

  get currentLevel(): number {
    return this.data.currentLevel;
  }

  setCurrentLevel(level: number): void {
    this.data.currentLevel = level;
    this.data.maxLevelReached = Math.max(this.data.maxLevelReached, level);
    this.persist();
  }

  recordWin(level: number, damage: number): void {
    const key = String(level);
    if (damage > (this.data.bestDamage[key] ?? 0)) this.data.bestDamage[key] = Math.round(damage);
    this.data.maxLevelReached = Math.max(this.data.maxLevelReached, level + 1);
    this.persist();
  }

  bestFor(level: number): number {
    return this.data.bestDamage[String(level)] ?? 0;
  }

  updateSettings(patch: Partial<SaveData['settings']>): void {
    this.data.settings = { ...this.data.settings, ...patch };
    this.persist();
  }

  reset(): void {
    this.data = structuredClone(DEFAULTS);
    this.persist();
  }
}
