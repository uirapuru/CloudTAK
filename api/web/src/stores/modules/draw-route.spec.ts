import { beforeEach, describe, expect, it, vi } from 'vitest';

const editors: Array<{ opts: Record<string, unknown>; start: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; result: ReturnType<typeof vi.fn> }> = [];
const terra = {
    updateModeOptions: vi.fn<(...args: unknown[]) => void>(),
    addFeatures: vi.fn<(...args: unknown[]) => Array<{ valid: boolean }>>(() => [{ valid: true }]),
    selectFeature: vi.fn<(...args: unknown[]) => void>(),
    start: vi.fn(),
    stop: vi.fn(),
    setMode: vi.fn<(...args: unknown[]) => void>(),
};
const push = vi.fn();

vi.mock('terra-draw', () => {
    class Mode { constructor(public options?: unknown) {} }
    return {
        TerraDraw: class {
            on() { return undefined; }
            updateModeOptions(...args: unknown[]) { return terra.updateModeOptions(...args); }
            addFeatures(...args: unknown[]) { return terra.addFeatures(...args); }
            selectFeature(...args: unknown[]) { return terra.selectFeature(...args); }
            start() { return terra.start(); }
            stop() { return terra.stop(); }
            setMode(...args: unknown[]) { return terra.setMode(...args); }
            getSnapshot() { return []; }
        },
        TerraDrawPointMode: Mode,
        TerraDrawLineStringMode: Mode,
        TerraDrawPolygonMode: Mode,
        TerraDrawAngledRectangleMode: Mode,
        TerraDrawFreehandMode: Mode,
        TerraDrawSectorMode: Mode,
        TerraDrawCircleMode: Mode,
        TerraDrawSelectMode: Mode,
    };
});
vi.mock('terra-draw-maplibre-gl-adapter', () => ({ TerraDrawMapLibreGLAdapter: class {} }));
vi.mock('terra-route', () => ({ TerraRoute: class { buildRouteGraph() {} expandRouteGraph() {} } }));
vi.mock('terra-draw-route-snap-mode', () => ({
    Routing: class { setNetwork() {} expandRouteNetwork() {} },
    TerraDrawRouteSnapMode: class {},
}));
vi.mock('../../router.ts', () => ({ default: { push: (...args: unknown[]) => push(...args) } }));
vi.mock('../../base/filter.ts', () => ({ default: { create: vi.fn(), delete: vi.fn() } }));
vi.mock('../../std.ts', () => ({ std: vi.fn(), stdurl: (u: string) => new URL(u, 'http://localhost'), server: { GET: vi.fn() } }));
vi.mock('../../base/overlay.ts', () => ({ default: {} }));
vi.mock('../../base/route-editor.ts', () => ({
    default: class {
        start = vi.fn();
        destroy = vi.fn();
        result = vi.fn(() => ({ id: 'route-1', type: 'Feature', path: '/', properties: { callsign: 'Pieszo', center: [0, 0] }, geometry: { type: 'LineString', coordinates: [[21, 52], [21.1, 52.1]] } }));
        removeWaypoint = vi.fn();
        constructor(_map: unknown, public opts: Record<string, unknown>) {
            editors.push(this as never);
        }
    },
}));

import DrawTool, { DrawToolMode } from './draw.ts';

const plan = { version: 1, mode: 'foot', mode_name: 'Pieszo', waypoints: [[21, 52], [21.1, 52.1]], legs: [{ start: 0, end: 1, distance_m: 1, duration_s: 1 }] };

function mapStore() {
    return {
        map: { on: vi.fn(), getCanvas: () => ({ style: { cursor: '' } }), getBounds: () => ({ toArray: () => [[0, 0], [1, 1]] }), getLayer: vi.fn(), getSource: vi.fn() },
        defaultPointType: 'u-d-p',
        worker: { db: {
            hide: vi.fn(), unhide: vi.fn(), snapping: vi.fn(async () => new Set()),
            add: vi.fn(async (f: { id: string }) => ({ id: f.id, flyTo: vi.fn() })),
        } },
        refresh: vi.fn(),
        loadMission: vi.fn(),
    };
}

function cot(properties: Record<string, unknown>, route = true) {
    const feature = { id: 'route-1', type: 'Feature', path: '/', properties: { callsign: 'Trasa', ...properties }, geometry: { type: 'LineString', coordinates: [[21, 52], [21.1, 52.1]] } };
    return {
        id: 'route-1',
        is_route: route,
        origin: { mode: 'Connection' },
        properties: feature.properties,
        as_feature: () => structuredClone(feature),
    };
}

