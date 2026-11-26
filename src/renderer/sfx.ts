const MUTE_KEY = 'crop_revolt_muted_v1';

class CartoonSfx {
  private ctx: AudioContext | null = null;
  private muted = false;

  constructor() {
    try {
      if (typeof localStorage !== 'undefined') {
        this.muted = localStorage.getItem(MUTE_KEY) === '1';
      }
    } catch {
      this.muted = false;
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
      }
    } catch {
      // ignore
    }
    return this.muted;
  }

  public haptic(pattern: number | number[]): void {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      // ignore on unsupported browsers
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private tone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType = 'triangle',
    gainPeak = 0.14,
    delay = 0
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private noise(duration: number, gainPeak = 0.12, delay = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 950;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainPeak, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
  }

  public click(): void {
    this.tone(540, 360, 0.055, 'triangle', 0.08);
  }

  public step(): void {
    this.tone(240, 140, 0.06, 'sine', 0.09);
    this.haptic(8);
  }

  public dash(): void {
    this.tone(280, 620, 0.09, 'sawtooth', 0.08);
    this.tone(180, 90, 0.12, 'square', 0.12, 0.06);
    this.noise(0.08, 0.11, 0.05);
    this.haptic(20);
  }

  public jump(): void {
    this.tone(240, 660, 0.18, 'sine', 0.12);
    this.tone(420, 820, 0.12, 'triangle', 0.07, 0.08);
    this.haptic([12, 22, 14]);
  }

  public shoot(): void {
    this.tone(520, 190, 0.1, 'triangle', 0.12);
    this.noise(0.05, 0.06);
  }

  public lob(): void {
    this.tone(310, 560, 0.12, 'sine', 0.09);
    this.tone(560, 220, 0.14, 'sine', 0.08, 0.11);
  }

  public hit(strong = false): void {
    this.tone(strong ? 260 : 190, 70, 0.14, 'square', strong ? 0.15 : 0.11);
    this.noise(0.09, strong ? 0.14 : 0.09);
    if (strong) {
      this.tone(520, 780, 0.12, 'triangle', 0.09, 0.04);
    }
    this.haptic(strong ? [24, 18, 24] : 16);
  }

  public miss(): void {
    this.tone(280, 160, 0.11, 'sine', 0.07);
    this.noise(0.07, 0.08, 0.03);
    this.haptic(10);
  }

  public coverBreak(): void {
    this.noise(0.18, 0.16);
    this.tone(180, 65, 0.16, 'sawtooth', 0.12);
    this.tone(320, 110, 0.12, 'triangle', 0.08, 0.05);
    this.haptic([28, 16, 16]);
  }

  public heal(): void {
    this.tone(440, 554, 0.1, 'sine', 0.09);
    this.tone(554, 659, 0.12, 'sine', 0.09, 0.08);
    this.tone(659, 880, 0.16, 'triangle', 0.09, 0.16);
    this.haptic(12);
  }

  public rescue(): void {
    this.tone(523, 659, 0.12, 'triangle', 0.11);
    this.tone(659, 784, 0.12, 'triangle', 0.11, 0.1);
    this.tone(784, 1046, 0.22, 'triangle', 0.12, 0.2);
    this.haptic([16, 20, 24]);
  }

  public spooked(): void {
    // Comical startled animal scurry + save chime!
    this.tone(360, 720, 0.11, 'triangle', 0.12);
    this.tone(640, 260, 0.14, 'sawtooth', 0.08, 0.09);
    this.tone(480, 680, 0.12, 'sine', 0.1, 0.2);
    this.haptic([24, 18, 24]);
  }

  public victory(): void {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => {
      this.tone(n, n * 1.02, 0.18, 'triangle', 0.11, i * 0.11);
    });
    this.haptic([20, 30, 20, 30, 40]);
  }

  public defeat(): void {
    const notes = [392, 349, 311, 261];
    notes.forEach((n, i) => {
      this.tone(n, n * 0.96, 0.2, 'sawtooth', 0.07, i * 0.14);
    });
    this.haptic([40, 40, 60]);
  }
}

export const sfx = new CartoonSfx();
