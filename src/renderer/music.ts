/**
 * Dynamic Procedural Storybook WebAudio Soundtrack for Crop Revolt.
 * Zero external MP3/OGG assets — synthesizes warm marimba, plucked folk strings,
 * soft bass, and gentle storybook percussion in real time, adapting cleanly across:
 *   title | overworld | battle | boss | boss_enraged | victory | silent
 */

export type MusicTheme =
  | 'silent'
  | 'title'
  | 'overworld'
  | 'winter'
  | 'battle'
  | 'boss'
  | 'boss_enraged'
  | 'victory';

interface ThemePattern {
  bpm: number;
  melody: number[]; // MIDI note numbers (0 = rest)
  bass: number[];
  harmony: number[];
  leadWave: OscillatorType;
  bassWave: OscillatorType;
  percussion: boolean;
  intense?: boolean;
}

const STORAGE_KEY = 'crop_revolt_music_muted_v1';

// Musical patterns (16 eighth-note steps per loop)
const PATTERNS: Record<Exclude<MusicTheme, 'silent'>, ThemePattern> = {
  title: {
    bpm: 102,
    // Cozy F-major pastoral storybook waltz-groove
    melody: [69, 0, 72, 74, 77, 0, 74, 72, 69, 0, 67, 65, 67, 0, 72, 0],
    bass: [53, 0, 0, 53, 55, 0, 0, 55, 57, 0, 0, 53, 48, 0, 55, 0],
    harmony: [65, 0, 69, 0, 72, 0, 69, 0, 65, 0, 62, 0, 64, 0, 67, 0],
    leadWave: 'triangle',
    bassWave: 'sine',
    percussion: false,
  },
  overworld: {
    bpm: 116,
    // Breezy C-major folk garden adventure trail
    melody: [72, 74, 76, 0, 79, 76, 74, 72, 69, 72, 74, 0, 76, 74, 72, 0],
    bass: [48, 0, 55, 0, 48, 0, 55, 0, 45, 0, 52, 0, 50, 0, 55, 0],
    harmony: [64, 0, 67, 0, 64, 0, 67, 0, 60, 0, 64, 0, 62, 0, 67, 0],
    leadWave: 'triangle',
    bassWave: 'sine',
    percussion: true,
  },
  winter: {
    bpm: 112,
    // Crystalline A-minor / C-major sparkling celesta snow-hearth groove
    melody: [76, 0, 79, 81, 84, 0, 81, 79, 76, 74, 72, 0, 74, 76, 79, 0],
    bass: [45, 0, 52, 0, 48, 0, 55, 0, 41, 0, 48, 0, 43, 0, 50, 0],
    harmony: [69, 0, 72, 0, 72, 0, 76, 0, 65, 0, 69, 0, 67, 0, 71, 0],
    leadWave: 'sine',
    bassWave: 'triangle',
    percussion: true,
  },
  battle: {
    bpm: 128,
    // Playful Paper Mario / Mario+Rabbids G-major bouncy tactical groove
    melody: [67, 71, 74, 0, 76, 74, 71, 69, 67, 0, 74, 76, 79, 76, 74, 0],
    bass: [43, 0, 50, 43, 48, 0, 52, 48, 45, 0, 50, 45, 50, 0, 55, 50],
    harmony: [59, 0, 62, 0, 64, 0, 60, 0, 57, 0, 62, 0, 62, 0, 66, 0],
    leadWave: 'triangle',
    bassWave: 'triangle',
    percussion: true,
  },
  boss: {
    bpm: 138,
    // Dramatic D-minor harvest showdown ostinato
    melody: [62, 65, 69, 68, 69, 0, 74, 72, 69, 65, 67, 65, 64, 0, 61, 0],
    bass: [38, 38, 45, 38, 41, 41, 46, 41, 43, 43, 50, 43, 45, 45, 49, 45],
    harmony: [57, 0, 62, 0, 58, 0, 62, 0, 55, 0, 62, 0, 57, 0, 61, 0],
    leadWave: 'sawtooth',
    bassWave: 'triangle',
    percussion: true,
    intense: true,
  },
  boss_enraged: {
    bpm: 154,
    // Phase-2 frantic chromatic overdrive!
    melody: [74, 73, 74, 77, 76, 74, 72, 69, 70, 69, 67, 65, 69, 73, 74, 0],
    bass: [38, 45, 38, 45, 41, 48, 41, 48, 43, 50, 43, 50, 45, 52, 49, 45],
    harmony: [62, 65, 69, 0, 65, 69, 72, 0, 62, 67, 70, 0, 64, 69, 73, 0],
    leadWave: 'sawtooth',
    bassWave: 'sawtooth',
    percussion: true,
    intense: true,
  },
  victory: {
    bpm: 124,
    // Joyful F-major harvest fanfare celebration!
    melody: [65, 69, 72, 77, 0, 76, 77, 81, 0, 79, 77, 74, 72, 77, 81, 0],
    bass: [53, 0, 60, 0, 55, 0, 62, 0, 57, 0, 60, 0, 53, 55, 53, 0],
    harmony: [60, 0, 65, 0, 64, 0, 67, 0, 65, 0, 69, 0, 65, 0, 69, 0],
    leadWave: 'triangle',
    bassWave: 'sine',
    percussion: true,
  },
};

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

class StorybookMusicEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;
  private theme: MusicTheme = 'silent';
  private step = 0;
  private timerId: number | null = null;
  private unlocked = false;

  constructor() {
    try {
      if (typeof localStorage !== 'undefined') {
        this.muted = localStorage.getItem(STORAGE_KEY) === '1';
      }
    } catch {
      this.muted = false;
    }
    this.installGestureUnlock();
  }

  private installGestureUnlock(): void {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      this.unlocked = true;
      if (!this.muted && this.theme !== 'silent') {
        this.ensureAudio();
        this.startLoopIfNeeded();
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  private ensureAudio(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.13;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, mute ? '1' : '0');
      }
    } catch {
      // Ignore storage errors
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(mute ? 0 : 0.13, this.ctx.currentTime, 0.06);
    }
    if (mute) {
      this.stopTimer();
    } else if (this.unlocked && this.theme !== 'silent') {
      this.ensureAudio();
      this.startLoopIfNeeded();
    }
  }

  public toggleMute(): boolean {
    this.unlocked = true;
    this.setMuted(!this.muted);
    return this.muted;
  }

  public getTheme(): MusicTheme {
    return this.theme;
  }

  public setTheme(next: MusicTheme): void {
    if (this.theme === next) return;
    this.theme = next;
    this.step = 0;
    this.stopTimer();
    if (next === 'silent' || this.muted || !this.unlocked) return;
    this.ensureAudio();
    this.startLoopIfNeeded();
  }

  private stopTimer(): void {
    if (this.timerId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private startLoopIfNeeded(): void {
    if (this.muted || this.theme === 'silent' || typeof window === 'undefined') return;
    this.stopTimer();
    const pat = PATTERNS[this.theme];
    const stepMs = Math.round((60 / pat.bpm / 2) * 1000); // Eighth-note pulse
    this.playCurrentStep();
    this.timerId = window.setInterval(() => {
      this.playCurrentStep();
    }, stepMs);
  }

  private playNote(
    freq: number,
    durationSec: number,
    wave: OscillatorType,
    volume: number,
    filterHz?: number
  ): void {
    const ctx = this.ctx;
    const dest = this.masterGain;
    if (!ctx || !dest || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    if (filterHz) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(filterHz, now);
      osc.connect(filter);
      filter.connect(gain);
    } else {
      osc.connect(gain);
    }
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  }

  private playBeat(accent: boolean, intense: boolean): void {
    const ctx = this.ctx;
    const dest = this.masterGain;
    if (!ctx || !dest || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = accent ? 'sine' : 'triangle';
    const startHz = accent ? (intense ? 155 : 130) : intense ? 340 : 280;
    const endHz = accent ? 48 : 95;
    osc.frequency.setValueAtTime(startHz, now);
    osc.frequency.exponentialRampToValueAtTime(endHz, now + 0.09);

    const vol = accent ? (intense ? 0.36 : 0.24) : 0.08;
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  private playCurrentStep(): void {
    if (this.muted || this.theme === 'silent') return;
    const pat = PATTERNS[this.theme];
    const idx = this.step % pat.melody.length;
    const stepSec = 60 / pat.bpm / 2;

    const mel = pat.melody[idx];
    if (mel > 0) {
      this.playNote(
        midiToFreq(mel),
        stepSec * 1.15,
        pat.leadWave,
        pat.leadWave === 'sawtooth' ? 0.17 : 0.28,
        pat.leadWave === 'sawtooth' ? 1450 : 2600
      );
    }

    const bass = pat.bass[idx];
    if (bass > 0) {
      this.playNote(
        midiToFreq(bass),
        stepSec * 1.45,
        pat.bassWave,
        pat.bassWave === 'sawtooth' ? 0.14 : 0.24,
        620
      );
    }

    const harm = pat.harmony[idx];
    if (harm > 0) {
      this.playNote(midiToFreq(harm), stepSec * 0.9, 'sine', 0.11, 1800);
    }

    if (pat.percussion) {
      if (idx % 4 === 0) {
        this.playBeat(true, Boolean(pat.intense));
      } else if (idx % 2 === 1 || (pat.intense && idx % 2 === 0)) {
        this.playBeat(false, Boolean(pat.intense));
      }
    }

    this.step = (this.step + 1) % 64;
  }
}

export const music = new StorybookMusicEngine();
