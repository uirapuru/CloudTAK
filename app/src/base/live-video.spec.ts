import { describe, it, expect } from 'vitest';
import {
    clientStats,
    diffStreams,
    formatBitrate,
    formatDuration,
    markerMatchesStream,
    streamAge,
    streamLabel,
    streamOfMarker,
    streamOfUrl,
    streamResolution,
    taklabVideoPath,
    urlMatchesPath,
    type LiveVideoStream,
} from './live-video.ts';

function stream(path: string, extra: Partial<LiveVideoStream> = {}): LiveVideoStream {
    return { path, username: path, started_at: '2026-11-25T14:58:10Z', tech: null, ...extra };
}

describe('live video streams', () => {
    it('diffs paths that started and ended', () => {
        const d = diffStreams([stream('a'), stream('b')], [stream('b'), stream('c')]);
        expect(d.started.map((s) => s.path)).toEqual(['c']);
        expect(d.ended.map((s) => s.path)).toEqual(['a']);
        expect(diffStreams([], [])).toEqual({ started: [], ended: [] });
        // a changed bitrate is not a new stream
        expect(diffStreams([stream('a')], [stream('a', { username: 'x' })])).toEqual({ started: [], ended: [] });
    });

    it('names a stream by account, else by path', () => {
        expect(streamLabel({ path: 'p', username: 'alfa' })).toBe('alfa');
        expect(streamLabel({ path: 'p', username: '' })).toBe('p');
    });

    it('matches stream URLs of the plugin and the OTS HLS bridge', () => {
        expect(urlMatchesPath('rtsp://public.taklab.eu:8554/operator', 'operator')).toBe(true);
        expect(urlMatchesPath('rtsps://user:pass@h:8322/operator?x=1', 'operator')).toBe(true);
        expect(urlMatchesPath('http://public-ots:80/hls/operator/index.m3u8', 'operator')).toBe(true);
        expect(urlMatchesPath('http://public-ots:80/hls/operator/', 'operator')).toBe(true);
        expect(urlMatchesPath('rtsp://h:8554/live/operator', 'operator')).toBe(true);
        expect(urlMatchesPath('rtsp://h:8554/operator2', 'operator')).toBe(false);
        expect(urlMatchesPath('rtsp://h:8554/xoperator', 'operator')).toBe(false);
        expect(urlMatchesPath('http://h/hls/bravo/index.m3u8', 'operator')).toBe(false);
        expect(urlMatchesPath(null, 'operator')).toBe(false);
        expect(urlMatchesPath('rtsp://h/x', '')).toBe(false);
    });

    it('matches a marker by <__taklab_video path> first, then by its video URL', () => {
        const own = { metadata: { taklab_video: { path: 'operator' } }, video: { url: 'rtsp://h/other' } };
        expect(taklabVideoPath(own)).toBe('operator');
        expect(markerMatchesStream(own, 'operator')).toBe(true);
        expect(markerMatchesStream(own, 'other')).toBe(false);
        expect(markerMatchesStream({ video: { url: 'rtsp://h:8554/operator' } }, 'operator')).toBe(true);
        expect(markerMatchesStream({ video: { url: 42 } }, 'operator')).toBe(false);
        expect(markerMatchesStream({}, 'operator')).toBe(false);
        expect(markerMatchesStream(null, 'operator')).toBe(false);

        const list = [stream('alfa'), stream('operator')];
        expect(streamOfMarker(own, list)?.path).toBe('operator');
        expect(streamOfMarker({ video: { url: 'rtsp://h/none' } }, list)).toBeNull();
        expect(streamOfUrl('http://h/hls/alfa/index.m3u8', list)?.path).toBe('alfa');
    });

    it('formats duration, bitrate and resolution', () => {
        expect(streamAge(stream('a'), Date.parse('2026-11-25T15:00:00Z'))).toBe(110);
        expect(streamAge(stream('a', { started_at: null }))).toBeNull();
        expect(streamAge(stream('a', { started_at: 'nie' }))).toBeNull();
        expect(formatDuration(110)).toBe('1:50');
        expect(formatDuration(3723)).toBe('1:02:03');
        expect(formatDuration(null)).toBe('');
        expect(formatBitrate(2100.5)).toBe('2,1 Mb/s');
        expect(formatBitrate(2100.5, 'en')).toBe('2.1 Mb/s');
        expect(formatBitrate(850)).toBe('850 kb/s');
        expect(formatBitrate(null)).toBe('');
        expect(streamResolution(stream('a', { tech: { source: null, transport: null, readers: 0, bytes_received: null, bitrate_kbps: null, packets_lost: null, jitter_ms: null, video: { codec: 'H264', width: 1280, height: 720, profile: null, level: null, fps: 30 }, audio: null } }))).toBe('1280×720');
        expect(streamResolution(stream('a'))).toBe('');
    });

    it('reads player stats from hls.js and the element', () => {
        const video = {
            videoWidth: 640,
            videoHeight: 360,
            currentTime: 10,
            buffered: { length: 1, end: () => 12.5 },
            getVideoPlaybackQuality: () => ({ droppedVideoFrames: 3, totalVideoFrames: 900 }),
        };
        const hls = { currentLevel: 0, levels: [{ width: 1280, height: 720, bitrate: 2_000_000 }], bandwidthEstimate: 5_500_000, latency: 3.2 };
        expect(clientStats(hls, video)).toEqual({
            width: 1280, height: 720, download_kbps: 5500, level_kbps: 2000,
            latency_s: 3.2, buffer_s: 2.5, dropped_frames: 3, total_frames: 900,
        });

        // WebRTC: no hls.js, size from the element
        const webrtc = clientStats(undefined, { ...video, buffered: { length: 0, end: () => 0 } });
        expect(webrtc).toEqual({
            width: 640, height: 360, download_kbps: null, level_kbps: null,
            latency_s: null, buffer_s: null, dropped_frames: 3, total_frames: 900,
        });

        // latency from the live sync position when hls.js has no latency
        expect(clientStats({ liveSyncPosition: 14, currentLevel: -1 }, video).latency_s).toBe(4);
        expect(clientStats(null, null).width).toBeNull();
    });
});
