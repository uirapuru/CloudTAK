import test from 'node:test';
import assert from 'node:assert';
import { BasemapProtocol } from '../stateless/lib/interface-basemap.js';

// TakLab Topo: a vector basemap whose hillshade layer borrows raster tiles
// from another basemap (metadata "taklab:basemap", see app/src/base/basemap-aux.ts).
const TOPO = [
    { id: 'background', type: 'background', paint: { 'background-color': '#f2efe9' } },
    { id: 'hillshade', type: 'raster', source: 'topo', metadata: { 'taklab:basemap': '22' }, paint: { 'raster-opacity': 0.5 } },
    { id: 'water', type: 'fill', source: 'topo', 'source-layer': 'water', paint: { 'fill-color': '#a0c8f0' } },
];

test('isValidStyle - accepts a raster layer borrowed from another basemap in a vector style', () => {
    assert.doesNotThrow(() => BasemapProtocol.isValidStyle('vector', TOPO));
});

test('isValidStyle - does not change the layers it validates', () => {
    const layers = structuredClone(TOPO);
    BasemapProtocol.isValidStyle('vector', layers);
    assert.deepStrictEqual(layers, TOPO);
});

test('isValidStyle - still rejects a raster layer on the vector source without a borrowed basemap', () => {
    const layers = [{ id: 'hs', type: 'raster', source: 'topo' }];
    assert.throws(() => BasemapProtocol.isValidStyle('vector', layers), /requires a raster source/);
});

test('isValidStyle - ignores a borrowed basemap that is not a positive integer id', () => {
    const layers = [{ id: 'hs', type: 'raster', source: 'topo', metadata: { 'taklab:basemap': '@Cieniowanie' } }];
    assert.throws(() => BasemapProtocol.isValidStyle('vector', layers), /requires a raster source/);
});

test('isValidStyle - a borrowed hillshade layer validates against a raster-dem source', () => {
    const layers = [{ id: 'hs', type: 'hillshade', source: 'topo', metadata: { 'taklab:basemap': 7 } }];
    assert.doesNotThrow(() => BasemapProtocol.isValidStyle('vector', layers));
});
