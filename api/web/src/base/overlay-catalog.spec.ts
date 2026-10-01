import { describe, expect, it, vi } from 'vitest';

vi.mock('../std.ts', () => ({ server: {}, std: vi.fn() }));

import { fetchAllBasemaps, type BasemapPageQuery } from './overlay-catalog.ts';

type Item = { id: number; name: string; collection: string | null };

function server(items: Item[]) {
    const calls: BasemapPageQuery[] = [];
    const getPage = vi.fn(async (query: BasemapPageQuery) => {
        calls.push(query);
        // Like the API: without a collection only basemaps outside any collection
        const matching = items.filter((item) => (query.collection ?? null) === item.collection);
        const collections = query.collection
            ? []
            : [...new Set(items.map((item) => item.collection).filter((c): c is string => c !== null))].map((name) => ({ name }));
        return {
            total: matching.length,
            collections,
            items: matching.slice(query.page * query.limit, (query.page + 1) * query.limit)
        };
    });
    return { getPage, calls };
}

describe('fetchAllBasemaps', () => {
    it('pages through the top level and every collection', async () => {
        const items: Item[] = [];
        for (let i = 1; i <= 5; i++) items.push({ id: i, name: `Top ${i}`, collection: null });
        for (let i = 6; i <= 8; i++) items.push({ id: i, name: `Woda ${i}`, collection: 'Woda' });
        items.push({ id: 9, name: 'Teren', collection: 'Teren' });

        const { getPage, calls } = server(items);
        const all = await fetchAllBasemaps(getPage, 2);

        expect(all.map((b) => b.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(calls.filter((c) => !c.collection).map((c) => c.page)).toEqual([0, 1, 2]);
        expect(calls.filter((c) => c.collection === 'Woda').map((c) => c.page)).toEqual([0, 1]);
    });

    it('stops on an empty page even if the total says otherwise', async () => {
        const getPage = vi.fn(async () => ({ total: 50, collections: [], items: [] }));
        expect(await fetchAllBasemaps(getPage, 10)).toEqual([]);
        expect(getPage).toHaveBeenCalledTimes(1);
    });

    it('lists a basemap once even if it shows up twice', async () => {
        const getPage = vi.fn(async (query: BasemapPageQuery) => ({
            total: 1,
            collections: query.collection ? [] : [{ name: 'Woda' }],
            items: [{ id: 1, name: 'Rzeki', collection: query.collection ?? null }]
        }));
        expect((await fetchAllBasemaps(getPage, 10)).map((b) => b.id)).toEqual([1]);
    });
});
