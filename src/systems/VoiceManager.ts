import type { HeroVoiceConfig } from '../types.js';

/**
 * Voix de victoire. Priorite au fichier public/audio/bravo-zayn.mp3 s'il existe,
 * sinon synthese vocale (Web Speech API) avec une voix fr-FR feminine si possible.
 */
export class VoiceManager {
  private voices: SpeechSynthesisVoice[] = [];
  private chosen: SpeechSynthesisVoice | null = null;
  private ready = false;
  private audio: HTMLAudioElement | null = null;
  private audioAvailable = false;
  private unlocked = false;
  enabled = true;

  constructor(private readonly config: HeroVoiceConfig, private readonly baseUrl: string) {
    this.enabled = config.enabled;
    if ('speechSynthesis' in window) {
      this.loadVoices();
      // Safari peuple la liste de facon asynchrone : il faut attendre voiceschanged.
      speechSynthesis.addEventListener('voiceschanged', () => this.loadVoices());
    }
    if (config.audioFile) void this.probeAudioFile(config.audioFile);
  }

  private async probeAudioFile(relative: string): Promise<void> {
    const url = `${this.baseUrl}${relative.replace(/^\//, '')}`;
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) return;

      // Certains serveurs renvoient la page d'accueil (statut 200) pour un fichier
      // absent : sans ce controle du type, cette page etait prise pour un mp3 et
      // la voix de synthese ne prenait le relais qu'apres l'echec de la lecture.
      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      if (!type.startsWith('audio') && !type.includes('octet-stream')) return;

      const blob = await res.blob();
      if (blob.size < 2048) return; // fichier vide ou substitut
      this.audio = new Audio(URL.createObjectURL(blob));
      this.audio.preload = 'auto';
      this.audioAvailable = true;
    } catch {
      this.audioAvailable = false;
    }
  }

  private loadVoices(): void {
    this.voices = speechSynthesis.getVoices();
    if (this.voices.length === 0) return;
    this.ready = true;

    const lang = this.config.lang.toLowerCase();
    const french = this.voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(lang.slice(0, 2)));
    const preferred = this.config.preferredVoiceNames.map((n) => n.toLowerCase());

    this.chosen =
      french.find((v) => preferred.some((p) => v.name.toLowerCase().includes(p))) ??
      french.find((v) => v.lang.toLowerCase().replace('_', '-') === lang) ??
      french[0] ??
      null;
  }

  /**
   * A appeler au premier geste utilisateur : Safari refuse sinon toute phrase
   * ulterieure. On prononce le texte reel a volume nul, car une chaine vide
   * n'initialise pas le moteur, et on ne l'annule pas aussitot : un `cancel()`
   * immediat suffit a faire disparaitre la phrase de deblocage.
   */
  unlock(): void {
    if (this.unlocked || !('speechSynthesis' in window)) return;
    this.unlocked = true;
    try {
      const warmup = new SpeechSynthesisUtterance(this.config.text);
      warmup.volume = 0;
      warmup.lang = this.config.lang;
      speechSynthesis.speak(warmup);
    } catch { /* la synthese n'est pas disponible */ }
    if (!this.ready) this.loadVoices();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && 'speechSynthesis' in window) speechSynthesis.cancel();
  }

  /** Prononce le texte de victoire ("Bravo Zayn !"). */
  celebrate(text = this.config.text): void {
    if (!this.enabled) return;

    if (this.audioAvailable && this.audio) {
      this.audio.currentTime = 0;
      this.audio.volume = this.config.volume;
      void this.audio.play().catch(() => this.speak(text));
      return;
    }
    this.speak(text);
  }

  private speak(text: string, retry = false): void {
    if (!('speechSynthesis' in window)) return;
    if (!this.ready) this.loadVoices();

    const synth = window.speechSynthesis;
    try {
      // Safari laisse parfois la file en pause apres un passage en arriere-plan.
      synth.resume();

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = this.config.lang;
      utter.pitch = this.config.pitch;
      utter.rate = this.config.rate;
      utter.volume = this.config.volume;
      if (this.chosen) utter.voice = this.chosen;

      // Une seule reprise au maximum : sans ce verrou partage, la reprise sur
      // erreur et celle sur delai se cumulaient et la phrase etait dite trois fois.
      let settled = retry;
      const retryOnce = () => {
        if (settled) return;
        settled = true;
        window.setTimeout(() => this.speak(text, true), 220);
      };
      utter.onstart = () => { settled = true; };
      utter.onend = () => { settled = true; };
      utter.onerror = retryOnce;

      // Un `cancel()` suivi immediatement d'un `speak()` fait disparaitre la
      // phrase sur Safari : on n'annule que s'il y a vraiment quelque chose en
      // cours, et on laisse alors passer une image avant de parler.
      if (synth.speaking || synth.pending) {
        synth.cancel();
        window.setTimeout(() => synth.speak(utter), 120);
      } else {
        synth.speak(utter);
      }

      // iOS ignore parfois silencieusement la premiere phrase : on retente une fois.
      if (!retry) {
        window.setTimeout(() => {
          if (!synth.speaking) retryOnce();
        }, 800);
      }
    } catch { /* la synthese n'est pas disponible */ }
  }

  /** Libelle affiche dans les reglages, pour savoir ce qui sera joue. */
  get voiceName(): string {
    if (this.audioAvailable) return 'enregistrement mp3';
    if (this.chosen) return this.chosen.name;
    if (!('speechSynthesis' in window)) return 'indisponible';
    return this.ready ? 'voix par défaut' : 'voix système';
  }
}
