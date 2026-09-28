import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_PLANE_IMAGE, LivePoller, liveStyles, planeIcon, visibleProperties, type LiveCollection } from './live.ts';

const FC: LiveCollection = { type: 'FeatureCollection', features: [], attribution: 'MPK Wrocław' };

describe('liveStyles', () => {
    it('draws circles, planes and labels from underscore fields', () => {
        const styles = liveStyles('7');
        expect(styles.map((s) => s.id)).toEqual(['7-circle', '7-plane', '7-label']);
        for (const s of styles) expect((s as { source: string }).source).toBe('7');
        const plane = styles[1] as { layout: Record<string, unknown> };
        expect(plane.layout['icon-image']).toBe(LIVE_PLANE_IMAGE);
        expect(plane.layout['icon-rotate']).toEqual(['get', '_rotation']);
        const label = styles[2] as { layout: Record<string, unknown> };
        expect(label.layout['text-field']).toEqual(['get', '_label']);
        expect(label.layout['text-font']).toEqual(['Open Sans Bold']);
    });
});

describe('visibleProperties', () => {
    it('drops underscore fields and keeps the rest in order', () => {
        expect(visibleProperties({ _color: '#fff', Linia: '145', _label: '145', Rodzaj: 'autobus' }))
            .toEqual({ Linia: '145', Rodzaj: 'autobus' });
        expect(Object.keys(visibleProperties({ b: 1, _x: 2, a: 3 }))).toEqual(['b', 'a']);
    });

    it('accepts missing properties', () => {
        expect(visibleProperties(undefined)).toEqual({});
        expect(visibleProperties(null)).toEqual({});
    });
});

describe('planeIcon', () => {
    it('is a square RGBA image with an opaque centre and transparent corners', () => {
        const icon = planeIcon(32);
        expect(icon.width).toBe(32);
        expect(icon.height).toBe(32);
        expect(icon.data.length).toBe(32 * 32 * 4);
        const alpha = (x: number, y: number) => icon.data[(y * 32 + x) * 4 + 3];
        expect(alpha(16, 16)).toBe(255);
        expect(alpha(0, 0)).toBe(0);
        expect(alpha(31, 31)).toBe(0);
    });
});

describe('LivePoller', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('fetches immediately and then every interval', async () => {
        const fetch = vi.fn(async () => FC);
        const onData = vi.fn();
        const poller = new LivePoller({ url: '/api/live/mpk-wroclaw', intervalMs: 10_000, fetch, onData });
        poller.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith('/api/live/mpk-wroclaw');
        await vi.advanceTimersByTimeAsync(10_000);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(onData).toHaveBeenCalledWith(FC);
        poller.stop();
    });

    it('stops fetching after stop()', async () => {
        const fetch = vi.fn(async () => FC);
        const poller = new LivePoller({ url: '/x', intervalMs: 1000, fetch, onData: vi.fn() });
        poller.start();
        await vi.advanceTimersByTimeAsync(0);
        poller.stop();
        expect(poller.running).toBe(false);
        await vi.advanceTimersByTimeAsync(5000);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('start() twice does not double the polling', async () => {
        const fetch = vi.fn(async () => FC);
        const poller = new LivePoller({ url: '/x', intervalMs: 1000, fetch, onData: vi.fn() });
        poller.start();
        poller.start();
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetch).toHaveBeenCalledTimes(2);
        poller.stop();
    });

    it('reports errors and keeps polling', async () => {
        const fetch = vi.fn()
            .mockRejectedValueOnce(new Error('502'))
            .mockResolvedValue(FC);
        const onData = vi.fn();
        const onError = vi.fn();
        const poller = new LivePoller({ url: '/x', intervalMs: 1000, fetch, onData, onError });
        poller.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onData).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1000);
        expect(onData).toHaveBeenCalledWith(FC);
        poller.stop();
    });

    it('drops a response that arrives after stop()', async () => {
        let resolve: (fc: LiveCollection) => void = () => {};
        const fetch = vi.fn(() => new Promise<LiveCollection>((r) => { resolve = r; }));
        const onData = vi.fn();
        const poller = new LivePoller({ url: '/x', intervalMs: 1000, fetch, onData });
        poller.start();
        poller.stop();
        resolve(FC);
        await vi.advanceTimersByTimeAsync(0);
        expect(onData).not.toHaveBeenCalled();
    });
});
