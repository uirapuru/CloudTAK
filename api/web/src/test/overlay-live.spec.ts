import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { stdMock, source, map, mapStore, added } = vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const stdMock = vi.fn(async (_url?: unknown) => ({
        type: 'FeatureCollection',
        features: [],
        attribution: 'adsb.lol (ODbL)'
    }));
    const source = { setData: vi.fn() };
    const added = { value: false };
    const map = {
        // The source only exists once init() has added it
        getSource: vi.fn(() => (added.value ? source : undefined)),
        addSource: vi.fn(() => { added.value = true; }),
        hasImage: vi.fn(() => false),
        addImage: vi.fn(),
        refreshTiles: vi.fn(),
        getLayer: vi.fn(() => undefined),
        addLayer: vi.fn(),
        getStyle: vi.fn(() => ({ sources: {} })),
        getTerrain: vi.fn(() => undefined),
        setLayoutProperty: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
    };
    const mapStore = { map, updateAttribution: vi.fn(async () => {}) };
    return { stdMock, source, map, mapStore, added };
});

vi.mock('../std.ts', () => ({ std: stdMock, server: {}, stdurl: (u: string) => new URL(u, 'http://localhost') }));
vi.mock('../std.js', () => ({ std: stdMock, server: {}, stdurl: (u: string) => new URL(u, 'http://localhost') }));
vi.mock('../stores/map.js', () => ({ useMapStore: () => mapStore }));
vi.mock('../stores/map.ts', () => ({ useMapStore: () => mapStore }));
vi.mock('../base/profile.ts', () => ({ default: { get: vi.fn(async () => undefined) } }));
vi.mock('../database.ts', () => ({ db: { overlay: { put: vi.fn(async () => {}) } } }));
vi.mock('../base/subscription.ts', () => ({ default: class {} }));
vi.mock('../base/tiles3d.ts', () => ({ getTiles3D: vi.fn(), peekTiles3D: vi.fn() }));

import Overlay from '../base/overlay-class.ts';
import { LIVE_PLANE_IMAGE, liveStyles } from '../base/live.ts';

function makeOverlay(): Overlay {
    const overlay = new Overlay({
        id: 7, name: 'ADS-B', active: true, username: 'u', frequency: 10, iconset: null,
        created: '', updated: '', pos: 1, type: 'geojson', opacity: 1, visible: true,
        mode: 'live', mode_id: 'adsb', encoding: null, attribution: '', actions: { feature: [] },
        url: '/api/live/adsb', styles: [], token: null, tilejson: null,
    } as never);
    // Layer creation is map plumbing, not under test here
    vi.spyOn(overlay, 'addLayers').mockResolvedValue(undefined as never);
    return overlay;
}

describe('live overlay', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        added.value = false;
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('init registers source, SDF image, styles and polls the live URL into the source', async () => {
        const overlay = makeOverlay();
        await overlay.init();
        await vi.advanceTimersByTimeAsync(0);

        expect(map.addSource).toHaveBeenCalledWith('7', expect.objectContaining({ type: 'geojson' }));
        expect(map.addImage).toHaveBeenCalledTimes(1);
        expect(map.addImage).toHaveBeenCalledWith(LIVE_PLANE_IMAGE, expect.anything(), { sdf: true });
        expect(overlay.styles).toEqual(liveStyles('7'));
        expect(stdMock).toHaveBeenCalledWith('/api/live/adsb');
        expect(source.setData).toHaveBeenCalledWith(expect.objectContaining({ type: 'FeatureCollection' }));
        expect(overlay.attribution).toBe('adsb.lol (ODbL)');
        overlay.remove();
    });

    it('does not run the tile refresh timer', async () => {
        const overlay = makeOverlay();
        await overlay.init();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(map.refreshTiles).not.toHaveBeenCalled();
        overlay.remove();
    });

    it('update() stops polling when hidden and resumes when shown', async () => {
        const overlay = makeOverlay();
        await overlay.init();
        await vi.advanceTimersByTimeAsync(0);
        vi.spyOn(overlay, 'save').mockResolvedValue(undefined);

        await overlay.update({ visible: false });
        stdMock.mockClear();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(stdMock).not.toHaveBeenCalled();

        await overlay.update({ visible: true });
        await vi.advanceTimersByTimeAsync(10_000);
        expect(stdMock).toHaveBeenCalled();
        overlay.remove();
    });

    it('remove() stops polling', async () => {
        const overlay = makeOverlay();
        await overlay.init();
        await vi.advanceTimersByTimeAsync(0);

        overlay.remove();
        stdMock.mockClear();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(stdMock).not.toHaveBeenCalled();
    });
});
