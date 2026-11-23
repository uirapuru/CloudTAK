import { describe, it, expect } from 'vitest';
import { FrameCutter, float32ToInt16, int16ToFloat32, nextPlayTime, pttState, resample, JITTER_S } from './voice-audio.ts';

describe('voice audio helpers', () => {
    it('converts PCM both ways', () => {
        const pcm = new Int16Array([0, 16384, -32768, 32767]);
        const f = int16ToFloat32(pcm.buffer);
        expect(f[1]).toBeCloseTo(0.5, 3);
        expect(Array.from(float32ToInt16(new Float32Array([0, 1, -1, 2])))).toEqual([0, 32767, -32768, 32767]);
    });

    it('resamples 44.1 kHz to 48 kHz', () => {
        const out = resample(new Float32Array(441).fill(0.25), 44100, 48000);
        expect(out.length).toBe(480);
        expect(out[100]).toBeCloseTo(0.25, 5);
    });

    it('cuts the microphone into 960-sample frames and keeps the rest', () => {
        const cut = new FrameCutter();
        expect(cut.push(new Float32Array(500))).toHaveLength(0);
        const frames = cut.push(new Float32Array(1500));
        expect(frames).toHaveLength(2);
        expect(frames[0].length).toBe(960);
        cut.reset();
        expect(cut.push(new Float32Array(959))).toHaveLength(0);
    });

    it('schedules playback without gaps or the past', () => {
        expect(nextPlayTime(10, 0)).toBe(10 + JITTER_S);
        expect(nextPlayTime(10, 10.5)).toBe(10.5);
    });

    it('blocks the button while someone else speaks on the channel', () => {
        const base = { connected: true, ptt: true, channel: 'A', speaking: {}, own: 'ALFA-CloudTAK', requesting: false, transmitting: false };
        expect(pttState(base)).toEqual({ state: 'idle' });
        expect(pttState({ ...base, speaking: { A: 'BRAVO' } })).toEqual({ state: 'busy', speaker: 'BRAVO' });
        expect(pttState({ ...base, speaking: { A: 'ALFA-CloudTAK' } })).toEqual({ state: 'idle' });
        expect(pttState({ ...base, speaking: { B: 'BRAVO' } })).toEqual({ state: 'idle' });
        expect(pttState({ ...base, transmitting: true })).toEqual({ state: 'transmitting' });
        expect(pttState({ ...base, ptt: false })).toEqual({ state: 'unavailable' });
    });
});
