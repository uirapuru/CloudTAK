import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const created = vi.hoisted(() => ({ before: [] as Array<string | undefined> }));

vi.mock('../std.ts', () => ({ server: {} }));
vi.mock('../base/overlay-sync.ts', () => ({
    syncOverlays: vi.fn(),
    OVERLAY_LIST_CACHE_KEY: 'overlay'
}));
vi.mock('../base/overlay-class.ts', () => ({
    default: class {
        static async create(body: { id: number; name: string; mode: string }, opts: { before?: string }) {
            created.before.push(opts.before);
            return stub(body.id, body.name, 5, body.mode);
        }
    }
}));

import OverlayManager from '../base/overlay.ts';
import type Overlay from '../base/overlay-class.ts';

type StubOverlay = Overlay & { save: ReturnType<typeof vi.fn> };

function stub(id: number, name: string, pos: number, mode = 'profile', group_id: number | null = null): StubOverlay {
    return {
        id, name, pos, mode, group_id,
        _internal: mode === 'internal',
        save: vi.fn(async () => {}),
        moveBefore: vi.fn(),
        anchorLayerId: () => `layer-${id}`,
    } as unknown as StubOverlay;
}

function ids(): number[] {
    return OverlayManager.loaded.map((overlay) => overlay.id);
}

async function add(id: number, name: string, mode = 'overlay'): Promise<StubOverlay> {
    return await OverlayManager.createLoaded({ id, name, mode } as unknown as Parameters<typeof OverlayManager.createLoaded>[0]) as StubOverlay;
}

describe('OverlayManager.createLoaded placement', () => {
    beforeEach(() => {
        OverlayManager.clearLoaded();
        created.before = [];

        // Stack bottom first: basemap, ungrouped 1 2, grouped 3, Map Features
        OverlayManager.appendLoaded(
            stub(10, 'Basemap', -1, 'basemap'),
            stub(1, 'A', 0),
            stub(2, 'B', 1),
            stub(3, 'C', 2, 'profile', 7),
            stub(-1, 'Map Features', 3, 'internal'),
        );
    });

    it('puts a new overlay on top of the ungrouped ones, below the groups, and saves the positions', async () => {
        const overlay = await add(20, 'Nowa');

        expect(ids()).toEqual([10, 1, 2, 20, 3, -1]);
        // Its layers go below the first grouped overlay
        expect(created.before).toEqual(['layer-3']);
        expect(overlay.pos).toBe(2);
        expect(overlay.save).toHaveBeenCalledWith({ group: false });
        expect((OverlayManager.loaded[4] as StubOverlay).pos).toBe(3);
    });

    it('goes to the top of the ordinary stack when there are no groups', async () => {
        OverlayManager.loaded.splice(3, 1);

        await add(20, 'Nowa');

        expect(ids()).toEqual([10, 1, 2, 20, -1]);
        expect(created.before).toEqual(['layer--1']);
    });

    it('repairs overlays that all share the default pos', async () => {
        for (const overlay of OverlayManager.loaded) if (overlay.mode === 'profile') overlay.pos = 5;

        await add(20, 'Nowa');

        expect(OverlayManager.loaded.filter((o) => !OverlayManager.isPinned(o)).map((o) => [o.id, o.pos])).toEqual([[1, 0], [2, 1], [20, 2], [3, 3]]);
    });

    it('lifts grouped overlays above a new one even when they sat low in the stack', async () => {
        // Legacy order: the grouped overlay 3 below the ungrouped ones
        const grouped = OverlayManager.loaded.splice(3, 1)[0];
        OverlayManager.loaded.splice(1, 0, grouped);

        await add(20, 'Nowa');

        expect(ids()).toEqual([10, 1, 2, 20, 3, -1]);
    });

    it('adds overlays one after another so the last one is on top', async () => {
        await add(20, 'X');
        await add(21, 'Y');

        expect(ids()).toEqual([10, 1, 2, 20, 21, 3, -1]);
    });

    it('keeps a new basemap pinned at the bottom', async () => {
        OverlayManager.loaded.splice(0, 1);

        await add(11, 'Nowa bazowa', 'basemap');

        expect(ids()[0]).toBe(11);
    });
});
