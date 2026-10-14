import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feature } from 'geojson';

const std = vi.fn();
const loaded: Array<{ id: number; mode: string; mode_id: string | null }> = [];

vi.mock('../std.ts', () => ({ std: (...args: unknown[]) => std(...args) }));
vi.mock('./overlay.ts', () => ({
    default: {
        loadedFrom: (id: number) => loaded.find((o) => o.id === id),
    },
}));

import { RouteToggle, fetchDetail, liveFeatureRef, safeHttpUrl, LIVE_ROUTE_LAYER, LIVE_ROUTE_SOURCE, LIVE_ROUTE_FILL_LAYER, routeToggleLabel } from './live-detail.ts';

function fakeMap() {
    const sources = new Map<string, unknown>();
    const layers = new Map<string, Record<string, unknown>>();
    return {
        sources,
        layers,
        addSource: vi.fn((id: string, src: unknown) => {
            if (sources.has(id)) throw new Error(`Source ${id} exists`);
            sources.set(id, src);
        }),
        addLayer: vi.fn((layer: Record<string, unknown>) => {
            if (layers.has(layer.id as string)) throw new Error(`Layer ${layer.id} exists`);
            layers.set(layer.id as string, layer);
        }),
        getSource: vi.fn((id: string) => sources.get(id)),
        getLayer: vi.fn((id: string) => layers.get(id)),
        removeLayer: vi.fn((id: string) => {
            if (!layers.has(id)) throw new Error(`No layer ${id}`);
            layers.delete(id);
        }),
        removeSource: vi.fn((id: string) => {
            if (!sources.has(id)) throw new Error(`No source ${id}`);
            if ([...layers.values()].some((l) => l.source === id)) throw new Error('Source in use');
            sources.delete(id);
        }),
    };
}

const ROUTE: Feature = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[17, 51], [18, 52]] },
    properties: { _color: '#ff0000', label: 'Trasa orientacyjna' },
};

describe('RouteToggle', () => {
    it('show adds a dashed line source and layer in the route colour', () => {
        const map = fakeMap();
        const toggle = new RouteToggle();
        toggle.show(map as never, ROUTE);

        expect(toggle.visible).toBe(true);
        expect(map.sources.get(LIVE_ROUTE_SOURCE)).toEqual({ type: 'geojson', data: ROUTE });
        const layer = map.layers.get(LIVE_ROUTE_LAYER) as { type: string; source: string; paint: Record<string, unknown> };
        expect(layer.type).toBe('line');
        expect(layer.source).toBe(LIVE_ROUTE_SOURCE);
        expect(layer.paint['line-dasharray']).toEqual([2, 2]);
        expect(layer.paint['line-width']).toBe(3);
        expect(layer.paint['line-color']).toBe('#ff0000');
    });

    it('falls back to a dark colour without _color', () => {
        const map = fakeMap();
        new RouteToggle().show(map as never, { ...ROUTE, properties: {} });
        const layer = map.layers.get(LIVE_ROUTE_LAYER) as { paint: Record<string, unknown> };
        expect(layer.paint['line-color']).toBe('#111827');
    });

    it('hide removes both, and a second hide does not throw', () => {
        const map = fakeMap();
        const toggle = new RouteToggle();
        toggle.show(map as never, ROUTE);
        toggle.hide(map as never);
        expect(map.sources.size).toBe(0);
        expect(map.layers.size).toBe(0);
        expect(toggle.visible).toBe(false);
        expect(() => toggle.hide(map as never)).not.toThrow();
    });

    it('showing again replaces the previous route instead of throwing', () => {
        const map = fakeMap();
        const toggle = new RouteToggle();
        toggle.show(map as never, ROUTE);
        toggle.show(map as never, { ...ROUTE, properties: { _color: '#00ff00' } });
        expect(map.sources.size).toBe(1);
        const layer = map.layers.get(LIVE_ROUTE_LAYER) as { paint: Record<string, unknown> };
        expect(layer.paint['line-color']).toBe('#00ff00');
    });
});

