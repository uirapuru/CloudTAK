import { describe, expect, it } from 'vitest';
import {
    BUILDINGS_3D,
    FAVORITES,
    OTHER,
    OVERLAY_CATEGORIES,
    catalogCategory,
    catalogLabel,
    categoryGroupOrder,
    compareCategories,
    explorerSections,
    favoriteKey,
    isCategoryName,
    normalizeCategory,
    staleNames,
    type ExplorerEntry,
    type OverlayCatalog
} from './overlay-categories.ts';

const catalog: OverlayCatalog = {
    basemaps: [
        { id: 1, name: 'Ortofoto Wrocław 2025', collection: 'Zdjęcia lotnicze' },
        { id: 2, name: 'Rzeki', collection: 'Woda' },
        { id: 3, name: 'Bez kolekcji', collection: null },
        { id: 4, name: 'Dziwna', collection: 'Kosmos' }
    ],
    live: [
        { name: 'adsb', label: 'Samoloty', category: 'Lotnictwo' },
        { name: 'mpk-wroclaw', label: '[WROCLAW] MPK' },
        { name: 'bts', label: 'BTS', category: '  ' }
    ],
    ion: [
        { name: 'google-3d', label: 'Google 3D' }
    ]
};

describe('overlay categories', () => {
    it('lists the fixed categories in the agreed order, favorites first', () => {
        expect(FAVORITES).toBe('Ulubione');
        expect(OVERLAY_CATEGORIES).toEqual([
            'Teren', 'Woda', 'Pogoda i powietrze', 'Lotnictwo', 'Łączność', 'Infrastruktura', 'Transport',
            'Ratownictwo i bezpieczeństwo', 'Turystyka', 'Zdjęcia lotnicze', 'Budynki 3D', 'Inne'
        ]);
        expect(BUILDINGS_3D).toBe('Budynki 3D');
        expect(OTHER).toBe('Inne');
    });

    it('treats a missing or blank category as "Inne" and trims the rest', () => {
        expect(normalizeCategory(undefined)).toBe('Inne');
        expect(normalizeCategory(null)).toBe('Inne');
        expect(normalizeCategory('   ')).toBe('Inne');
        expect(normalizeCategory(' Woda ')).toBe('Woda');
    });

    it('orders known categories by the list and unknown ones after it, alphabetically', () => {
        const names = ['Inne', 'Zebry', 'Woda', 'Akacje', 'Teren', 'Łąki'];
        expect([...names].sort(compareCategories)).toEqual(['Teren', 'Woda', 'Inne', 'Akacje', 'Łąki', 'Zebry']);
    });

    it('builds favorite keys from mode and mode_id', () => {
        expect(favoriteKey('overlay', '12')).toBe('overlay:12');
        expect(favoriteKey('live', 'adsb')).toBe('live:adsb');
        expect(favoriteKey('profile', null)).toBeNull();
        expect(favoriteKey('profile', '')).toBeNull();
    });

    it('takes the category of a profile overlay from the catalog', () => {
        expect(catalogCategory(catalog, 'overlay', '1')).toBe('Zdjęcia lotnicze');
        expect(catalogCategory(catalog, 'overlay', '3')).toBe('Inne');
        expect(catalogCategory(catalog, 'overlay', '4')).toBe('Kosmos');
        expect(catalogCategory(catalog, 'live', 'adsb')).toBe('Lotnictwo');
        expect(catalogCategory(catalog, 'live', 'mpk-wroclaw')).toBe('Inne');
        expect(catalogCategory(catalog, 'live', 'bts')).toBe('Inne');
        expect(catalogCategory(catalog, 'ion', 'google-3d')).toBe('Budynki 3D');
        expect(catalogCategory(catalog, 'ion', 'unknown')).toBe('Budynki 3D');
        expect(catalogCategory(catalog, 'profile', 'plik.kml')).toBe('Inne');
        expect(catalogCategory(catalog, 'mission', 'abc')).toBe('Inne');
    });

    it('does not guess the category of a catalog overlay the catalog does not list', () => {
        // The live service may be down or the basemap removed - "Inne" would be wrong
        expect(catalogCategory(catalog, 'overlay', '99')).toBeNull();
        expect(catalogCategory(catalog, 'live', 'gone')).toBeNull();
        expect(catalogCategory(catalog, 'overlay', null)).toBeNull();
    });

    it('takes the name of a catalog overlay from the catalog', () => {
        expect(catalogLabel(catalog, 'overlay', '2')).toBe('Rzeki');
        expect(catalogLabel(catalog, 'live', 'mpk-wroclaw')).toBe('[WROCLAW] MPK');
        expect(catalogLabel(catalog, 'ion', 'google-3d')).toBe('Google 3D');
        expect(catalogLabel(catalog, 'live', 'gone')).toBeUndefined();
        expect(catalogLabel(catalog, 'profile', 'plik.kml')).toBeUndefined();
    });

    it('finds the catalog overlays whose saved name differs from the catalog', () => {
        const overlays = [
            { id: 1, mode: 'live', mode_id: 'mpk-wroclaw', name: 'MPK' },
            { id: 2, mode: 'overlay', mode_id: '2', name: 'Rzeki' },
            { id: 3, mode: 'ion', mode_id: 'google-3d', name: 'Budynki' },
            { id: 4, mode: 'live', mode_id: 'gone', name: 'Stara' },
            { id: 5, mode: 'profile', mode_id: 'plik.kml', name: 'Mój plik' },
            { id: 6, mode: 'basemap', mode_id: '1', name: 'Podkład' }
        ];

        expect(staleNames(overlays, catalog)).toEqual([
            { id: 1, name: '[WROCLAW] MPK' },
            { id: 3, name: 'Google 3D' }
        ]);
    });

    it('knows the category group names', () => {
        expect(isCategoryName('Transport')).toBe(true);
        expect(isCategoryName('Ulubione')).toBe(false);
        expect(isCategoryName('Moje drogi')).toBe(false);
        expect(isCategoryName('Kosmos', ['Kosmos'])).toBe(true);
    });
});

