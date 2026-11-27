import { describe, expect, it } from 'vitest';
import type { LayerSpecification } from 'maplibre-gl';
import { auxBasemapId, auxSourceId, auxTileJSONKey } from './basemap-aux.ts';

describe('auxBasemapId', () => {
    it('reads the borrowed basemap id of a raster layer', () => {
        const layer = { id: 'hs', type: 'raster', source: '7', metadata: { 'taklab:basemap': '12' } } as LayerSpecification;
        expect(auxBasemapId(layer)).toBe(12);
    });

    it('ignores layers without a valid id or of a vector type', () => {
        expect(auxBasemapId({ id: 'a', type: 'raster', source: '7' } as LayerSpecification)).toBeUndefined();
        expect(auxBasemapId({ id: 'b', type: 'raster', source: '7', metadata: { 'taklab:basemap': '@Cieniowanie' } } as LayerSpecification)).toBeUndefined();
        expect(auxBasemapId({ id: 'c', type: 'raster', source: '7', metadata: { 'taklab:basemap': 0 } } as LayerSpecification)).toBeUndefined();
        expect(auxBasemapId({ id: 'd', type: 'line', source: '7', metadata: { 'taklab:basemap': 12 } } as LayerSpecification)).toBeUndefined();
    });
});

describe('aux source keys', () => {
    it('are distinct per overlay and basemap and stay clear of the CoT layer', () => {
        expect(auxSourceId(5, 12)).toBe('5-basemap-12');
        expect(auxTileJSONKey(5, 12)).not.toBe(auxTileJSONKey(6, 12));
        expect(auxTileJSONKey(5, 12)).not.toBe(auxTileJSONKey(5, 13));
        expect(auxTileJSONKey(1, 1)).toBeLessThan(-1_000_000);
    });
});
