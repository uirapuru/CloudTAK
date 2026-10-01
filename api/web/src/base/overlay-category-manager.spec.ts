import { beforeEach, describe, expect, it, vi } from 'vitest';

type Group = { id: number; name: string; pos: number; collapsed: boolean };
type Loaded = { id: number; mode: string; group_id: number | null };

const state = vi.hoisted(() => ({
    groups: [] as Group[],
    loaded: [] as Loaded[],
    nextId: 100,
    regroup: vi.fn(async (_order: number[], _groups: Map<number, number | null>) => {}),
    update: vi.fn(async (id: number, body: object) => ({ id, ...body })),
}));

vi.mock('./overlay-group-manager.ts', () => ({
    default: {
        list: async () => state.groups.map((group) => ({ ...group })),
        create: vi.fn(async (name: string) => {
            // Like the server: a new group goes on top
            const pos = Math.min(0, ...state.groups.map((group) => group.pos)) - 1;
            const group = { id: state.nextId++, name, pos, collapsed: false };
            state.groups.push(group);
            return { ...group };
        }),
        update: state.update,
    },
}));
vi.mock('./overlay.ts', () => ({
    default: {
        get loaded() { return state.loaded; },
        isPinned: (o: Loaded) => o.mode === 'basemap' || o.mode === 'internal',
        regroupLoaded: state.regroup,
        loadedFrom: (id: number) => state.loaded.find((o) => o.id === id),
    },
}));

import CategoryPlacer, { syncCatalogNames } from './overlay-category-manager.ts';

describe('CategoryPlacer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.nextId = 100;
        state.groups = [
            { id: 1, name: 'Moje', pos: 0, collapsed: false },
            { id: 2, name: 'Woda', pos: 1, collapsed: false },
            { id: 3, name: 'Transport', pos: 2, collapsed: false },
        ];
        // Map stack, bottom first: basemap, 10, 11 (in Woda), 12, Map Features
        state.loaded = [
            { id: 0, mode: 'basemap', group_id: null },
            { id: 10, mode: 'overlay', group_id: null },
            { id: 11, mode: 'overlay', group_id: 2 },
            { id: 12, mode: 'live', group_id: null },
            { id: -1, mode: 'internal', group_id: null },
        ];
    });

    it('reuses an existing category group', async () => {
        const placer = await CategoryPlacer.load();
        const group = await placer.groupFor('Woda');

        expect(group.id).toBe(2);
        expect(placer.created).toEqual([]);
        expect(state.update).not.toHaveBeenCalled();
    });

    it('creates a missing category group between the category groups in the category order', async () => {
        const placer = await CategoryPlacer.load();
        const group = await placer.groupFor('Lotnictwo');

        expect(group.name).toBe('Lotnictwo');
        expect(placer.created).toEqual(['Lotnictwo']);
        // Moje 0, Woda 1, Lotnictwo 2, Transport 3
        expect(group.pos).toBe(2);
        expect(state.update).toHaveBeenCalledWith(group.id, { pos: 2 });
        expect(state.update).toHaveBeenCalledWith(3, { pos: 3 });
        expect(state.update).not.toHaveBeenCalledWith(1, expect.anything());
    });

    it('puts a new overlay on top of its category group', async () => {
        const placer = await CategoryPlacer.load();
        await placer.place([{ id: 12, category: 'Woda' }], 'top');

        // Menu, top first: Woda [12, 11], ungrouped [10] -> stack bottom first: 10, 11, 12
        expect(state.regroup).toHaveBeenCalledWith([10, 11, 12], new Map([[12, 2]]));
    });

    it('moves ungrouped overlays below the overlays already in their group, creating groups once', async () => {
        const placer = await CategoryPlacer.load();
        await placer.place([{ id: 12, category: 'Woda' }, { id: 10, category: 'Kosmos' }], 'bottom');

        expect(placer.created).toEqual(['Kosmos']);
        const kosmos = state.groups.find((group) => group.name === 'Kosmos') as Group;

        const [order, groups] = state.regroup.mock.calls[0];
        // Menu, top first: Moje [], Woda [11, 12], Transport [], Kosmos [10]
        expect(order).toEqual([10, 12, 11]);
        expect(groups).toEqual(new Map([[12, 2], [10, kosmos.id]]));
    });
});

describe('syncCatalogNames', () => {
    it('renames loaded catalog overlays to the catalog name, once per difference', async () => {
        const save = vi.fn(async () => {});
        const live = { id: 20, mode: 'live', mode_id: 'mpk', name: 'MPK', group_id: null, save };
        const kept = { id: 21, mode: 'overlay', mode_id: '5', name: 'Rzeki', group_id: null, save };
        const basemap = { id: 22, mode: 'basemap', mode_id: '5', name: 'Podkład', group_id: null, save };
        state.loaded = [basemap, live, kept] as unknown as Loaded[];

        const catalog = {
            basemaps: [{ id: 5, name: 'Rzeki' }],
            live: [{ name: 'mpk', label: '[WROCLAW] MPK' }],
            ion: [],
        };

        expect(await syncCatalogNames(catalog)).toBe(1);
        expect(live.name).toBe('[WROCLAW] MPK');
        expect(basemap.name).toBe('Podkład');
        expect(save).toHaveBeenCalledTimes(1);

        // A name that came back (another device saved the old one) is not fought over
        live.name = 'MPK';
        expect(await syncCatalogNames(catalog)).toBe(0);
        expect(save).toHaveBeenCalledTimes(1);
    });
});
