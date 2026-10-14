import type { Basemap } from '../types.ts';
import { server, std } from '../std.ts';
import type { CatalogLive, CatalogIon } from './overlay-categories.ts';

/**
 * Everything the Overlay Explorer offers: tile overlays (basemaps with
 * `overlay: true`), live layers and 3D buildings. The Overlays menu uses it
 * to know the category and the current name of the overlays in the profile.
 */

export type LiveItem = CatalogLive & {
    refresh: number;
    attribution: string;
    updated: string | null;
    stale: boolean;
};

export type IonItem = CatalogIon;

export type ExplorerCatalog = {
    basemaps: Basemap[];
    live: LiveItem[];
    ion: IonItem[];
};

export type BasemapPageQuery = { collection?: string; page: number; limit: number };

type BasemapPage<T> = {
    total: number;
    collections: Array<{ name: string }>;
    items: T[];
};

/** Largest page the basemap list accepts */
const PAGE_LIMIT = 100;

/**
 * Every basemap of a list that is paged and split into collections: the API
 * lists a collection's basemaps only when asked for that collection, so the
 * top level and then each collection is paged through. A basemap is listed
 * once even if it shows up twice.
 */
export async function fetchAllBasemaps<T extends { id: number }>(
    getPage: (query: BasemapPageQuery) => Promise<BasemapPage<T>>,
    limit = PAGE_LIMIT
): Promise<T[]> {
    const byId = new Map<number, T>();
    let collections: string[] = [];

    const pageThrough = async (collection?: string): Promise<void> => {
        for (let page = 0; ; page++) {
            const res = await getPage({ collection, page, limit });
            if (page === 0 && !collection) collections = res.collections.map((c) => c.name).filter((name) => !!name);

            for (const item of res.items) {
                if (!byId.has(item.id)) byId.set(item.id, item);
            }

            if (!res.items.length || (page + 1) * limit >= res.total) return;
        }
    };

    await pageThrough();
    for (const collection of collections) await pageThrough(collection);

    return [...byId.values()];
}

async function fetchOverlayBasemaps(): Promise<Basemap[]> {
    return await fetchAllBasemaps<Basemap>(async (query) => {
        const { data, error } = await server.GET('/api/basemap', {
            params: {
                query: {
                    filter: '',
                    collection: query.collection,
                    overlay: true,
                    limit: query.limit,
                    page: query.page,
                    order: 'asc',
                    sort: 'name',
                    hidden: 'false'
                }
            }
        });

        if (error) throw new Error(error.message);
        if (!data) throw new Error('No data returned');
        return data;
    });
}

async function fetchIon(): Promise<IonItem[]> {
    try {
        const res = await std('/api/ion') as { items: IonItem[] };
        return res.items;
    } catch (err) {
        // 3D buildings are optional; the rest must still work
        console.error('Failed to list Cesium ion assets', err);
        return [];
    }
}

async function fetchLive(): Promise<LiveItem[]> {
    try {
        const res = await std('/api/live') as { items: LiveItem[] };
        return res.items;
    } catch (err) {
        // Live layers are optional; the rest must still work
        console.error('Failed to list live layers', err);
        return [];
    }
}

/** How long a fetched catalog is reused by the Overlays menu and the Explorer */
const CACHE_MS = 60_000;

let cached: { at: number; catalog: Promise<ExplorerCatalog> } | undefined;

/**
 * The catalog, reused for a minute unless `fresh` is set. Basemaps must
 * load; live layers and 3D buildings fall back to an empty list.
 */
export async function loadCatalog(opts: { fresh?: boolean } = {}): Promise<ExplorerCatalog> {
    if (!opts.fresh && cached && Date.now() - cached.at < CACHE_MS) return await cached.catalog;

    const catalog = (async () => {
        const [basemaps, live, ion] = await Promise.all([fetchOverlayBasemaps(), fetchLive(), fetchIon()]);
        return { basemaps, live, ion };
    })();

    const entry = { at: Date.now(), catalog };
    cached = entry;

    try {
        return await catalog;
    } catch (err) {
        // A failed fetch must not be reused
        if (cached === entry) cached = undefined;
        throw err;
    }
}
