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
      const type = res.headers.get('content-type') ?? '';
      if (!type.startsWith('audio') && !url.endsWith('.mp3')) return;
      const blob = await res.blob();
      if (blob.size < 512) return; // placeholder ou page d'erreur
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

  /** A appeler au premier geste utilisateur : Safari bloque sinon la premiere phrase. */
  unlock(): void {
    if (this.unlocked || !('speechSynthesis' in window)) return;
    this.unlocked = true;
    try {
      const warmup = new SpeechSynthesisUtterance('');
      warmup.volume = 0;
      speechSynthesis.speak(warmup);
      speechSynthesis.cancel();
    } catch { /* ignore */ }
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

  private speak(text: string): void {
    if (!('speechSynthesis' in window)) return;
    if (!this.ready) this.loadVoices();
    try {
      speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = this.config.lang;
      utter.pitch = this.config.pitch;
      utter.rate = this.config.rate;
      utter.volume = this.config.volume;
      if (this.chosen) utter.voice = this.chosen;
      speechSynthesis.speak(utter);
    } catch { /* la synthese n'est pas disponible */ }
  }

  get voiceName(): string {
    return this.chosen?.name ?? (this.audioAvailable ? 'fichier mp3' : 'voix par defaut');
  }
}
