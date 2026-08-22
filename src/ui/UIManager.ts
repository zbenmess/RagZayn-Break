import type { LevelManager } from '../levels/LevelManager.js';
import type { SaveManager } from '../systems/SaveManager.js';
import type { LevelDef, SaveData } from '../types.js';

const GEAR_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.8 7.8 0 0 0 0-2l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.2a.5.5 0 0 0-.6-.2l-2.4 1a7.6 7.6 0 0 0-1.7-1l-.4-2.5a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1a.5.5 0 0 0-.6.2L2.5 8.8a.5.5 0 0 0 .1.6L4.6 11a7.8 7.8 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.1.6l1.9 3.2a.5.5 0 0 0 .6.2l2.4-1c.5.4 1.1.8 1.7 1l.4 2.5a.5.5 0 0 0 .5.4h3.8a.5.5 0 0 0 .5-.4l.4-2.5c.6-.2 1.2-.6 1.7-1l2.4 1a.5.5 0 0 0 .6-.2l1.9-3.2a.5.5 0 0 0-.1-.6zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z"/></svg>`;
const RESET_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7.5 6.5 12 11V8a5.5 5.5 0 1 1-5.5 5.5H4A8 8 0 1 0 12 5z"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z"/></svg>`;

export interface UICallbacks {
  onRestart(): void;
  onNextLevel(): void;
  onSelectLevel(level: number): void;
  onToggleSound(on: boolean): void;
  onToggleVoice(on: boolean): void;
  onToggleHaptics(on: boolean): void;
  onResetProgress(): void;
}

const PAGE_SIZE = 100;

/** Interface minimale : "Lv N", engrenage, recommencer, plus les ecrans de reglages. */
export class UIManager {
  private readonly root: HTMLElement;
  private levelLabel!: HTMLElement;
  private levelSub!: HTMLElement;
  private bar!: HTMLElement;
  private progressLabel!: HTMLElement;
  private hint!: HTMLElement;
  private winOverlay!: HTMLElement;
  private winTitle!: HTMLElement;
  private winStats!: HTMLElement;
  private settingsPanel!: HTMLElement;
  private levelsPanel!: HTMLElement;
  private levelGrid!: HTMLElement;
  private pageLabel!: HTMLElement;
  private page = 0;
  private hintTimer = 0;

  constructor(
    container: HTMLElement,
    private readonly levels: LevelManager,
    private readonly save: SaveManager,
    private readonly cb: UICallbacks,
    private readonly winTitleText: string,
  ) {
    this.root = container;
    this.render();
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="hud">
        <div class="level"><span id="lv-text">Lv 1</span><small id="lv-sub"></small></div>
        <div class="actions">
          <button class="icon-btn" id="btn-settings" aria-label="Réglages">${GEAR_ICON}</button>
          <button class="icon-btn" id="btn-restart" aria-label="Recommencer">${RESET_ICON}</button>
        </div>
      </div>

      <div class="progress"><div class="bar" id="bar"></div></div>
      <div class="progress-label" id="progress-label"></div>
      <div class="hint" id="hint"></div>

      <div class="overlay hidden" id="win">
        <div class="card">
          <h1 id="win-title">${this.winTitleText}</h1>
          <p id="win-sub">Niveau terminé</p>
          <div class="stats" id="win-stats"></div>
          <button class="btn" id="btn-next">Niveau suivant</button>
          <button class="btn secondary" id="btn-replay">Rejouer</button>
        </div>
      </div>

      <div class="panel hidden" id="settings">
        <header>
          <h2>Réglages</h2>
          <button class="icon-btn" id="btn-close-settings" aria-label="Fermer">${CLOSE_ICON}</button>
        </header>
        <div class="body">
          <label class="row">Sons
            <span class="switch"><input type="checkbox" id="sw-sound"><span></span></span>
          </label>
          <label class="row">Voix « ${this.winTitleText} »
            <span class="switch"><input type="checkbox" id="sw-voice"><span></span></span>
          </label>
          <label class="row">Vibrations
            <span class="switch"><input type="checkbox" id="sw-haptics"><span></span></span>
          </label>
          <div class="row">Niveaux <span class="value">${this.levels.total}</span></div>
          <div class="row">Meilleur niveau atteint <span class="value" id="max-level"></span></div>
          <button class="btn secondary" id="btn-levels" style="margin-top:16px">Choisir un niveau</button>
          <button class="btn secondary" id="btn-reset-progress">Effacer la progression</button>
          <p class="footnote">Jeu personnel, hors ligne. Aucune publicité, aucun compte, aucune donnée envoyée.</p>
        </div>
      </div>

      <div class="panel hidden" id="levels">
        <header>
          <h2>Niveaux</h2>
          <button class="icon-btn" id="btn-close-levels" aria-label="Fermer">${CLOSE_ICON}</button>
        </header>
        <div class="level-jump">
          <input type="number" inputmode="numeric" id="level-input" min="1" max="${this.levels.total}" placeholder="Aller au niveau…">
          <button class="btn" id="btn-jump">Aller</button>
        </div>
        <div class="pager">
          <button class="btn secondary" id="btn-prev-page">‹</button>
          <span class="page-label" id="page-label"></span>
          <button class="btn secondary" id="btn-next-page">›</button>
        </div>
        <div class="body"><div class="level-grid" id="level-grid"></div></div>
      </div>
    `;

    const q = <T extends HTMLElement>(id: string) => this.root.querySelector<T>(`#${id}`)!;
    this.levelLabel = q('lv-text');
    this.levelSub = q('lv-sub');
    this.bar = q('bar');
    this.progressLabel = q('progress-label');
    this.hint = q('hint');
    this.winOverlay = q('win');
    this.winTitle = q('win-title');
    this.winStats = q('win-stats');
    this.settingsPanel = q('settings');
    this.levelsPanel = q('levels');
    this.levelGrid = q('level-grid');
    this.pageLabel = q('page-label');

    q('btn-restart').onclick = () => this.cb.onRestart();
    q('btn-settings').onclick = () => this.openSettings();
    q('btn-close-settings').onclick = () => this.settingsPanel.classList.add('hidden');
    q('btn-next').onclick = () => { this.hideWin(); this.cb.onNextLevel(); };
    q('btn-replay').onclick = () => { this.hideWin(); this.cb.onRestart(); };
    q('btn-levels').onclick = () => this.openLevels();
    q('btn-close-levels').onclick = () => this.levelsPanel.classList.add('hidden');
    q('btn-prev-page').onclick = () => this.setPage(this.page - 1);
    q('btn-next-page').onclick = () => this.setPage(this.page + 1);
    q('btn-jump').onclick = () => {
      const input = q<HTMLInputElement>('level-input');
      const value = this.levels.clamp(Number(input.value));
      if (Number.isFinite(value)) {
        this.levelsPanel.classList.add('hidden');
        this.settingsPanel.classList.add('hidden');
        this.cb.onSelectLevel(value);
      }
    };
    q('btn-reset-progress').onclick = () => {
      if (confirm('Effacer la progression et revenir au niveau 1 ?')) {
        this.cb.onResetProgress();
        this.settingsPanel.classList.add('hidden');
      }
    };

    const bind = (id: string, handler: (on: boolean) => void) => {
      const el = q<HTMLInputElement>(id);
      el.onchange = () => handler(el.checked);
    };
    bind('sw-sound', (on) => this.cb.onToggleSound(on));
    bind('sw-voice', (on) => this.cb.onToggleVoice(on));
    bind('sw-haptics', (on) => this.cb.onToggleHaptics(on));
  }

  /* --------------------------------------------------------------- HUD */

  setLevel(def: LevelDef): void {
    this.levelLabel.textContent = `Lv ${def.level}`;
    this.levelSub.textContent = def.isBoss ? 'BOSS' : def.isTutorial ? def.label : '';
  }

  setProgress(damage: number, threshold: number): void {
    const ratio = Math.min(1, damage / Math.max(1, threshold));
    this.bar.style.width = `${ratio * 100}%`;
    this.progressLabel.textContent = `${Math.round(damage)} / ${threshold}`;
  }

  showHint(text: string): void {
    this.hint.textContent = text;
    this.hint.classList.remove('faded');
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hint.classList.add('faded'), 3200);
  }

  /* ----------------------------------------------------------- Victoire */

  showWin(def: LevelDef, damage: number, limbs: number, best: number): void {
    this.winTitle.textContent = this.winTitleText;
    this.winStats.innerHTML = `
      ${Math.round(damage)} points de dégâts<br>
      ${limbs} membre${limbs > 1 ? 's' : ''} arraché${limbs > 1 ? 's' : ''}<br>
      <span style="opacity:.7">record : ${Math.max(best, Math.round(damage))}</span>
    `;
    void def;
    this.winOverlay.classList.remove('hidden');
  }

  hideWin(): void {
    this.winOverlay.classList.add('hidden');
  }

  get winVisible(): boolean {
    return !this.winOverlay.classList.contains('hidden');
  }

  /* ----------------------------------------------------------- Reglages */

  private openSettings(): void {
    const s: SaveData['settings'] = this.save.state.settings;
    const q = <T extends HTMLElement>(id: string) => this.root.querySelector<T>(`#${id}`)!;
    q<HTMLInputElement>('sw-sound').checked = s.sound;
    q<HTMLInputElement>('sw-voice').checked = s.voice;
    q<HTMLInputElement>('sw-haptics').checked = s.haptics;
    q('max-level').textContent = String(this.save.state.maxLevelReached);
    this.settingsPanel.classList.remove('hidden');
  }

  private openLevels(): void {
    this.setPage(Math.floor((this.save.currentLevel - 1) / PAGE_SIZE));
    // Les deux panneaux sont plein ecran : on ferme celui des reglages en dessous.
    this.settingsPanel.classList.add('hidden');
    this.levelsPanel.classList.remove('hidden');
  }

  private setPage(page: number): void {
    const maxPage = Math.ceil(this.levels.total / PAGE_SIZE) - 1;
    this.page = Math.min(maxPage, Math.max(0, page));
    const entries = this.levels.page(this.page, PAGE_SIZE);
    this.pageLabel.textContent = `${this.page * PAGE_SIZE + 1} – ${Math.min(this.levels.total, (this.page + 1) * PAGE_SIZE)}`;

    const max = this.save.state.maxLevelReached;
    this.levelGrid.innerHTML = '';
    for (const entry of entries) {
      const button = document.createElement('button');
      button.textContent = String(entry.level);
      if (entry.isBoss) button.classList.add('boss');
      else if (entry.isTutorial) button.classList.add('tutorial');
      if (entry.level === this.save.currentLevel) button.classList.add('current');
      if (entry.level > max) button.classList.add('locked');
      button.onclick = () => {
        this.levelsPanel.classList.add('hidden');
        this.settingsPanel.classList.add('hidden');
        this.cb.onSelectLevel(entry.level);
      };
      this.levelGrid.appendChild(button);
    }
  }
}