describe('RouteToggle polygons', () => {
    const POLY = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[17, 51], [18, 51], [18, 52], [17, 51]]] },
        properties: { _color: '#00aa00' },
    } as never;

    it('adds a fill under a solid outline and hide removes both', () => {
        const map = fakeMap();
        const toggle = new RouteToggle();
        toggle.show(map as never, POLY);
        const ids = [...map.layers.keys()];
        expect(ids).toEqual([LIVE_ROUTE_FILL_LAYER, LIVE_ROUTE_LAYER]);
        const fill = map.layers.get(LIVE_ROUTE_FILL_LAYER) as { type: string; paint: Record<string, unknown> };
        expect(fill.type).toBe('fill');
        expect(fill.paint['fill-color']).toBe('#00aa00');
        expect(fill.paint['fill-opacity']).toBe(0.25);
        const line = map.layers.get(LIVE_ROUTE_LAYER) as { paint: Record<string, unknown> };
        expect(line.paint['line-width']).toBe(2);
        expect(line.paint['line-dasharray']).toBeUndefined();
        toggle.hide(map as never);
        expect(map.layers.size).toBe(0);
        expect(map.sources.size).toBe(0);
        expect(() => toggle.hide(map as never)).not.toThrow();
    });

    it('uses numeric _fill_opacity in [0,1] only', () => {
        const opacity = (v: unknown) => {
            const map = fakeMap();
            new RouteToggle().show(map as never, { ...(POLY as object), properties: { _fill_opacity: v } } as never);
            return (map.layers.get(LIVE_ROUTE_FILL_LAYER) as { paint: Record<string, unknown> }).paint['fill-opacity'];
        };
        expect(opacity(0.6)).toBe(0.6);
        expect(opacity(0)).toBe(0);
        expect(opacity(2)).toBe(0.25);
        expect(opacity('0.5')).toBe(0.25);
    });

    it('LineString routes get no fill layer', () => {
        const map = fakeMap();
        new RouteToggle().show(map as never, ROUTE);
        expect(map.layers.has(LIVE_ROUTE_FILL_LAYER)).toBe(false);
    });
});

describe('routeToggleLabel', () => {
    it('defaults to "trasę"', () => {
        expect(routeToggleLabel({}, false)).toBe('Pokaż trasę');
        expect(routeToggleLabel({ route_label: '  ' }, true)).toBe('Ukryj trasę');
        expect(routeToggleLabel(undefined, false)).toBe('Pokaż trasę');
    });
    it('uses a trimmed route_label capped at 40 chars', () => {
        expect(routeToggleLabel({ route_label: ' zasięg ' }, false)).toBe('Pokaż zasięg');
        expect(routeToggleLabel({ route_label: 'zasięg' }, true)).toBe('Ukryj zasięg');
        expect(routeToggleLabel({ route_label: 'x'.repeat(60) }, false)).toBe(`Pokaż ${'x'.repeat(40)}`);
    });
});

describe('safeHttpUrl', () => {
    it('accepts absolute http and https URLs', () => {
        expect(safeHttpUrl('https://t.plnspttrs.net/1.jpg')).toBe('https://t.plnspttrs.net/1.jpg');
        expect(safeHttpUrl('http://example.com/a')).toBe('http://example.com/a');
    });

    it('rejects other schemes, relative paths and garbage', () => {
        expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
        expect(safeHttpUrl('JaVaScRiPt:alert(1)')).toBeNull();
        expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
        expect(safeHttpUrl('/api/photo.jpg')).toBeNull();
        expect(safeHttpUrl('not a url')).toBeNull();
        expect(safeHttpUrl('')).toBeNull();
        expect(safeHttpUrl(undefined)).toBeNull();
        expect(safeHttpUrl(42)).toBeNull();
    });
});

describe('fetchDetail', () => {
    beforeEach(() => std.mockReset());

    it('encodes layer and id in the URL', async () => {
        std.mockResolvedValue({ properties: { Typ: 'A320' } });
        const detail = await fetchDetail('adsb', 'a:b c');
        expect(std).toHaveBeenCalledWith('/api/live/adsb/a%3Ab%20c');
        expect(detail.properties).toEqual({ Typ: 'A320' });
    });
});

describe('liveFeatureRef', () => {
    beforeEach(() => {
        loaded.length = 0;
        loaded.push({ id: 7, mode: 'live', mode_id: 'adsb' }, { id: 8, mode: 'overlay', mode_id: '3' });
    });

    it('returns the layer and id of a live feature with _detail', () => {
        expect(liveFeatureRef({ source: '7', properties: { _detail: true, _id: '48ae21' } } as never))
            .toEqual({ layer: 'adsb', id: '48ae21' });
    });

    it('returns null for a non-live overlay', () => {
        expect(liveFeatureRef({ source: '8', properties: { _detail: true, _id: 'x' } } as never)).toBeNull();
    });

    it('returns null without _detail or _id', () => {
        expect(liveFeatureRef({ source: '7', properties: { _id: 'x' } } as never)).toBeNull();
        expect(liveFeatureRef({ source: '7', properties: { _detail: true } } as never)).toBeNull();
        expect(liveFeatureRef(undefined)).toBeNull();
    });
});
