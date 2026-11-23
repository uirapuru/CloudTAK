import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serverPatch, serverPost, serverDelete, reconcileOverlays, layersOrder } = vi.hoisted(() => ({
    serverPatch: vi.fn(),
    serverPost: vi.fn(),
    serverDelete: vi.fn(),
    reconcileOverlays: vi.fn(async () => {}),
    layersOrder: { ids: [] as string[] }
}));

vi.mock('../std.ts', () => ({ server: { PATCH: serverPatch, POST: serverPost, DELETE: serverDelete } }));
vi.mock('../stores/map.ts', () => ({
    useMapStore: () => ({
        reconcileOverlays,
        map: { getLayersOrder: () => layersOrder.ids }
    })
}));
vi.mock('../base/overlay-class.ts', () => ({ default: class {} }));
vi.mock('../base/overlay-sync.ts', () => ({
    syncOverlays: vi.fn(),
    OVERLAY_LIST_CACHE_KEY: 'overlay'
}));

import OverlayManager from '../base/overlay.ts';
import type Overlay from '../base/overlay-class.ts';
import { db, type DBOverlay } from '../database.ts';

type StubOverlay = Overlay & {
    moveBefore: ReturnType<typeof vi.fn>;
};

function stub(id: number, name: string, pos: number, mode = 'profile', layered = true): StubOverlay {
    return {
        id, name, pos, mode,
        _internal: mode === 'internal',
        moveBefore: vi.fn(),
        anchorLayerId: () => layered ? `layer-${id}` : undefined,
        layerIds: () => layered ? [`layer-${id}`] : [],
    } as unknown as StubOverlay;
}

function ids(): number[] {
    return OverlayManager.stack().map((overlay) => overlay.id);
}

