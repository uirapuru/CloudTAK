import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../std.ts', () => ({ server: {} }));
vi.mock('../base/overlay-class.ts', () => ({ default: class {} }));
vi.mock('../base/overlay-sync.ts', () => ({
    syncOverlays: vi.fn(),
    OVERLAY_LIST_CACHE_KEY: 'overlay'
}));

import OverlayManager from '../base/overlay.ts';
import type Overlay from '../base/overlay-class.ts';

type StubOverlay = Overlay & {
    save: ReturnType<typeof vi.fn>;
    moveBefore: ReturnType<typeof vi.fn>;
};

function stub(id: number, name: string, pos: number, mode = 'profile', layered = true): StubOverlay {
    return {
        id, name, pos, mode,
        _internal: mode === 'internal',
        save: vi.fn(async () => {}),
        moveBefore: vi.fn(),
        anchorLayerId: () => layered ? `layer-${id}` : undefined,
    } as unknown as StubOverlay;
}

function ids(): number[] {
    return OverlayManager.loaded.map((overlay) => overlay.id);
}

describe('OverlayManager stack order', () => {
    let basemap: StubOverlay;
    let features: StubOverlay;
    let ordinary: StubOverlay[];

    beforeEach(() => {
        OverlayManager.clearLoaded();

        basemap = stub(10, 'Basemap', -1, 'basemap');
        features = stub(-1, 'Map Features', 3, 'internal');
        ordinary = [1, 2, 3, 4, 5].map((id) => stub(id, `Overlay ${id}`, id));

        OverlayManager.appendLoaded(basemap, ...ordinary, features);
    });

    it('reorderLoaded leaves pinned overlays untouched', async () => {
        await OverlayManager.reorderLoaded([10, 2, 1, 3, 4, 5, -1], 2);

        expect(basemap.pos).toBe(-1);
        expect(features.pos).toBe(3);
        expect(basemap.save).not.toHaveBeenCalled();
        expect(features.save).not.toHaveBeenCalled();

        expect(ids()).toEqual([10, 2, 1, 3, 4, 5, -1]);
        expect(ordinary[1].save).toHaveBeenCalledTimes(1);
        expect(ordinary[1].moveBefore).toHaveBeenCalledWith(ordinary[0]);
    });

    it('reorderLoaded refuses to move a pinned overlay', async () => {
        await expect(OverlayManager.reorderLoaded([1, 10, 2, 3, 4, 5, -1], 10)).rejects.toThrow('fixed');
        expect(ids()).toEqual([10, 1, 2, 3, 4, 5, -1]);
    });

    it('reorderLoaded cannot drop an overlay beyond a pinned one', async () => {
        await OverlayManager.reorderLoaded([1, 10, 2, 3, 4, 5, -1], 1);

        expect(ids()[0]).toBe(10);
        expect(ids()[ids().length - 1]).toBe(-1);
        expect(ordinary[0].moveBefore).toHaveBeenCalledWith(OverlayManager.loaded[2]);
    });

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

    it('applyLoadedOrder skips overlays with no map layers when anchoring', () => {
        const terrain = stub(20, 'Terrain', 6, 'profile', false);
        OverlayManager.loaded.splice(OverlayManager.loaded.length - 1, 0, terrain);
        expect(ids()).toEqual([10, 1, 2, 3, 4, 5, 20, -1]);

        OverlayManager.applyLoadedOrder();

        expect(features.moveBefore).toHaveBeenCalledWith(undefined);
        expect(terrain.moveBefore).toHaveBeenCalledWith(features);
        expect(ordinary[4].moveBefore).toHaveBeenCalledWith(features);
        expect(ordinary[3].moveBefore).toHaveBeenCalledWith(ordinary[4]);
        expect(basemap.moveBefore).toHaveBeenCalledWith(ordinary[0]);
    });

    it('reorderLoaded skips overlays with no map layers when anchoring', async () => {
        const terrain = stub(20, 'Terrain', 3, 'profile', false);
        OverlayManager.loaded.splice(3, 0, terrain);

        await OverlayManager.reorderLoaded([10, 1, 5, 2, 20, 3, 4, -1], 5);

        expect(ids()).toEqual([10, 1, 5, 2, 20, 3, 4, -1]);
        expect(ordinary[4].moveBefore).toHaveBeenCalledWith(ordinary[1]);

        await OverlayManager.reorderLoaded([10, 1, 2, 20, 5, 3, 4, -1], 5);

        expect(ids()).toEqual([10, 1, 2, 20, 5, 3, 4, -1]);
        expect(ordinary[4].moveBefore).toHaveBeenLastCalledWith(ordinary[2]);

        await OverlayManager.reorderLoaded([10, 1, 2, 5, 20, 3, 4, -1], 5);

        expect(ids()).toEqual([10, 1, 2, 5, 20, 3, 4, -1]);
        expect(ordinary[4].moveBefore).toHaveBeenLastCalledWith(ordinary[2]);
    });

    it('compareStack pins by overlay kind even when pos is corrupted', () => {
        basemap.pos = 4;
        features.pos = 0;

        OverlayManager.loaded.sort(OverlayManager.compareStack);

        expect(ids()).toEqual([10, 1, 2, 3, 4, 5, -1]);
    });
});
