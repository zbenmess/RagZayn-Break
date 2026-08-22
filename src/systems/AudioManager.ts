/**
 * Sons entierement synthetises (Web Audio) : aucun fichier a telecharger,
 * donc rien a mettre en cache et un fonctionnement hors ligne immediat.
 * Le contexte doit etre debloque par un premier geste utilisateur (Safari iOS).
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambient: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastImpact = 0;
  enabled = true;

  /** A appeler dans un gestionnaire d'evenement tactile. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    const length = Math.floor(this.ctx.sampleRate * 0.5);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master) this.master.gain.value = enabled ? 0.85 : 0;
    if (!enabled) this.stopAmbient();
  }

  private noise(duration: number, gain: number, filter: number, type: BiquadFilterType = 'bandpass'): void {
    if (!this.ctx || !this.master || !this.noiseBuffer || !this.enabled) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const biquad = this.ctx.createBiquadFilter();
    biquad.type = type;
    biquad.frequency.value = filter;
    biquad.Q.value = 0.9;
    const env = this.ctx.createGain();
    const now = this.ctx.currentTime;
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(biquad).connect(env).connect(this.master);
    src.start(now);
    src.stop(now + duration + 0.02);
  }

  private tone(freq: number, duration: number, gain: number, type: OscillatorType = 'sine', slideTo?: number): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    const env = this.ctx.createGain();
    const now = this.ctx.currentTime;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + duration);
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(env).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  /** Choc : le timbre suit l'intensite. `wood` ajoute le craquement du mannequin. */
  impact(intensity: number, wood: boolean): void {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    if (now - this.lastImpact < 0.035) return; // anti-mitraillage
    this.lastImpact = now;

    const i = Math.min(1, intensity);
    this.tone(70 + i * 60, 0.16 + i * 0.1, 0.16 + i * 0.22, 'sine', 38);
    this.noise(0.07 + i * 0.05, 0.1 + i * 0.16, wood ? 1500 + i * 900 : 700);
    if (wood && i > 0.35) {
      this.noise(0.05, 0.14, 2600, 'highpass');
      this.tone(320 + Math.random() * 180, 0.05, 0.06, 'square');
    }
  }

  /** Craquement sec d'un membre arrache. */
  crack(): void {
    this.noise(0.14, 0.3, 2100, 'highpass');
    this.tone(240, 0.1, 0.1, 'sawtooth', 90);
  }

  explosion(): void {
    this.noise(0.55, 0.42, 420, 'lowpass');
    this.tone(140, 0.5, 0.32, 'sawtooth', 32);
  }

  whoosh(): void {
    this.noise(0.22, 0.09, 1100);
  }

  win(): void {
    if (!this.enabled) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.24, 0.14, 'triangle'), i * 90));
  }

  /** Nappe d'ambiance tres discrete. */
  startAmbient(): void {
    if (!this.ctx || !this.master || !this.enabled || this.ambient) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.02;
    gain.connect(this.master);
    const osc: OscillatorNode[] = [];
    for (const f of [110, 164.81, 220]) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.08 + Math.random() * 0.05;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 1.5;
      lfo.connect(lfoGain).connect(o.frequency);
      o.connect(gain);
      o.start();
      lfo.start();
      osc.push(o, lfo);
    }
    this.ambient = { osc, gain };
  }

  stopAmbient(): void {
    if (!this.ambient) return;
    for (const o of this.ambient.osc) {
      try { o.stop(); } catch { /* deja arrete */ }
    }
    this.ambient.gain.disconnect();
    this.ambient = null;
  }
}
