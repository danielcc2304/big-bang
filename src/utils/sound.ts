export type SoundName = 'bang' | 'missed' | 'damage' | 'beer' | 'dynamite' | 'jail' | 'store' | 'select' | 'draw' | 'equip' | 'turn' | 'death' | 'victory' | 'defeat' | 'connect' | 'error';

const EFFECTS: Record<SoundName, readonly [number, number, OscillatorType]> = {
  bang: [95, .18, 'sawtooth'], missed: [980, .1, 'sine'], damage: [145, .2, 'sawtooth'], beer: [520, .14, 'sine'],
  dynamite: [65, .55, 'sawtooth'], jail: [260, .18, 'square'], store: [720, .18, 'triangle'], select: [430, .06, 'triangle'],
  draw: [760, .1, 'triangle'], equip: [220, .1, 'square'], turn: [660, .16, 'triangle'], death: [110, .5, 'sawtooth'],
  victory: [880, .45, 'triangle'], defeat: [190, .5, 'sawtooth'], connect: [560, .15, 'sine'], error: [125, .16, 'square'],
};

// Original pentatonic saloon loop. Keeping it synthesized avoids shipping copyrighted audio.
const WESTERN_MELODY = [659, 0, 784, 659, 587, 0, 523, 587, 659, 0, 784, 880, 784, 659, 587, 0] as const;
const WESTERN_BASS = [131, 131, 117, 98] as const;

export class SoundService {
  private context: AudioContext | null = null;
  private effectsGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  enabled = localStorage.getItem('bang:sound') !== 'off';
  musicEnabled = localStorage.getItem('bang:music') !== 'off';
  volume = 0.45;

  async unlock(): Promise<boolean> {
    if (!this.enabled) return false;
    if (!this.context) {
      if (typeof AudioContext === 'undefined') return false;
      this.context = new AudioContext();
    }
    if (!this.effectsGain) {
      this.effectsGain = this.context.createGain();
      this.effectsGain.connect(this.context.destination);
    }
    if (!this.musicGain) {
      this.musicGain = this.context.createGain();
      this.musicGain.connect(this.context.destination);
    }
    this.effectsGain.gain.value = this.volume;
    this.musicGain.gain.value = this.volume * .22;
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context.state === 'running';
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    localStorage.setItem('bang:sound', enabled ? 'on' : 'off');
    if (!enabled) this.stopMusic();
  }

  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    localStorage.setItem('bang:music', enabled ? 'on' : 'off');
    if (enabled) void this.startMusic(); else this.stopMusic();
  }

  play(name: SoundName): void {
    if (!this.enabled) return;
    void this.unlock().then((ready) => {
      if (!ready || !this.context || !this.effectsGain) return;
      const [frequency, duration, type] = EFFECTS[name];
      this.scheduleTone(frequency, this.context.currentTime, duration, type, .14, this.effectsGain);
    }).catch(() => undefined);
  }

  async startMusic(): Promise<void> {
    if (!this.enabled || !this.musicEnabled || this.musicTimer !== null) return;
    if (!await this.unlock() || !this.context || !this.musicGain) return;
    const scheduleBar = (): void => {
      if (!this.context || !this.musicGain) return;
      const context = this.context;
      const musicGain = this.musicGain;
      const eighth = 60 / 112 / 2;
      const start = context.currentTime + .04;
      WESTERN_MELODY.forEach((frequency, index) => {
        if (frequency) this.scheduleTone(frequency, start + index * eighth, eighth * .72, 'triangle', .16, musicGain);
      });
      WESTERN_BASS.forEach((frequency, index) => {
        this.scheduleTone(frequency, start + index * eighth * 4, eighth * 2.4, 'sine', .22, musicGain);
      });
    };
    scheduleBar();
    this.musicTimer = window.setInterval(scheduleBar, 60 / 112 / 2 * 16 * 1_000);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this.musicGain) this.musicGain.gain.value = 0;
  }

  private scheduleTone(frequency: number, start: number, duration: number, type: OscillatorType, peak: number, destination: AudioNode): void {
    if (!this.context) return;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    envelope.gain.setValueAtTime(.001, start);
    envelope.gain.exponentialRampToValueAtTime(peak, start + .015);
    envelope.gain.exponentialRampToValueAtTime(.001, start + duration);
    oscillator.connect(envelope).connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + .03);
  }
}

export const sound = new SoundService();
