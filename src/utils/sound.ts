export type SoundName = 'bang' | 'missed' | 'damage' | 'beer' | 'dynamite' | 'jail' | 'store' | 'select' | 'draw' | 'equip' | 'turn' | 'death' | 'victory' | 'defeat' | 'connect' | 'error';

class SoundService {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  enabled = localStorage.getItem('bang:sound') !== 'off';
  volume = 0.45;

  async unlock(): Promise<void> {
    if (!this.enabled) return;
    this.context ??= new AudioContext();
    if (!this.gain) { this.gain = this.context.createGain(); this.gain.connect(this.context.destination); }
    this.gain.gain.value = this.volume;
    if (this.context.state === 'suspended') await this.context.resume();
  }

  setEnabled(enabled: boolean): void { this.enabled = enabled; localStorage.setItem('bang:sound', enabled ? 'on' : 'off'); }

  play(name: SoundName): void {
    if (!this.enabled) return;
    void this.unlock().then(() => {
      if (!this.context || !this.gain) return;
      const notes: Record<SoundName, readonly [number, number, OscillatorType]> = {
        bang: [95, .18, 'sawtooth'], missed: [980, .1, 'sine'], damage: [145, .2, 'sawtooth'], beer: [520, .14, 'sine'],
        dynamite: [65, .55, 'sawtooth'], jail: [260, .18, 'square'], store: [720, .18, 'triangle'], select: [430, .06, 'triangle'],
        draw: [760, .1, 'triangle'], equip: [220, .1, 'square'], turn: [660, .16, 'triangle'], death: [110, .5, 'sawtooth'],
        victory: [880, .45, 'triangle'], defeat: [190, .5, 'sawtooth'], connect: [560, .15, 'sine'], error: [125, .16, 'square'],
      };
      const [frequency, duration, type] = notes[name];
      const oscillator = this.context.createOscillator();
      const envelope = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, this.context.currentTime);
      envelope.gain.setValueAtTime(.001, this.context.currentTime);
      envelope.gain.exponentialRampToValueAtTime(.14, this.context.currentTime + .01);
      envelope.gain.exponentialRampToValueAtTime(.001, this.context.currentTime + duration);
      oscillator.connect(envelope).connect(this.gain);
      oscillator.start(); oscillator.stop(this.context.currentTime + duration + .02);
    });
  }
}

export const sound = new SoundService();
