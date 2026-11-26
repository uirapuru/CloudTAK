import { describe, it, expect } from 'vitest';
import { connectionPath, isConnectionOffline } from './live-video.ts';

const HLS = 'http://public-ots:80/hls/operator/index.m3u8?jwt=abc';

describe('connectionPath', () => {
    it('takes the alias OTS sets to the stream path', () => {
        expect(connectionPath({ alias: 'operator', feeds: [{ url: HLS }] })).toBe('operator');
    });

    it('falls back to the HLS bridge URL', () => {
        expect(connectionPath({ alias: '', feeds: [{ url: HLS }] })).toBe('operator');
    });

    it('gives null when neither says anything', () => {
        expect(connectionPath({ alias: null, feeds: [] })).toBeNull();
        expect(connectionPath({ feeds: [{ url: 'rtsp://host/x' }] })).toBeNull();
    });
});

describe('isConnectionOffline', () => {
    const connection = { alias: 'operator', feeds: [{ url: HLS }] };

    it('is offline when the live list does not have the path', () => {
        expect(isConnectionOffline(connection, { loaded: true, supported: true, streams: [{ path: 'kaszub' }] })).toBe(true);
        expect(isConnectionOffline(connection, { loaded: true, supported: true, streams: [] })).toBe(true);
    });

    it('is live when the path is on the list', () => {
        expect(isConnectionOffline(connection, { loaded: true, supported: true, streams: [{ path: 'operator' }] })).toBe(false);
        expect(isConnectionOffline(connection, { loaded: true, supported: true, streams: [{ path: '/operator/' }] })).toBe(false);
    });

    it('matches by URL when the alias differs from the path', () => {
        const renamed = { alias: 'Kamera 1', feeds: [{ url: HLS }] };
        expect(isConnectionOffline(renamed, { loaded: true, supported: true, streams: [{ path: 'operator' }] })).toBe(false);
    });

    it('does not guess before the live list is known', () => {
        expect(isConnectionOffline(connection, { loaded: false, supported: true, streams: [] })).toBe(false);
        expect(isConnectionOffline(connection, { loaded: true, supported: false, streams: [] })).toBe(false);
    });
});
