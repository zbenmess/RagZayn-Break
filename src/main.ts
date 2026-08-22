import './ui/ui.css';
import { initPhysics } from './core/PhysicsWorld.js';
import { Game } from './core/Game.js';
import { LevelManager, type LevelFixesFile, type LevelOverridesFile } from './levels/LevelManager.js';
import { AudioManager } from './systems/AudioManager.js';
import { VoiceManager } from './systems/VoiceManager.js';
import { SaveManager } from './systems/SaveManager.js';
import type { HeroConfig, ToolDef } from './types.js';

const BASE = import.meta.env.BASE_URL;

async function loadJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${BASE}${path}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as T;
  } catch (e) {
    console.warn(`Configuration ${path} illisible, valeurs par défaut utilisées.`, e);
    return fallback;
  }
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
  const uiRoot = document.querySelector<HTMLElement>('#ui')!;
  const bootScreen = document.querySelector<HTMLElement>('#boot')!;

  const [hero, toolsFile, overrides, fixes] = await Promise.all([
    loadJson<HeroConfig>('config/hero.json', null as unknown as HeroConfig),
    loadJson<{ tools: ToolDef[] }>('config/tools.json', { tools: [] }),
    loadJson<LevelOverridesFile>('config/levels-overrides.json', { levels: {} }),
    loadJson<LevelFixesFile>('config/level-fixes.json', { fixes: {} }),
  ]);

  if (!hero || toolsFile.tools.length === 0) {
    bootScreen.textContent = 'Configuration introuvable (public/config).';
    return;
  }

  await initPhysics();

  const save = new SaveManager();
  const levels = new LevelManager(toolsFile.tools, overrides, fixes);
  const audio = new AudioManager();
  const voice = new VoiceManager(hero.voice, BASE);

  const game = new Game(canvas, uiRoot, levels, hero, save, audio, voice);
  game.loadLevel(save.currentLevel);
  game.start();

  // Accroche de debogage : permet de sauter a un niveau depuis la console.
  (window as unknown as { __game: Game }).__game = game;

  bootScreen.classList.add('hidden');
  setTimeout(() => bootScreen.remove(), 400);

  registerServiceWorker();
}

/**
 * L'enregistrement doit survivre au cas ou l'evenement `load` est deja passe :
 * `boot()` attend le chargement des configurations, ce qui arrive souvent apres.
 */
function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  const register = () => {
    navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE }).catch(() => {
      /* le jeu reste jouable sans cache hors ligne */
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

boot().catch((error) => {
  console.error(error);
  const bootScreen = document.querySelector<HTMLElement>('#boot');
  if (bootScreen) bootScreen.textContent = 'Erreur au démarrage : ' + String(error);
});
