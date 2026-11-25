import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const std = vi.fn();
vi.mock('../std.ts', () => ({ std: (...args: unknown[]) => std(...args) }));

const create = vi.fn<(...args: unknown[]) => Promise<null>>(async () => null);
vi.mock('../base/notification.ts', () => ({
    default: { create: (...args: unknown[]) => create(...args) },
    NotificationType: { Video: 'Video' },
}));

const map = { flyTo: vi.fn(), getZoom: vi.fn(() => 12) };
const filter = vi.fn(async () => new Set());
vi.mock('./map.ts', () => ({
    useMapStore: () => ({ isMapLoaded: true, map, worker: { db: { filter } } }),
}));

import { useLiveVideoStore, POLL_VISIBLE_MS, POLL_HIDDEN_MS, START_TOAST_MS, END_TOAST_MS, LIVE_VIDEO_ROUTE, CAMERA_FILTER } from './live-video.ts';
import { useFloatStore, VideoStoreType } from './float.ts';
import type { LiveVideoStream } from '../base/live-video.ts';

function stream(path: string, username = path): LiveVideoStream {
    return { path, username, started_at: '2026-11-25T14:58:10Z', tech: null };
}

function answer(streams: LiveVideoStream[], supported = true) {
    return { supported, generated_at: '2026-11-25T15:00:00Z', streams };
}

let visibility: 'visible' | 'hidden' = 'visible';

