/**
 * Pure audio helpers of the taklab voice log on the map (live listening and
 * PTT). The voice service speaks PCM 16-bit mono: 16 kHz down (listening),
 * 48 kHz up (microphone, the rate of Mumble).
 */

export const LISTEN_RATE = 16000;
export const SEND_RATE = 48000;
/** 20 ms at 48 kHz: one Mumble frame per WebSocket message. */
export const SEND_FRAME_SAMPLES = 960;
/** Playback starts this far ahead to absorb network jitter. */
export const JITTER_S = 0.12;
/** The service cuts a transmission after 60 s; the button stops just before. */
export const MAX_HOLD_MS = 59_000;

export function int16ToFloat32(bytes: ArrayBuffer): Float32Array<ArrayBuffer> {
    const input = new Int16Array(bytes, 0, Math.floor(bytes.byteLength / 2));
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input[i] / 0x8000;
    return out;
}

export function float32ToInt16(input: Float32Array): Int16Array {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
}

/** Linear resampling; good enough for speech and needs no AudioContext at 48 kHz (Firefox refuses mixed rates). */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
    if (from === to) return input;
    const length = Math.round(input.length * to / from);
    const out = new Float32Array(length);
    const step = from / to;
    for (let i = 0; i < length; i++) {
        const pos = i * step;
        const j = Math.floor(pos);
        const frac = pos - j;
        const a = input[Math.min(j, input.length - 1)];
        const b = input[Math.min(j + 1, input.length - 1)];
        out[i] = a + (b - a) * frac;
    }
    return out;
}

/** Collects microphone samples and cuts them into fixed frames for the service. */
export class FrameCutter {
    private buffer = new Float32Array(0);

    constructor(private readonly frame = SEND_FRAME_SAMPLES) {}

    push(samples: Float32Array): Int16Array[] {
        const joined = new Float32Array(this.buffer.length + samples.length);
        joined.set(this.buffer);
        joined.set(samples, this.buffer.length);
        const frames: Int16Array[] = [];
        let offset = 0;
        while (joined.length - offset >= this.frame) {
            frames.push(float32ToInt16(joined.subarray(offset, offset + this.frame)));
            offset += this.frame;
        }
        this.buffer = joined.slice(offset);
        return frames;
    }

    reset(): void {
        this.buffer = new Float32Array(0);
    }
}

/** When the next received chunk should play: right after the previous one, never in the past. */
export function nextPlayTime(now: number, scheduledUntil: number): number {
    return scheduledUntil > now ? scheduledUntil : now + JITTER_S;
}

export type PttState = 'unavailable' | 'idle' | 'requesting' | 'transmitting' | 'busy';

/** What the button shows, from what the service said about the channel. */
export function pttState(opts: {
    connected: boolean;
    ptt: boolean;
    channel: string | null;
    speaking: Record<string, string>;
    own: string;
    requesting: boolean;
    transmitting: boolean;
}): { state: PttState; speaker?: string } {
    if (!opts.connected || !opts.ptt || !opts.channel) return { state: 'unavailable' };
    if (opts.transmitting) return { state: 'transmitting' };
    const speaker = opts.speaking[opts.channel];
    if (speaker && speaker !== opts.own) return { state: 'busy', speaker };
    if (opts.requesting) return { state: 'requesting' };
    return { state: 'idle' };
}
