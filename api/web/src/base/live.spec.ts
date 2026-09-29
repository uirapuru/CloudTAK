import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_PLANE_IMAGE, LivePoller, ensureLiveIcons, liveStyles, liveFeatureTitle, planeIcon, visibleProperties, type LiveCollection } from './live.ts';

const FC: LiveCollection = { type: 'FeatureCollection', features: [], attribution: 'MPK Wrocław' };

describe('liveStyles', () => {
    it('draws circles, planes and labels from underscore fields', () => {
        const styles = liveStyles('7');
        expect(styles.map((s) => s.id)).toEqual([
            '7-polygon-fill', '7-line', '7-polygon-line', '7-circle', '7-icon-circle', '7-icon', '7-plane', '7-label',
        ]);
        for (const s of styles) expect((s as { source: string }).source).toBe('7');
        const plane = styles[6] as { layout: Record<string, unknown> };
        expect(plane.layout['icon-image']).toBe(LIVE_PLANE_IMAGE);
        expect(plane.layout['icon-rotate']).toEqual(['get', '_rotation']);
        const label = styles[7] as { layout: Record<string, unknown> };
        expect(label.layout['text-field']).toEqual(['get', '_label']);
        expect(label.layout['text-font']).toEqual(['Open Sans Bold']);
    });
});

describe('liveStyles geometry and icons', () => {
    const byId = (id: string) => liveStyles('7').find((s) => s.id === id) as unknown as Record<string, unknown> & { paint: Record<string, unknown>; layout: Record<string, unknown> };

    it('filters lines on both LineString and MultiLineString', () => {
        const line = byId('7-line');
        expect(line.type).toBe('line');
        expect(JSON.stringify(line.filter)).toContain('LineString');
        expect(JSON.stringify(line.filter)).toContain('MultiLineString');
        expect(line.paint['line-width']).toEqual(['coalesce', ['get', '_width'], 2]);
        expect(line.paint['line-color']).toEqual(['get', '_color']);
    });

    it('fills polygons with a default opacity and outlines them', () => {
        const fill = byId('7-polygon-fill');
        expect(fill.type).toBe('fill');
        expect(fill.paint['fill-opacity']).toEqual(['coalesce', ['get', '_fill_opacity'], 0.1]);
        expect(JSON.stringify(fill.filter)).toContain('MultiPolygon');
        expect(byId('7-polygon-line').type).toBe('line');
    });

    it('puts a coloured circle under a white icon for bus/tram/tower/shelter', () => {
        const circle = byId('7-icon-circle');
        expect(circle.type).toBe('circle');
        expect(circle.paint['circle-radius']).toBe(11);
        expect(circle.paint['circle-stroke-width']).toBe(1.5);
        expect(JSON.stringify(circle.filter)).toContain('shelter');
        const icon = byId('7-icon');
        expect(icon.layout['icon-image']).toEqual(['concat', 'live-', ['get', '_icon']]);
        expect(byId('7-circle').filter).toEqual(['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', '_icon'], 'circle']]);
    });

    it('draws dots and icons on Point geometries only', () => {
        for (const id of ['7-circle', '7-icon-circle', '7-icon']) {
            expect(JSON.stringify(byId(id).filter)).toContain('[["==",["geometry-type"],"Point"]'.slice(1, -1));
        }
    });
});

describe('ensureLiveIcons', () => {
    it('adds each icon once, non-SDF', async () => {
        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            width = 24; height = 24;
            set src(_v: string) { queueMicrotask(() => this.onload?.()); }
        }
        vi.stubGlobal('Image', FakeImage);
        const ctx = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) })) };
        const realCreate = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
            tag === 'canvas' ? { width: 0, height: 0, getContext: () => ctx } : realCreate(tag)) as never);
        const have = new Set<string>();
        const map = { hasImage: vi.fn((n: string) => have.has(n)), addImage: vi.fn((n: string) => { have.add(n); }) };
        await ensureLiveIcons(map as never);
        await ensureLiveIcons(map as never);
        expect(map.addImage.mock.calls.map((c) => c[0]).sort()).toEqual(['live-bus', 'live-shelter', 'live-tower', 'live-tram']);
        expect(map.addImage.mock.calls[0]).toHaveLength(2);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
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

describe('LivePoller since', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('sends since (percent-encoded) after a full response and skips unchanged', async () => {
        const updated = '2026-09-29T10:00:00+00:00';
        const fetch = vi.fn()
            .mockResolvedValueOnce({ ...FC, updated })
            .mockResolvedValueOnce({ unchanged: true, updated });
        const onData = vi.fn();
        const poller = new LivePoller({ url: '/api/live/x', intervalMs: 1000, fetch, onData });
        poller.start();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(1000);
        expect(onData).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[1][0]).toBe('/api/live/x?since=2026-09-29T10%3A00%3A00%2B00%3A00');
        poller.stop();
    });

    it('appends with & when the URL has a query', async () => {
        const fetch = vi.fn<(url: string) => Promise<LiveCollection>>(async () => ({ ...FC, updated: 'a+b' }));
        const poller = new LivePoller({ url: '/api/live/x?a=1', intervalMs: 1000, fetch, onData: vi.fn() });
        poller.start();
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetch.mock.calls[1][0]).toBe('/api/live/x?a=1&since=a%2Bb');
        poller.stop();
    });
});

describe('liveFeatureTitle', () => {
    it('prefers _label', () => {
        expect(liveFeatureTitle({ _label: '145', Adres: 'x' })).toBe('145');
    });
    it('falls back to the first visible string value', () => {
        expect(liveFeatureTitle({ _color: '#fff', n: 5, Adres: 'Kwiatowa 1', Typ: 'BTS' })).toBe('Kwiatowa 1');
    });
    it('skips empty strings and returns empty when nothing fits', () => {
        expect(liveFeatureTitle({ _label: '', a: '', b: 'ok' })).toBe('ok');
        expect(liveFeatureTitle({ n: 1 })).toBe('');
        expect(liveFeatureTitle(undefined)).toBe('');
    });
});