describe('categoryGroupOrder', () => {
    const groups = [
        { id: 1, pos: 0, name: 'Moje' },
        { id: 2, pos: 1, name: 'Woda' },
        { id: 3, pos: 2, name: 'Transport' },
        { id: 4, pos: 3, name: 'Robocze' }
    ];

    it('puts a new category group before the first category group listed after it', () => {
        expect(categoryGroupOrder(groups, { id: 9, name: 'Lotnictwo' })).toEqual([1, 2, 9, 3, 4]);
        expect(categoryGroupOrder(groups, { id: 9, name: 'Teren' })).toEqual([1, 9, 2, 3, 4]);
    });

    it('puts it after the last category group when it comes last', () => {
        expect(categoryGroupOrder(groups, { id: 9, name: 'Inne' })).toEqual([1, 2, 3, 9, 4]);
    });

    it('puts it on top when there are no category groups yet', () => {
        expect(categoryGroupOrder([{ id: 1, pos: 0, name: 'Moje' }], { id: 9, name: 'Woda' })).toEqual([9, 1]);
    });

    it('ignores the new group if it is already in the list', () => {
        expect(categoryGroupOrder([...groups, { id: 9, pos: -1, name: 'Lotnictwo' }], { id: 9, name: 'Lotnictwo' })).toEqual([1, 2, 9, 3, 4]);
    });
});

describe('explorerSections', () => {
    const entries: ExplorerEntry[] = [
        { mode: 'overlay', modeId: '2', name: '2', label: 'Rzeki', category: 'Woda' },
        { mode: 'overlay', modeId: '1', name: '1', label: 'Ortofoto', category: 'Zdjęcia lotnicze' },
        { mode: 'live', modeId: 'adsb', name: 'adsb', label: 'Samoloty', category: 'Lotnictwo' },
        { mode: 'live', modeId: 'mpk', name: 'mpk', label: 'MPK', category: 'Kosmos' },
        { mode: 'ion', modeId: 'g3d', name: 'g3d', label: 'Google 3D', category: 'Budynki 3D' },
        { mode: 'overlay', modeId: '5', name: '5', label: 'Jeziora', category: 'Woda' }
    ];

    it('groups entries into categories in the agreed order, favorites first, labels sorted', () => {
        const sections = explorerSections(entries, new Set(['live:mpk', 'overlay:2']), '');

        expect(sections.map((s) => s.category)).toEqual(['Ulubione', 'Woda', 'Lotnictwo', 'Zdjęcia lotnicze', 'Budynki 3D', 'Kosmos']);
        expect(sections[0].entries.map((e) => e.label)).toEqual(['MPK', 'Rzeki']);
        expect(sections[1].entries.map((e) => e.label)).toEqual(['Jeziora', 'Rzeki']);
    });

    it('keeps an empty favorites section without a filter, so the user learns about the star', () => {
        const sections = explorerSections(entries, new Set(), '');
        expect(sections[0]).toEqual({ category: 'Ulubione', entries: [] });
    });

    it('filters inside the sections and drops the empty ones', () => {
        const sections = explorerSections(entries, new Set(['overlay:1']), 'rze');
        expect(sections).toEqual([{ category: 'Woda', entries: [entries[0]] }]);

        const favorite = explorerSections(entries, new Set(['overlay:1']), 'orto');
        expect(favorite.map((s) => s.category)).toEqual(['Ulubione', 'Zdjęcia lotnicze']);
    });
});
