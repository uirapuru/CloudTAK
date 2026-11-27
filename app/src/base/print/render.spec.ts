import { describe, expect, it, vi } from 'vitest';

vi.mock('maplibre-gl', () => ({ Map: vi.fn() }));

import type { StyleSpecification } from 'maplibre-gl';
import { printableStyle } from './render.ts';

const style: StyleSpecification = {
    version: 8,
    sources: {
        google: { type: 'raster', tiles: ['https://example.com/{z}/{x}/{y}'], attribution: 'Google' },
        cot: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        'taklab-print-sheet': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    terrain: { source: 'google' },
    layers: [
        { id: 'background', type: 'background', paint: { 'background-color': 'hsl(47, 26%, 88%)' } },
        { id: 'basemap', type: 'raster', source: 'google' },
        { id: 'cot-points', type: 'circle', source: 'cot' },
        { id: 'taklab-print-sheet-line', type: 'line', source: 'taklab-print-sheet' },
    ],
};

describe('printableStyle', () => {
    it('drops the sheet frame, terrain and globe', () => {
        const out = printableStyle(style);
        expect(out.layers.map((l) => l.id)).toEqual(['background', 'basemap', 'cot-points']);
        expect(out.sources['taklab-print-sheet']).toBeUndefined();
        expect(out.terrain).toBeUndefined();
        expect(out.projection).toEqual({ type: 'mercator' });
    });

    it('on white paper drops the basemap, its source and the beige background', () => {
        const out = printableStyle(style, { hideLayers: ['basemap'] });
        expect(out.layers.map((l) => l.id)).toEqual(['background', 'cot-points']);
        expect(out.sources.google).toBeUndefined();
        expect(out.sources.cot).toBeDefined();
        const background = out.layers[0] as { paint: Record<string, unknown> };
        expect(background.paint['background-color']).toBe('#ffffff');
    });

    it('does not touch the live style', () => {
        printableStyle(style, { hideLayers: ['basemap'] });
        expect(style.layers).toHaveLength(4);
        expect(style.sources.google).toBeDefined();
    });
});