async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('live video store', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.useFakeTimers();
        visibility = 'visible';
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
        std.mockReset();
        create.mockClear();
        filter.mockClear();
        map.flyTo.mockClear();
    });

    afterEach(() => {
        useLiveVideoStore().stop();
        vi.useRealTimers();
    });

    it('announces nothing for streams already live at login, then a start and an end', async () => {
        const store = useLiveVideoStore();
        std.mockResolvedValueOnce(answer([stream('alfa')]));
        await store.poll();
        expect(store.count).toBe(1);
        expect(store.toasts).toEqual([]);
        expect(create).not.toHaveBeenCalled();

        std.mockResolvedValueOnce(answer([stream('alfa'), stream('operator', 'operator')]));
        await store.poll();
        expect(store.toasts).toHaveLength(1);
        expect(store.toasts[0]).toMatchObject({ kind: 'start', path: 'operator', label: 'operator' });
        expect(create).toHaveBeenCalledTimes(1);
        expect(create).toHaveBeenCalledWith('Video', 'Live: operator', 'operator started streaming video', LIVE_VIDEO_ROUTE, false);

        std.mockResolvedValueOnce(answer([stream('alfa')]));
        await store.poll();
        // The stale start toast goes, a short end toast comes
        expect(store.toasts.map((x) => [x.kind, x.path])).toEqual([['end', 'operator']]);
        expect(create).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(END_TOAST_MS);
        expect(store.toasts).toEqual([]);
    });

    it('drops the start toast after its time', async () => {
        const store = useLiveVideoStore();
        std.mockResolvedValueOnce(answer([]));
        await store.poll();
        std.mockResolvedValueOnce(answer([stream('bravo')]));
        await store.poll();
        expect(store.toasts).toHaveLength(1);
        vi.advanceTimersByTime(START_TOAST_MS - 1);
        expect(store.toasts).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(store.toasts).toEqual([]);
    });

    it('keeps the last list on an error instead of announcing every end', async () => {
        const store = useLiveVideoStore();
        std.mockResolvedValueOnce(answer([stream('alfa')]));
        await store.poll();
        std.mockRejectedValueOnce(new Error('Serwer TAK nie odpowiada'));
        await store.poll();
        expect(store.count).toBe(1);
        expect(store.error).toBe('Serwer TAK nie odpowiada');
        expect(store.toasts).toEqual([]);

        std.mockResolvedValueOnce(answer([stream('alfa')]));
        await store.poll();
        expect(store.error).toBeNull();
        expect(store.toasts).toEqual([]);
    });

    it('asks every 5 s in front, every 30 s in the background, at once when back', async () => {
        const store = useLiveVideoStore();
        std.mockResolvedValue(answer([]));
        store.start();
        await flush();
        expect(std).toHaveBeenCalledTimes(1);
        expect(std).toHaveBeenCalledWith('/api/video/live');

        await vi.advanceTimersByTimeAsync(POLL_VISIBLE_MS);
        expect(std).toHaveBeenCalledTimes(2);

        visibility = 'hidden';
        await vi.advanceTimersByTimeAsync(POLL_VISIBLE_MS);
        expect(std).toHaveBeenCalledTimes(3);
        // scheduled with the background interval now
        await vi.advanceTimersByTimeAsync(POLL_VISIBLE_MS);
        expect(std).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(POLL_HIDDEN_MS - POLL_VISIBLE_MS);
        expect(std).toHaveBeenCalledTimes(4);

        visibility = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));
        await flush();
        expect(std).toHaveBeenCalledTimes(5);

        store.stop();
        await vi.advanceTimersByTimeAsync(POLL_HIDDEN_MS * 2);
        expect(std).toHaveBeenCalledTimes(5);
    });

    it('an OTS without the list is not supported and is asked rarely', async () => {
        const store = useLiveVideoStore();
        std.mockResolvedValue({ supported: false, streams: [] });
        store.start();
        await flush();
        expect(store.supported).toBe(false);
        await vi.advanceTimersByTimeAsync(POLL_HIDDEN_MS);
        expect(std).toHaveBeenCalledTimes(1);
    });

    it('scans the map for camera markers and pairs them with streams', async () => {
        const store = useLiveVideoStore();
        filter.mockResolvedValueOnce(new Set([
            { id: 'cam-1', geometry: { type: 'Point', coordinates: [17, 51] }, properties: { callsign: 'WOLF – wideo', sensor: { azimuth: 1, fov: 60, range: 200 }, metadata: { taklab_video: { path: 'operator' } } } },
            { id: 'cam-2', geometry: { type: 'Point', coordinates: [18, 52] }, properties: { callsign: 'UAV', video: { url: 'rtsp://h:8554/drone' } } },
            { id: 'line', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { sensor: {} } },
        ]));
        store.running = true;
        await store.scanMarkers();
        expect(filter).toHaveBeenCalledWith(CAMERA_FILTER);
        expect(store.cameras.map((c) => c.id)).toEqual(['cam-1', 'cam-2']);

        store.apply(answer([stream('operator'), stream('drone'), stream('nomarker')]));
        expect([...store.liveCameras.keys()]).toEqual(['operator', 'drone']);
        expect(store.isLiveMarker({ video: { url: 'rtsp://h:8554/drone' } })).toBe(true);
        expect(store.isLiveMarker({ video: { url: 'rtsp://h:8554/other' } })).toBe(false);

        expect(store.showOnMap('operator')).toBe('cam-1');
        expect(map.flyTo).toHaveBeenCalledWith({ center: [17, 51], zoom: 16 });
        expect(store.showOnMap('nomarker')).toBeNull();
    });

    it('opens the OTS HLS bridge feed of the path, the marker URL as fallback', async () => {
        const store = useLiveVideoStore();
        const floatStore = useFloatStore();
        store.apply(answer([stream('operator'), stream('drone')]));
        store.cameras = [{ id: 'cam-2', callsign: 'UAV', coordinates: [18, 52], sensor: null, video: { url: 'rtsp://h:8554/drone' }, metadata: null }];

        std.mockResolvedValueOnce({ videoConnections: [
            { uuid: 'x', alias: 'other', feeds: [{ url: 'http://public-ots:80/hls/bravo/index.m3u8' }] },
            { uuid: 'y', alias: 'operator', feeds: [{ url: 'http://public-ots:80/hls/operator/index.m3u8' }] },
        ] });
        expect(await store.watch('operator')).toBe(true);
        expect(std).toHaveBeenLastCalledWith('/api/marti/video');
        const pane = floatStore.panes.get('live-operator')!;
        expect(pane.name).toBe('operator');
        expect(pane.config).toEqual({ type: VideoStoreType.CONNECTION, url: 'http://public-ots:80/hls/operator/index.m3u8', livePath: 'operator' });

        std.mockResolvedValueOnce({ videoConnections: [] });
        expect(await store.watch('drone')).toBe(true);
        expect(floatStore.panes.get('live-drone')!.config).toEqual({ type: VideoStoreType.COT, url: 'rtsp://h:8554/drone', livePath: 'drone' });

        std.mockRejectedValueOnce(new Error('down'));
        expect(await store.watch('nothing')).toBe(false);
    });

    it('finds the stream behind a player URL', () => {
        const store = useLiveVideoStore();
        store.apply(answer([stream('operator')]));
        expect(store.streamForUrl('http://public-ots:80/hls/operator/index.m3u8')?.path).toBe('operator');
        expect(store.streamForUrl('http://public-ots:80/hls/bravo/index.m3u8')).toBeNull();
        expect(store.streamForUrl(undefined)).toBeNull();
    });
});
