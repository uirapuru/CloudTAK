import { describe, it, expect } from 'vitest';
import {
    bufferAction,
    bufferThresholds,
    isLivePlayback,
    isSelfRecoveringStall,
    HLS_LIVE_CONFIG,
    VOD_BUFFER_THRESHOLDS
} from '../components/util/video/buffer.ts';

describe('isLivePlayback', () => {
    it('treats live and not yet loaded playlists as live', () => {
        expect(isLivePlayback(true)).toBe(true);
        expect(isLivePlayback(undefined)).toBe(true);
    });

    it('treats recorded playlists as not live', () => {
        expect(isLivePlayback(false)).toBe(false);
    });
});

describe('bufferThresholds', () => {
    it('keeps the 2 s / 5 s thresholds for recorded playback', () => {
        expect(bufferThresholds(false)).toEqual({ low: 2, recovery: 5 });
    });

    it('does not pause live playback on buffer level', () => {
        expect(bufferThresholds(true)).toBeUndefined();
        expect(bufferThresholds(undefined)).toBeUndefined();
    });
});

describe('bufferAction', () => {
    it('pauses recorded playback below the low threshold', () => {
        expect(bufferAction(1.9, false, VOD_BUFFER_THRESHOLDS)).toBe('pause');
        expect(bufferAction(2.0, false, VOD_BUFFER_THRESHOLDS)).toBeUndefined();
    });

    it('resumes recorded playback only above the recovery threshold', () => {
        expect(bufferAction(4.9, true, VOD_BUFFER_THRESHOLDS)).toBeUndefined();
        expect(bufferAction(5.1, true, VOD_BUFFER_THRESHOLDS)).toBe('resume');
    });

    it('does nothing when already in the requested state', () => {
        expect(bufferAction(0.5, true, VOD_BUFFER_THRESHOLDS)).toBeUndefined();
        expect(bufferAction(10, false, VOD_BUFFER_THRESHOLDS)).toBeUndefined();
    });

    // MediaMTX 1 s segments with liveSyncDurationCount 3 keep 2-3 s buffered:
    // the old thresholds paused on every short delivery gap
    it('never pauses or resumes live playback', () => {
        const live = bufferThresholds(true);

        for (const ahead of [0, 0.4, 1.5, 1.9, 2.5, 6]) {
            expect(bufferAction(ahead, false, live)).toBeUndefined();
            expect(bufferAction(ahead, true, live)).toBeUndefined();
        }
    });
});

describe('HLS_LIVE_CONFIG', () => {
    it('catches up to the live edge by playing slightly faster', () => {
        expect(HLS_LIVE_CONFIG.maxLiveSyncPlaybackRate).toBeGreaterThan(1);
        expect(HLS_LIVE_CONFIG.maxLiveSyncPlaybackRate).toBeLessThanOrEqual(1.1);
    });

    it('keeps the live sync target inside the max latency window', () => {
        expect(HLS_LIVE_CONFIG.liveSyncDurationCount).toBeLessThan(HLS_LIVE_CONFIG.liveMaxLatencyDurationCount);
    });
});

describe('isSelfRecoveringStall', () => {
    it('lets hls.js handle stalls of a waiting element itself', () => {
        expect(isSelfRecoveringStall('bufferStalledError')).toBe(true);
        expect(isSelfRecoveringStall('bufferNudgeOnStall')).toBe(true);
        expect(isSelfRecoveringStall('bufferSeekOverHole')).toBe(true);
    });

    it('still recovers other media errors', () => {
        expect(isSelfRecoveringStall('bufferAppendError')).toBe(false);
        expect(isSelfRecoveringStall('fragParsingError')).toBe(false);
    });
});
