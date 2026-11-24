import { ErrorDetails } from 'hls.js';

/**
 * Buffer handling for the HLS engine of VideoPlayer.
 *
 * Recorded (VOD) playlists keep the original behaviour: pause below 2 s of
 * buffer and resume above 5 s. Live MediaMTX playlists use 1 s segments and
 * sit at 2-3 s of buffer, so those thresholds froze the picture for ~3 s on
 * every short delivery gap. Live playback is never paused by the player: the
 * element stalls on its own when the buffer runs dry (the `waiting` event
 * still raises the overlay), hls.js nudges past the stall without a
 * MediaSource reset, playback progress clears the overlay, and hls.js
 * catches up to the live edge by playing slightly faster.
 */

export type BufferThresholds = {
    /** Pause playback when fewer seconds than this are buffered ahead */
    low: number;
    /** Resume a buffering pause once more seconds than this are buffered ahead */
    recovery: number;
};

export const VOD_BUFFER_THRESHOLDS: BufferThresholds = { low: 2, recovery: 5 };

export type BufferAction = 'pause' | 'resume' | undefined;

/**
 * Liveness is unknown until hls.js loads the first media playlist. The player
 * is built for live leases, so unknown counts as live.
 */
export function isLivePlayback(live: boolean | undefined): boolean {
    return live !== false;
}

/**
 * Thresholds for the proactive buffer monitor, or undefined when the player
 * must not pause playback itself
 */
export function bufferThresholds(live: boolean | undefined): BufferThresholds | undefined {
    return isLivePlayback(live) ? undefined : VOD_BUFFER_THRESHOLDS;
}

export function bufferAction(
    bufferAhead: number,
    buffering: boolean,
    thresholds: BufferThresholds | undefined,
): BufferAction {
    if (!thresholds) return undefined;
    if (bufferAhead < thresholds.low && !buffering) return 'pause';
    if (bufferAhead > thresholds.recovery && buffering) return 'resume';
    return undefined;
}

/**
 * Non-fatal media errors hls.js raises while the element waits for data and
 * recovers from on its own by nudging playback forward
 */
const SELF_RECOVERING_STALLS: ReadonlySet<string> = new Set([
    ErrorDetails.BUFFER_STALLED_ERROR,
    ErrorDetails.BUFFER_NUDGE_ON_STALL,
    ErrorDetails.BUFFER_SEEK_OVER_HOLE,
]);

export function isSelfRecoveringStall(details: string): boolean {
    return SELF_RECOVERING_STALLS.has(details);
}

/**
 * hls.js live settings. hls.js applies them to live playlists only, so
 * recorded playback is unaffected.
 */
export const HLS_LIVE_CONFIG = {
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 10,
    maxLiveSyncPlaybackRate: 1.1,
} as const;
