import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers: Record<string, (...args: unknown[]) => unknown> = {};
const snapshot: Array<Record<string, unknown>> = [];
const removed: unknown[] = [];

const RECTANGLE = {
    id: 'drawn-1',
    type: 'Feature',
    properties: { mode: 'angled-rectangle' },
    geometry: { type: 'Polygon', coordinates: [[[21, 52], [21.1, 52], [21.1, 52.2], [21, 52.2], [21, 52]]] },
};

vi.mock('terra-draw', () => {
    class Mode { constructor(public options?: unknown) {} }
    return {
        TerraDraw: class {
            on(event: string, cb: (...args: unknown[]) => unknown) { handlers[event] = cb; }
            updateModeOptions() {}
            start() {}
            stop() {}
            setMode() {}
            getSnapshot() { return snapshot; }
            getSnapshotFeature(id: string) { return snapshot.find((f) => f.id === id); }
            removeFeatures(ids: unknown[]) { removed.push(...ids); }
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
const push = vi.fn();
vi.mock('../../router.ts', () => ({ default: { push: (...args: unknown[]) => push(...args) } }));
vi.mock('../../base/filter.ts', () => ({ EDIT_HIDE_PREFIX: 'hidden-', default: { create: vi.fn(), delete: vi.fn() } }));
vi.mock('../../std.ts', () => ({ std: vi.fn(), stdurl: (u: string) => new URL(u, 'http://localhost'), server: { GET: vi.fn() } }));
vi.mock('../../base/overlay.ts', () => ({ default: { visible: () => [] } }));
vi.mock('../../base/route-editor.ts', () => ({ default: class {} }));

import DrawTool, { DrawToolMode } from './draw.ts';

function mapStore() {
    return {
        map: { on: vi.fn(), getCanvas: () => ({ style: { cursor: '' }, dispatchEvent: vi.fn() }), getBounds: () => ({ toArray: () => [[0, 0], [1, 1]] }), getLayer: vi.fn(), getSource: vi.fn() },
        defaultPointType: 'u-d-p',
        worker: { db: {
            snapping: vi.fn(async () => new Set()),
            add: vi.fn(async (f: { id: string }) => ({ id: f.id })),
        } },
        refresh: vi.fn(),
    };
}

describe('DrawTool capture', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        snapshot.length = 0;
        removed.length = 0;
        vi.stubGlobal('matchMedia', () => ({ matches: false }));
    });

    it('a finished rectangle goes to the capture callback, not to the map', async () => {
        const store = mapStore();
        const tool = new DrawTool(store as never);
        const capture = vi.fn();

        await tool.start(DrawToolMode.RECTANGLE, { capture });
        snapshot.push(RECTANGLE);

        await handlers.finish('drawn-1', { action: 'draw' });

        expect(capture).toHaveBeenCalledWith(RECTANGLE.geometry);
        expect(store.worker.db.add).not.toHaveBeenCalled();
        expect(push).not.toHaveBeenCalled();
        expect(removed).toContain('drawn-1');
        expect(tool.mode).toBe(DrawToolMode.STATIC);
    });

    it('the finish button also captures the rectangle', async () => {
        const store = mapStore();
        const tool = new DrawTool(store as never);
        const capture = vi.fn();

        await tool.start(DrawToolMode.RECTANGLE, { capture });
        snapshot.push(RECTANGLE);

        await tool.finish();

        expect(capture).toHaveBeenCalledWith(RECTANGLE.geometry);
        expect(store.worker.db.add).not.toHaveBeenCalled();
    });

    it('capture is one-shot: the next rectangle is drawn on the map as usual', async () => {
        const store = mapStore();
        const tool = new DrawTool(store as never);
        const capture = vi.fn();

        await tool.start(DrawToolMode.RECTANGLE, { capture });
        snapshot.push(RECTANGLE);
        await handlers.finish('drawn-1', { action: 'draw' });

        await tool.start(DrawToolMode.RECTANGLE);
        await handlers.finish('drawn-1', { action: 'draw' });

        expect(capture).toHaveBeenCalledTimes(1);
        expect(store.worker.db.add).toHaveBeenCalledTimes(1);
    });

    it('stopping the tool drops a pending capture', async () => {
        const store = mapStore();
        const tool = new DrawTool(store as never);
        const capture = vi.fn();

        await tool.start(DrawToolMode.RECTANGLE, { capture });
        await tool.stop();

        await tool.start(DrawToolMode.RECTANGLE);
        snapshot.push(RECTANGLE);
        await handlers.finish('drawn-1', { action: 'draw' });

        expect(capture).not.toHaveBeenCalled();
    });
});
