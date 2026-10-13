// Web Audio ile sentezlenen ses efektleri – harici dosya yok.

type OscType = OscillatorType;

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private scrapeGain: GainNode | null = null;
  private scrapeFilter: BiquadFilterNode | null = null;
  private scrapeSrc: AudioBufferSourceNode | null = null;
  private lastScrape = 0;
  private lastCreak = 0;
  muted = false;

  /** Kullanıcı etkileşimi sonrası çağrılmalı. */
  init(): void {
    try {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') void this.ctx.resume();
        return;
      }
      const AC: typeof AudioContext | undefined =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
    if (m) this.stopScrape();
  }

  private ok(): boolean {
    return !!(this.ctx && this.master && !this.muted);
  }

  private tone(f0: number, f1: number, dur: number, type: OscType, vol: number, delay = 0): void {
    if (!this.ok()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  private noise(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass', delay = 0): void {
    if (!this.ok() || !this.noiseBuf) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.03);
  }

  click(): void {
    this.tone(660, 880, 0.07, 'triangle', 0.16);
  }
  select(): void {
    this.tone(520, 820, 0.1, 'triangle', 0.2);
    this.noise(0.05, 1800, 2, 0.12);
  }
  deny(): void {
    this.tone(200, 110, 0.2, 'square', 0.1);
  }
  poke(): void {
    this.tone(170, 80, 0.14, 'sine', 0.4);
    this.noise(0.06, 900, 1.2, 0.25);
  }
  engage(): void {
    this.tone(440, 740, 0.14, 'triangle', 0.18);
    this.tone(660, 990, 0.14, 'triangle', 0.12, 0.05);
  }
  warn(): void {
    this.tone(900, 900, 0.07, 'square', 0.09);
    this.tone(900, 900, 0.07, 'square', 0.09, 0.11);
  }
  stack(layer: number): void {
    this.tone(180 + layer * 22, 120 + layer * 12, 0.07, 'triangle', 0.22);
    this.noise(0.04, 700 + layer * 40, 1.5, 0.1);
  }
  thud(i = 1): void {
    const v = Math.min(1, Math.max(0.1, i));
    this.tone(150, 42, 0.26, 'sine', 0.55 * v);
    this.noise(0.14, 420, 0.8, 0.35 * v, 'lowpass');
  }
  place(): void {
    this.thud(0.75);
    this.tone(760, 1100, 0.08, 'triangle', 0.1, 0.02);
  }
  turn(): void {
    this.tone(520, 520, 0.18, 'sine', 0.14);
    this.tone(780, 780, 0.26, 'sine', 0.1, 0.07);
  }
  success(tier: number): void {
    const base = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    const n = 3 + Math.min(2, tier);
    for (let i = 0; i < n; i++) this.tone(base[i], base[i], 0.22 + i * 0.03, 'triangle', 0.16, i * 0.07);
  }
  creak(i = 0.5): void {
    if (!this.ok()) return;
    const now = performance.now();
    if (now - this.lastCreak < 220) return;
    this.lastCreak = now;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 70 + Math.random() * 70;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * (0.6 + Math.random() * 0.9), t + 0.35);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 350 + Math.random() * 350;
    f.Q.value = 6;
    const g = ctx.createGain();
    const v = 0.06 + 0.16 * Math.min(1, i);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(f);
    f.connect(g);
    g.connect(this.master!);
    o.start(t);
    o.stop(t + 0.42);
  }
  hit(v: number): void {
    const i = Math.min(1, v / 10);
    this.tone(130 + Math.random() * 90, 50, 0.16, 'sine', 0.38 * i + 0.05);
    this.noise(0.09, 600 + Math.random() * 700, 1, 0.22 * i + 0.03);
  }
  collapse(): void {
    this.noise(1.8, 240, 0.6, 0.5, 'lowpass');
    this.tone(95, 28, 1.2, 'sine', 0.6);
    for (let i = 0; i < 9; i++) this.thud(0.5 + Math.random() * 0.5);
    for (let i = 0; i < 9; i++) {
      this.noise(0.1, 500 + Math.random() * 900, 1, 0.25, 'bandpass', 0.1 + i * 0.13 + Math.random() * 0.08);
    }
  }
  lose(): void {
    this.tone(392, 392, 0.3, 'triangle', 0.16, 0.0);
    this.tone(330, 330, 0.3, 'triangle', 0.16, 0.25);
    this.tone(262, 196, 0.7, 'triangle', 0.18, 0.5);
  }
  win(): void {
    const n = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
    n.forEach((f, i) => this.tone(f, f, 0.24, 'triangle', 0.16, i * 0.11));
  }

  /** Sürtünme sesi – sürekli; level 0..1, pitch 0..1 */
  scrape(level: number, pitch: number): void {
    if (!this.ok()) return;
    const ctx = this.ctx!;
    const now = performance.now();
    if (now - this.lastScrape < 45) return;
    this.lastScrape = now;
    if (!this.scrapeSrc && this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 600;
      f.Q.value = 2.2;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f);
      f.connect(g);
      g.connect(this.master!);
      src.start();
      this.scrapeSrc = src;
      this.scrapeFilter = f;
      this.scrapeGain = g;
    }
    if (this.scrapeGain && this.scrapeFilter) {
      const t = ctx.currentTime;
      this.scrapeGain.gain.setTargetAtTime(level * 0.2, t, 0.06);
      this.scrapeFilter.frequency.setTargetAtTime(480 + pitch * 900, t, 0.08);
    }
  }
  stopScrape(): void {
    if (this.scrapeGain && this.ctx) this.scrapeGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
  }
}

export const sfx = new Sfx();