describe('DrawTool i edytor trasy', () => {
    beforeEach(() => {
        editors.length = 0;
        vi.clearAllMocks();
        vi.stubGlobal('matchMedia', () => ({ matches: false }));
    });

    it('edycja trasy z planem otwiera edytor trasy zamiast terra-draw', async () => {
        const store = mapStore();
        const tool = new DrawTool(store as never);
        await tool.edit(cot({ type: 'b-m-r', metadata: { taklab_route: plan } }) as never);
        expect(tool.mode).toBe(DrawToolMode.ROUTE);
        expect(editors).toHaveLength(1);
        expect(editors[0].opts.mode).toBe('edit');
        expect(editors[0].start).toHaveBeenCalled();
        expect(terra.addFeatures).not.toHaveBeenCalled();
        expect(store.worker.db.hide).toHaveBeenCalledWith('route-1');
    });

    it('trasa bez planu idzie do terra-draw, ale bez przenoszenia całej linii', async () => {
        const tool = new DrawTool(mapStore() as never);
        await tool.edit(cot({ type: 'b-m-r' }) as never);
        expect(editors).toHaveLength(0);
        const [mode, options] = terra.updateModeOptions.mock.calls.at(-1) as [string, { flags: { linestring: { feature: { draggable: boolean } } } }];
        expect(mode).toBe('select');
        expect(options.flags.linestring.feature.draggable).toBe(false);
    });

    it('edycja figury ustawia opcje zaznaczania dopiero po uruchomieniu terra-draw', async () => {
        // Prawdziwy TerraDraw rzuca „Terra Draw is not enabled” przed start()
        let started = false;
        terra.start.mockImplementation(() => { started = true; });
        terra.stop.mockImplementation(() => { started = false; });
        terra.updateModeOptions.mockImplementation(() => {
            if (!started) throw new Error('Terra Draw is not enabled');
        });
        try {
            const tool = new DrawTool(mapStore() as never);
            const rectangle = {
                ...cot({ type: 'u-d-r' }, false),
                as_feature: () => ({ id: 'route-1', type: 'Feature', path: '/', properties: { callsign: 'Prostokąt', type: 'u-d-r' }, geometry: { type: 'Polygon', coordinates: [[[21, 52], [21.1, 52], [21.1, 52.1], [21, 52.1], [21, 52]]] } }),
            };
            await expect(tool.edit(rectangle as never)).resolves.toBeUndefined();
            expect(terra.selectFeature).toHaveBeenCalledWith('route-1');
        } finally {
            terra.start.mockReset();
            terra.stop.mockReset();
            terra.updateModeOptions.mockReset();
        }
    });

    it('zwykłą linię dalej można przenieść', async () => {
        const tool = new DrawTool(mapStore() as never);
        await tool.edit(cot({ type: 'u-d-f' }, false) as never);
        const [, options] = terra.updateModeOptions.mock.calls.at(-1) as [string, { flags: { linestring: { feature: { draggable: boolean } } } }];
        expect(options.flags.linestring.feature.draggable).toBe(true);
    });

    it('zatwierdzenie edycji zapisuje wynik edytora jako zmianę usera', async () => {
        const store = mapStore();
        const tool = new DrawTool(store as never);
        await tool.edit(cot({ type: 'b-m-r', metadata: { taklab_route: plan } }) as never);
        await tool.finish();
        expect(store.worker.db.add).toHaveBeenCalledWith(expect.objectContaining({ id: 'route-1' }), { authored: true });
        const saved = store.worker.db.add.mock.calls[0][0] as unknown as { properties: Record<string, unknown> };
        expect(saved.properties.center).toBeUndefined();
        expect(editors[0].destroy).toHaveBeenCalled();
        expect(store.worker.db.unhide).toHaveBeenCalledWith('route-1');
        expect(tool.mode).toBe(DrawToolMode.STATIC);
    });

    it('anulowanie niszczy edytor i niczego nie zapisuje', async () => {
        const store = mapStore();
        const tool = new DrawTool(store as never);
        await tool.edit(cot({ type: 'b-m-r', metadata: { taklab_route: plan } }) as never);
        await tool.stop();
        expect(editors[0].destroy).toHaveBeenCalled();
        expect(store.worker.db.add).not.toHaveBeenCalled();
        expect(terra.stop).not.toHaveBeenCalled();
    });

    it('budowanie trasy zapisuje ją z nazwą z menu i otwiera jej kartę', async () => {
        const store = mapStore();
        const tool = new DrawTool(store as never);
        await tool.buildRoute({ travelMode: 'foot', start: [21, 52], callsign: 'A to B' });
        expect(editors[0].opts.mode).toBe('build');
        expect(editors[0].opts.waypoints).toEqual([[21, 52]]);
        await tool.finish();
        const saved = store.worker.db.add.mock.calls[0][0] as unknown as { properties: Record<string, unknown> };
        expect(saved.properties.callsign).toBe('A to B');
        expect(push).toHaveBeenCalledWith('/cot/route-1');
    });
});
