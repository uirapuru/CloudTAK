import test from 'node:test';
import assert from 'node:assert';
import ZXYBasemap from '../stateless/lib/basemap/zxy.js';

const WMS = 'https://wms.example.com/wms?SERVICE=WMS&REQUEST=GetMap&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256';
const WMS4326 = 'https://wms.example.com/wms?SERVICE=WMS&VERSION=1.3.0&CRS=EPSG:4326&BBOX={bbox-epsg-4326-latlon}&WIDTH=256&HEIGHT=256';

test('ZXYBasemap.isValidURL - accepts a WMS template with {bbox-epsg-3857}', () => {
    assert.doesNotThrow(() => new ZXYBasemap().isValidURL(WMS));
});

test('ZXYBasemap.isValidURL - still rejects a URL without tile variables', () => {
    assert.throws(() => new ZXYBasemap().isValidURL('https://wms.example.com/wms?SERVICE=WMS'));
});

test('ZXYBasemap.isValidURL - accepts a WMS template with {bbox-epsg-4326-latlon}', () => {
    assert.doesNotThrow(() => new ZXYBasemap().isValidURL(WMS4326));
});
