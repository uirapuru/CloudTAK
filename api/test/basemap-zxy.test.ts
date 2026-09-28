import test from 'node:test';
import assert from 'node:assert';
import ZXYBasemap from '../stateless/lib/basemap/zxy.js';

const WMS = 'https://wms.example.com/wms?SERVICE=WMS&REQUEST=GetMap&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256';

test('ZXYBasemap.tileURL - substitutes z/x/y and the TAK {$z} form', () => {
    assert.equal(
        ZXYBasemap.tileURL('https://t.example.com/{z}/{x}/{y}.png', 3, 4, 5),
        'https://t.example.com/3/4/5.png',
    );
    assert.equal(
        ZXYBasemap.tileURL('https://t.example.com/{$z}/{$x}/{$y}.png', 3, 4, 5),
        'https://t.example.com/3/4/5.png',
    );
});

test('ZXYBasemap.tileURL - {bbox-epsg-3857} covers the whole world at zoom 0', () => {
    const url = new URL(ZXYBasemap.tileURL(WMS, 0, 0, 0));
    const bbox = url.searchParams.get('BBOX')!.split(',').map(Number);

    const R = 20037508.342789244;
    assert.equal(bbox.length, 4);
    for (const [got, want] of bbox.map((v, i) => [v, [-R, -R, R, R][i]])) {
        assert.ok(Math.abs(got - want) < 1e-6, `${got} != ${want}`);
    }
});

test('ZXYBasemap.tileURL - {bbox-epsg-3857} matches a z17 tile in Warsaw', () => {
    // Reference values measured against the KIUT WMS (integracja01.gugik.gov.pl)
    const url = new URL(ZXYBasemap.tileURL(WMS, 17, 73186, 43158));
    const bbox = url.searchParams.get('BBOX')!.split(',').map(Number);
    const want = [2338973.0655263923, 6841725.527749557, 2339278.813639533, 6842031.2758626975];

    for (let i = 0; i < 4; i++) {
        assert.ok(Math.abs(bbox[i] - want[i]) < 1e-3, `${i}: ${bbox[i]} != ${want[i]}`);
    }
});

test('ZXYBasemap.isValidURL - accepts a WMS template with {bbox-epsg-3857}', () => {
    assert.doesNotThrow(() => new ZXYBasemap().isValidURL(WMS));
});

test('ZXYBasemap.isValidURL - still rejects a URL without tile variables', () => {
    assert.throws(() => new ZXYBasemap().isValidURL('https://wms.example.com/wms?SERVICE=WMS'));
});