describe('OverlayManager stack order', () => {
    let basemap: StubOverlay;
    let features: StubOverlay;
    let ordinary: StubOverlay[];

    beforeEach(() => {
        OverlayManager.clearLoaded();
        serverPatch.mockReset();
        serverPost.mockReset();
        serverDelete.mockReset();
        reconcileOverlays.mockReset();
        reconcileOverlays.mockResolvedValue(undefined);
        layersOrder.ids = [];

        basemap = stub(10, 'Basemap', -1, 'basemap');
        features = stub(-1, 'Map Features', 3, 'internal');
        ordinary = [1, 2, 3, 4, 5].map((id) => stub(id, `Overlay ${id}`, id));

        // Registry order is deliberately scrambled - only pos decides the stack
        OverlayManager.appendLoaded(features, ordinary[2], basemap, ordinary[0], ordinary[4], ordinary[1], ordinary[3]);
    });

    it('stack sorts by pos with basemaps pinned bottom and internal overlays top', () => {
        expect(ids()).toEqual([10, 1, 2, 3, 4, 5, -1]);
    });

    it('stack breaks pos ties by id so renames cannot reorder the map', () => {
    it('reorderLoaded moves an overlay into a group even when its position is unchanged', async () => {
        for (const overlay of ordinary) overlay.group_id = null;

        await OverlayManager.reorderLoaded([1, 2, 3, 4, 5], 5, { groupId: 7 });

        expect(ordinary[4].group_id).toBe(7);
        expect(ordinary[4].save).toHaveBeenCalledWith({ group: true });
        expect(ids()).toEqual([10, 1, 2, 3, 4, 5, -1]);
    });

    it('reorderLoaded does not send group_id when the group is unchanged', async () => {
        for (const overlay of ordinary) overlay.group_id = 7;

        await OverlayManager.reorderLoaded([2, 1, 3, 4, 5], 2, { groupId: 7 });

        expect(ordinary[1].save).toHaveBeenCalledWith({ group: false });
        expect(ordinary[1].group_id).toBe(7);
    });

    it('reorderLoaded repairs a stack where every overlay has the same pos', async () => {
        // Overlays created before positions were assigned all carry the API default
        for (const overlay of ordinary) overlay.pos = 5;
        OverlayManager.loaded.sort(OverlayManager.compareStack);

        await OverlayManager.reorderLoaded([3, 1, 2, 4, 5], 3);

        expect(ordinary.map((overlay) => overlay.pos)).toEqual([1, 2, 0, 3, 4]);
        expect(ids()).toEqual([10, 3, 1, 2, 4, 5, -1]);
        // none of the new positions is 5, so every overlay is saved
        for (const overlay of ordinary) expect(overlay.save).toHaveBeenCalledTimes(1);
    });

    it('reorderLoaded restacks the whole map when stale positions move more than the dragged overlay', async () => {
        // Stale positions: the stack order is 5, 4, 3, 2, 1 while the menu shows 1..5
        ordinary.forEach((overlay, i) => { overlay.pos = 10 - i; });
        OverlayManager.loaded.sort(OverlayManager.compareStack);

        await OverlayManager.reorderLoaded([2, 1, 3, 4, 5], 2);

        expect(ids()).toEqual([10, 2, 1, 3, 4, 5, -1]);
        // every overlay was moved, top of the stack first
        for (const overlay of ordinary) expect(overlay.moveBefore).toHaveBeenCalled();
    });

    it('restackLoaded applies a new order to every ordinary overlay', async () => {
        await OverlayManager.restackLoaded([4, 5, 1, 2, 3]);

        expect(ids()).toEqual([10, 4, 5, 1, 2, 3, -1]);
        expect(ordinary.map((overlay) => overlay.pos)).toEqual([2, 3, 4, 0, 1]);
        for (const overlay of ordinary) {
            expect(overlay.save).toHaveBeenCalledWith({ group: false });
            expect(overlay.moveBefore).toHaveBeenCalled();
        }
        expect(basemap.save).not.toHaveBeenCalled();
        expect(features.save).not.toHaveBeenCalled();
    });

    it('regroupLoaded moves several overlays into groups and restacks once', async () => {
        for (const overlay of ordinary) overlay.group_id = null;

        await OverlayManager.regroupLoaded([3, 4, 5, 1, 2], new Map<number, number | null>([[1, 7], [2, 8], [10, 7]]));

        expect(ordinary[0].group_id).toBe(7);
        expect(ordinary[1].group_id).toBe(8);
        // the basemap is pinned - never regrouped
        expect((basemap as { group_id?: number | null }).group_id).toBeUndefined();
        expect(ids()).toEqual([10, 3, 4, 5, 1, 2, -1]);

        expect(ordinary[0].save).toHaveBeenCalledWith({ group: true });
        expect(ordinary[1].save).toHaveBeenCalledWith({ group: true });
        expect(ordinary[2].save).toHaveBeenCalledWith({ group: false });
        expect(basemap.save).not.toHaveBeenCalled();
    });

    it('regroupLoaded does not save an overlay whose group and position stay the same', async () => {
        for (const overlay of ordinary) overlay.group_id = null;
        ordinary.forEach((overlay, i) => { overlay.pos = i; });

        await OverlayManager.regroupLoaded([1, 2, 3, 4, 5], new Map([[5, 9]]));

        expect(ordinary[4].save).toHaveBeenCalledWith({ group: true });
        for (const overlay of ordinary.slice(0, 4)) expect(overlay.save).not.toHaveBeenCalled();
    });

    it('loadedAnchorOverlayFrom skips overlays with no layer on the map yet', () => {
        // Overlay 3 is still loading (or failed): nothing to move layers before
        (ordinary[2] as unknown as { anchorLayerId: () => string | undefined }).anchorLayerId = () => undefined;

        expect(OverlayManager.loadedAnchorOverlayFrom(3)).toBe(ordinary[3]);

        OverlayManager.applyLoadedOrder();
        // Overlay 2 goes below overlay 4, not to the top of the map
        expect(ordinary[1].moveBefore).toHaveBeenCalledWith(ordinary[3]);
    });

        const a = stub(20, 'Zulu', 5);
        const b = stub(21, 'Alpha', 5);
        OverlayManager.appendLoaded(b, a);

        expect(ids()).toEqual([10, 1, 2, 3, 4, 5, 20, 21, -1]);
    });

    it('compareStack pins by overlay kind even when pos is corrupted', () => {
        basemap.pos = 4;
        features.pos = 0;

        expect(ids()).toEqual([10, 1, 2, 3, 4, 5, -1]);
    });

    it('applyOrder anchors every overlay below the next layered overlay', () => {
        const terrain = stub(20, 'Terrain', 6, 'profile', false);
        OverlayManager.appendLoaded(terrain);

        OverlayManager.applyOrder();

        expect(features.moveBefore).toHaveBeenCalledWith(undefined);
        expect(terrain.moveBefore).toHaveBeenCalledWith(features);
        expect(ordinary[4].moveBefore).toHaveBeenCalledWith(features);
        expect(ordinary[3].moveBefore).toHaveBeenCalledWith(ordinary[4]);
        expect(ordinary[0].moveBefore).toHaveBeenCalledWith(ordinary[1]);
        expect(basemap.moveBefore).toHaveBeenCalledWith(ordinary[0]);
    });

    it('applyOrder places a newly synced overlay by pos, not by registry position', () => {
        // A mission subscribed mid-session lands in the registry last but sorts by its pos
        const mission = stub(30, 'Mission', 2.5, 'mission');
        OverlayManager.appendLoaded(mission);

        OverlayManager.applyOrder();

        expect(ordinary[1].moveBefore).toHaveBeenCalledWith(mission);
        expect(mission.moveBefore).toHaveBeenCalledWith(ordinary[2]);
        expect(basemap.moveBefore).toHaveBeenCalledWith(ordinary[0]);
    });

    it('applyOrder leaves the map alone when managed layers already match the stack', () => {
        layersOrder.ids = ['layer-10', 'layer-1', 'layer-2', 'routing-line', 'layer-3', 'layer-4', 'layer-5', 'layer--1'];

        OverlayManager.applyOrder();

        for (const overlay of [basemap, features, ...ordinary]) {
            expect(overlay.moveBefore).not.toHaveBeenCalled();
        }

        layersOrder.ids = ['layer-10', 'layer-2', 'layer-1', 'layer-3', 'layer-4', 'layer-5', 'layer--1'];

        OverlayManager.applyOrder();

        expect(ordinary[0].moveBefore).toHaveBeenCalledWith(ordinary[1]);
    });

    it('createLoaded rolls back a mission overlay whose data failed to load', async () => {
        serverPost.mockResolvedValue({ data: { id: 40, name: 'Mission', mode: 'mission', mode_id: 'guid', pos: 6 } });
        serverDelete.mockResolvedValue({ response: { status: 200 } });

        reconcileOverlays.mockImplementation(async () => {
            if (!OverlayManager.loadedFrom(40)) {
                const mission = stub(40, 'Mission', 6, 'mission');
                mission._load = Promise.resolve(null);
                OverlayManager.appendLoaded(mission);
            }
        });

        await expect(OverlayManager.createLoaded({
            name: 'Mission', mode: 'mission', mode_id: 'guid', url: '/mission/guid', type: 'geojson'
        })).rejects.toThrow('Failed to load the Data Sync');

        expect(serverDelete).toHaveBeenCalledTimes(1);
        expect(reconcileOverlays).toHaveBeenCalledTimes(2);
    });

    it('reorderLoaded persists the ordinary order, mirrors pos locally and reconciles', async () => {
        await db.overlay.bulkPut(OverlayManager.loaded.map((overlay) => ({
            id: overlay.id, name: overlay.name, pos: overlay.pos, mode: overlay.mode
        }) as DBOverlay));

        serverPatch.mockResolvedValue({
            data: { items: [2, 1, 3, 4, 5].map((id, pos) => ({ id, pos })) }
        });

        await OverlayManager.reorderLoaded([10, 2, 1, 3, 4, 5, -1]);

        expect(serverPatch).toHaveBeenCalledWith('/api/profile/overlay/order', {
            body: { ids: [2, 1, 3, 4, 5] }
        });

        expect((await db.overlay.get(2))?.pos).toBe(0);
        expect((await db.overlay.get(1))?.pos).toBe(1);
        expect((await db.overlay.get(10))?.pos).toBe(-1);
        expect(reconcileOverlays).toHaveBeenCalledTimes(1);
    });

    it('reorderLoaded surfaces API failures without touching local state', async () => {
        serverPatch.mockResolvedValue({ error: { message: 'nope' } });

        await expect(OverlayManager.reorderLoaded([2, 1])).rejects.toThrow('nope');
        expect(reconcileOverlays).not.toHaveBeenCalled();
    });
});
