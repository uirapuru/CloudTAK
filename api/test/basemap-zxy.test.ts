import test from 'node:test';
import assert from 'node:assert';
import { PassThrough, Readable } from 'node:stream';
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

const WMS4326 = 'https://wms.example.com/wms?SERVICE=WMS&VERSION=1.3.0&CRS=EPSG:4326&BBOX={bbox-epsg-4326-latlon}&WIDTH=256&HEIGHT=256';

test('ZXYBasemap.tileURL - {bbox-epsg-4326-latlon} puts latitude first', () => {
    const url = new URL(ZXYBasemap.tileURL(WMS4326, 0, 0, 0));
    const [minLat, minLon, maxLat, maxLon] = url.searchParams.get('BBOX')!.split(',').map(Number);
    assert.ok(Math.abs(minLat + 85.0511287798066) < 1e-9, String(minLat));
    assert.ok(Math.abs(maxLat - 85.0511287798066) < 1e-9, String(maxLat));
    assert.equal(minLon, -180);
    assert.equal(maxLon, 180);
});

test('ZXYBasemap.tileURL - {bbox-epsg-4326-latlon} for a z15 tile in Wrocław', () => {
    // Tile 15/17934/10954 covers Wrocław's market square
    const url = new URL(ZXYBasemap.tileURL(WMS4326, 15, 17934, 10954));
    const [minLat, minLon, maxLat, maxLon] = url.searchParams.get('BBOX')!.split(',').map(Number);
    assert.ok(minLat < 51.1079 && 51.1079 < maxLat, `${minLat}..${maxLat}`);
    assert.ok(minLon < 17.0385 && 17.0385 < maxLon, `${minLon}..${maxLon}`);
    assert.ok(maxLat - minLat < 0.01 && maxLon - minLon < 0.02);
});

test('ZXYBasemap.isValidURL - accepts a WMS template with {bbox-epsg-4326-latlon}', () => {
    assert.doesNotThrow(() => new ZXYBasemap().isValidURL(WMS4326));
});

class FakeZXY extends ZXYBasemap {
    calls = 0;

    constructor(script: Array<'throw' | 'ok'>) {
        super();
        this.basemap = { url: 'https://t.example.com/{z}/{x}/{y}.png' } as never;
        this.pipeline = ((_url: unknown, opts: { signal?: AbortSignal }, handler: (d: unknown) => Readable) => {
            const step = script[this.calls++];
            assert.ok(opts.signal instanceof AbortSignal);
            if (step === 'throw') return Promise.reject(new TypeError('fetch failed'));
            const body = new PassThrough();
            body.push(Buffer.from('tile'));
            body.push(null);
            handler({ statusCode: 200, headers: { 'content-type': 'image/png', 'x-evil': '1' }, body });
            return Promise.resolve(body);
        }) as never;
    }

    protected async checkUrl(): Promise<void> {}

    run(res: unknown) {
        return this._tile(1, 2, 3, res as never, { headers: {} });
    }
}

function fakeRes() {
    const res = {
        headersSent: false,
        status: 0,
        chunks: [] as string[],
        ended: false,
        writeHead(code: number) {
            res.status = code;
            res.headersSent = true;
        },
        write(b: Buffer) {
            res.chunks.push(String(b));
        },
        end() {
            res.ended = true;
        },
    };
    return res;
}

test('ZXYBasemap tile - retries once after a network error', async () => {
    const zxy = new FakeZXY(['throw', 'ok']);
    const res = fakeRes();
    await zxy.run(res);
    assert.equal(zxy.calls, 2);
    assert.equal(res.status, 200);
    assert.deepEqual(res.chunks, ['tile']);
});

test('ZXYBasemap tile - two network errors give 400', async () => {
    const zxy = new FakeZXY(['throw', 'throw']);
    await assert.rejects(zxy.run(fakeRes()), (err: { status: number }) => err.status === 400);
    assert.equal(zxy.calls, 2);
});

test('ZXYBasemap tile - an HTTP status is not retried', async () => {
    const zxy = new FakeZXY(['ok']);
    await zxy.run(fakeRes());
    assert.equal(zxy.calls, 1);
});
