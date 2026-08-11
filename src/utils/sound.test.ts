import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundService } from './sound';

const audio = vi.hoisted(() => ({
  createGain: vi.fn(),
  createOscillator: vi.fn(),
  resume: vi.fn(),
}));

const gainNode = () => ({
  gain: {
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  },
  connect: vi.fn().mockReturnThis(),
});

const oscillatorNode = () => ({
  type: 'sine',
  frequency: { setValueAtTime: vi.fn() },
  connect: vi.fn().mockReturnThis(),
  start: vi.fn(),
  stop: vi.fn(),
});

describe('SoundService', () => {
  beforeEach(() => {
    localStorage.clear();
    audio.createGain.mockImplementation(gainNode);
    audio.createOscillator.mockImplementation(oscillatorNode);
    audio.resume.mockResolvedValue(undefined);
    vi.stubGlobal('AudioContext', vi.fn(() => ({
      state: 'running',
      currentTime: 1,
      destination: {},
      createGain: audio.createGain,
      createOscillator: audio.createOscillator,
      resume: audio.resume,
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('unlocks Web Audio and schedules an effect', async () => {
    const service = new SoundService();

    service.play('bang');
    await vi.waitFor(() => expect(audio.createOscillator).toHaveBeenCalledTimes(1));

    expect(audio.createGain).toHaveBeenCalled();
  });

  it('starts and stops the original western menu loop', async () => {
    vi.useFakeTimers();
    const service = new SoundService();

    await service.startMusic();

    expect(audio.createOscillator.mock.calls.length).toBeGreaterThan(16);
    service.stopMusic();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start overlapping loops when two gestures unlock audio together', async () => {
    vi.useFakeTimers();
    const service = new SoundService();

    await Promise.all([service.startMusic(), service.startMusic()]);

    expect(vi.getTimerCount()).toBe(1);
    service.stopMusic();
  });
});
