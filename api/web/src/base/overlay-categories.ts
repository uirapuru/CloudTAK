/**
 * Pure helpers for overlay categories and favorites - kept free of the map
 * store and the database so they can be unit tested in isolation.
 *
 * Where a category comes from:
 * - tile overlays (basemaps with `overlay: true`): the basemap `collection`,
 * - live layers: the `category` field of the /api/live index,
 * - 3D buildings (Cesium ion): always "Budynki 3D",
 * - user files and everything else: "Inne".
 */
import { matchesFilter } from './overlay-explorer-bulk.ts';

/** Pinned pseudo category - favorites are listed there as well as in their own category */
export const FAVORITES = 'Ulubione';
export const OTHER = 'Inne';
export const BUILDINGS_3D = 'Budynki 3D';

/** Categories in the order they are listed; unknown categories go after them, alphabetically */
export const OVERLAY_CATEGORIES = [
    'Teren',
    'Woda',
    'Pogoda i powietrze',
    'Lotnictwo',
    'Łączność',
    'Infrastruktura',
    'Transport',
    'Ratownictwo i bezpieczeństwo',
    'Turystyka',
    'Zdjęcia lotnicze',
    BUILDINGS_3D,
    OTHER
];

export type CatalogBasemap = { id: number; name: string; collection?: string | null };
export type CatalogLive = { name: string; label: string; category?: string | null };
export type CatalogIon = { name: string; label: string };

export type OverlayCatalog = {
    basemaps: CatalogBasemap[];
    live: CatalogLive[];
    ion: CatalogIon[];
};

/** One item of the Overlay Explorer, whatever its source */
export type ExplorerEntry = {
    mode: 'overlay' | 'live' | 'ion';
    modeId: string;
    /** Matched by the search together with the label */
    name: string;
    label: string;
    category: string;
};

export type ExplorerSection = {
    category: string;
    entries: ExplorerEntry[];
};

/** Trimmed category, "Inne" when it is missing or blank */
export function normalizeCategory(raw: string | null | undefined): string {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    return trimmed.length ? trimmed : OTHER;
}

/** Sort comparator: the fixed categories in their order, then unknown ones alphabetically */
export function compareCategories(a: string, b: string): number {
    const ia = OVERLAY_CATEGORIES.indexOf(a);
    const ib = OVERLAY_CATEGORIES.indexOf(b);

    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b, 'pl');
}

/** Whether a group name is the name of a category (fixed, or one of `extra` seen in the catalog) */
export function isCategoryName(name: string, extra: string[] = []): boolean {
    return OVERLAY_CATEGORIES.includes(name) || extra.includes(name);
}

/** Key of a favorite overlay, `${mode}:${mode_id}`, or null when the overlay has no mode_id */
export function favoriteKey(mode: string, modeId: string | null | undefined): string | null {
    if (modeId === null || modeId === undefined || modeId === '') return null;
    return `${mode}:${modeId}`;
}

/**
 * Category of an overlay from its mode and mode_id. Null when the overlay
 * comes from the catalog but the catalog does not list it (the live service
 * is down, the basemap was removed) - "Inne" would be a wrong guess there.
 */
export function catalogCategory(catalog: OverlayCatalog, mode: string, modeId: string | null | undefined): string | null {
    if (mode === 'ion') return BUILDINGS_3D;

    if (mode === 'overlay') {
        const basemap = catalog.basemaps.find((b) => String(b.id) === modeId);
        return basemap ? normalizeCategory(basemap.collection) : null;
    }

    if (mode === 'live') {
        const live = catalog.live.find((l) => l.name === modeId);
        return live ? normalizeCategory(live.category) : null;
    }

    return OTHER;
}

/** Name the catalog gives an overlay, undefined when it is not a catalog overlay or not listed */
export function catalogLabel(catalog: OverlayCatalog, mode: string, modeId: string | null | undefined): string | undefined {
    if (mode === 'overlay') return catalog.basemaps.find((b) => String(b.id) === modeId)?.name;
    if (mode === 'live') return catalog.live.find((l) => l.name === modeId)?.label;
    if (mode === 'ion') return catalog.ion.find((i) => i.name === modeId)?.label;
    return undefined;
}

/** Catalog overlays whose saved name differs from the name in the catalog, with the new name */
export function staleNames(
    overlays: Array<{ id: number; mode: string; mode_id?: string | null; name: string }>,
    catalog: OverlayCatalog
): Array<{ id: number; name: string }> {
    const out: Array<{ id: number; name: string }> = [];

    for (const overlay of overlays) {
        const label = catalogLabel(catalog, overlay.mode, overlay.mode_id);
        if (label !== undefined && label.length && label !== overlay.name) out.push({ id: overlay.id, name: label });
    }

    return out;
}

/**
 * Order of the groups (ids, top first) once `added` is placed among them: a
 * category group goes before the first category group listed after it in
 * the category order, else after the last category group, else on top.
 * `groups` may already contain `added` - it is placed again either way.
 */
export function categoryGroupOrder(
    groups: Array<{ id: number; pos: number; name: string }>,
    added: { id: number; name: string },
    extra: string[] = []
): number[] {
    const others = [...groups]
        .filter((group) => group.id !== added.id)
        .sort((a, b) => a.pos - b.pos || a.id - b.id);

    const ids = others.map((group) => group.id);
    const categories = others
        .map((group, index) => ({ group, index }))
        .filter(({ group }) => isCategoryName(group.name, extra));

    let at = 0;
    const after = categories.find(({ group }) => compareCategories(group.name, added.name) > 0);
    if (after) {
        at = after.index;
    } else if (categories.length) {
        at = categories[categories.length - 1].index + 1;
    }

    ids.splice(at, 0, added.id);
    return ids;
}

/**
 * Sections of the Overlay Explorer: "Ulubione" first (a shortcut, the
 * favorite stays in its own category too), then the categories in order.
 * Entries are sorted by label. With a search filter only matching entries
 * are kept and empty sections are dropped; without one the favorites
 * section is kept even when empty.
 */
export function explorerSections(entries: ExplorerEntry[], favorites: Set<string>, filter: string): ExplorerSection[] {
    const byLabel = (a: ExplorerEntry, b: ExplorerEntry) => a.label.localeCompare(b.label, 'pl');
    const shown = entries.filter((entry) => matchesFilter(entry, filter));

    const byCategory = new Map<string, ExplorerEntry[]>();
    for (const entry of shown) {
        const list = byCategory.get(entry.category) ?? [];
        list.push(entry);
        byCategory.set(entry.category, list);
    }

    const sections: ExplorerSection[] = [];

    const starred = shown.filter((entry) => favorites.has(`${entry.mode}:${entry.modeId}`)).sort(byLabel);
    if (starred.length || !filter.trim()) sections.push({ category: FAVORITES, entries: starred });

    for (const category of [...byCategory.keys()].sort(compareCategories)) {
        sections.push({ category, entries: (byCategory.get(category) ?? []).sort(byLabel) });
    }

    return sections;
}
