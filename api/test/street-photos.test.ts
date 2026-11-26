import test from 'node:test';
import assert from 'node:assert';
import { Writable } from 'node:stream';
import type { Response as ExpressResponse } from 'express';
import {
    StreetPhotosControl,
    normalizePhoto,
    normalizeSearch,
    assetUrl,
    bboxAround,
    safeId,
} from '../stateless/lib/control/street-photos.js';

// Shape of a real Panoramax item (api.panoramax.xyz, Wrocław, 26 XI 2026), trimmed.
const ITEM = {
    id: 'b2feb637-6e4d-4eec-a25f-70f3444991f9',
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [17.026837053, 51.110470586] },
    links: [
        { rel: 'collection', href: 'https://api.panoramax.xyz/api/collections/0ed40f63-1bb5-46ba-8fac-c728b96293b1' },
    ],
    properties: {
        datetime: '2017-05-17T15:33:33+00:00',
        datetimetz: '2017-05-17T15:33:33+00:00',
        license: 'CC-BY-SA-4.0',
        'view:azimuth': 40,
        'geovisio:status': 'ready',
        'geovisio:visibility': 'anyone',
        'geovisio:producer': 'motocultrice',
        'pers:interior_orientation': { camera_model: 'SM-A310F' },
    },
    assets: {
        hd: { href: 'https://panoramax.openstreetmap.fr/images/b2/fe/b6/37/6e4d.jpg' },
        sd: { href: 'https://panoramax.openstreetmap.fr/derivates/b2/fe/b6/37/6e4d/sd.jpg' },
        thumb: { href: 'https://panoramax.openstreetmap.fr/derivates/b2/fe/b6/37/6e4d/thumb.jpg' },
    },
};

test('normalizePhoto: flat photo with azimuth, collection from links', () => {
    const p = normalizePhoto(ITEM);
    assert.deepStrictEqual(p, {
        id: ITEM.id,
        collection: '0ed40f63-1bb5-46ba-8fac-c728b96293b1',
        lon: 17.026837053,
        lat: 51.110470586,
        azimuth: 40,
        panorama: false,
        fov: null,
        taken_at: '2017-05-17T15:33:33+00:00',
        author: 'motocultrice',
        license: 'CC-BY-SA-4.0',
        provider: 'panoramax',
    });
});

test('normalizePhoto: 360 panorama, azimuth wrapped', () => {
    const p = normalizePhoto({
        ...ITEM,
        properties: { ...ITEM.properties, 'view:azimuth': -10, 'pers:interior_orientation': { field_of_view: 360 } },
    });
    assert.strictEqual(p?.panorama, true);
    assert.strictEqual(p?.fov, null);
    assert.strictEqual(p?.azimuth, 350);
});

test('normalizePhoto: skips hidden, not ready, without position or with unsafe ids', () => {
    assert.strictEqual(normalizePhoto({ ...ITEM, properties: { ...ITEM.properties, 'geovisio:visibility': 'owner-only' } }), null);
    assert.strictEqual(normalizePhoto({ ...ITEM, properties: { ...ITEM.properties, 'geovisio:status': 'preparing' } }), null);
    assert.strictEqual(normalizePhoto({ ...ITEM, geometry: null }), null);
    assert.strictEqual(normalizePhoto({ ...ITEM, id: '../x' }), null);
    assert.strictEqual(normalizePhoto({ ...ITEM, links: [] }), null);
    assert.strictEqual(normalizePhoto('x'), null);
});

test('normalizeSearch: drops duplicates and garbage', () => {
    const photos = normalizeSearch({ features: [ITEM, ITEM, { nope: 1 }] });
    assert.strictEqual(photos.length, 1);
    assert.deepStrictEqual(normalizeSearch({}), []);
});

test('assetUrl: only https of the asked size', () => {
    assert.strictEqual(assetUrl(ITEM, 'sd'), ITEM.assets.sd.href);
    assert.strictEqual(assetUrl({ assets: { sd: { href: 'http://x/y.jpg' } } }, 'sd'), null);
    assert.strictEqual(assetUrl({ assets: { sd: { href: 'file:///etc/passwd' } } }, 'sd'), null);
    assert.strictEqual(assetUrl({ assets: {} }, 'sd'), null);
});

test('bboxAround: about radius metres each way', () => {
    const [w, s, e, n] = bboxAround(17, 51, 100);
    assert.ok(Math.abs((n - s) * 111_320 - 200) < 1);
    assert.ok(Math.abs((e - w) * 111_320 * Math.cos(51 * Math.PI / 180) - 200) < 1);
});

test('safeId', () => {
    assert.ok(safeId('0ed40f63-1bb5-46ba-8fac-c728b96293b1'));
    assert.ok(!safeId('a/b'));
    assert.ok(!safeId(''));
});

test('search: switched off', async () => {
    const control = new StreetPhotosControl(() => 'off', async () => { throw new Error('no call'); });
    assert.deepStrictEqual(await control.search(17, 51), { enabled: false, provider: null, attribution: null, truncated: false, photos: [] });
});

test('search: asks bbox, caches, clamps radius', async () => {
    const urls: string[] = [];
    const control = new StreetPhotosControl(() => 'https://px.example/', async (url) => {
        urls.push(url);
        return new Response(JSON.stringify({ features: [ITEM] }), { status: 200 });
    });
    const a = await control.search(17.0268, 51.1104, 5000);
    const b = await control.search(17.0268, 51.1104, 5000);
    assert.strictEqual(a.photos.length, 1);
    assert.deepStrictEqual(a, b);
    assert.strictEqual(urls.length, 1);
    assert.match(urls[0], /^https:\/\/px\.example\/api\/search\?bbox=[-0-9.,]+&limit=1500$/);
    assert.strictEqual(a.truncated, false);
    const [w, , e] = new URL(urls[0]).searchParams.get('bbox')!.split(',').map(Number);
    // radius clamped to 300 m
    assert.ok((e - w) * 111_320 * Math.cos(51.1104 * Math.PI / 180) < 601);
});

test('search: wide query cut at the limit adds the nearest photos', async () => {
    const urls: string[] = [];
    const far = (i: number) => ({ ...ITEM, id: `far-${i}` });
    const control = new StreetPhotosControl(() => 'https://px.example', async (url) => {
        urls.push(url);
        const limit = Number(new URL(url).searchParams.get('limit'));
        if (limit === 1500) return new Response(JSON.stringify({ features: Array.from({ length: 1500 }, (_, i) => far(i)) }), { status: 200 });
        return new Response(JSON.stringify({ features: [ITEM, far(3)] }), { status: 200 });
    });
    const out = await control.search(17.0268, 51.1104, 300);
    assert.strictEqual(out.truncated, true);
    assert.strictEqual(urls.length, 2);
    assert.match(urls[1], /limit=300$/);
    assert.strictEqual(out.photos.length, 1501);
    assert.ok(out.photos.some((p) => p.id === ITEM.id));
});

test('search: outside service down = 503', async () => {
    const control = new StreetPhotosControl(() => 'https://px.example', async () => new Response('x', { status: 500 }));
    await assert.rejects(control.search(17, 51), (err: { status: number }) => err.status === 503);
});

class Sink extends Writable {
    chunks: Buffer[] = [];
    headers: Record<string, string> = {};
    statusCode = 0;
    status(code: number) { this.statusCode = code; return this; }
    setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }
    _write(chunk: Buffer, _enc: string, cb: () => void) { this.chunks.push(chunk); cb(); }
}

test('image: looks the item up by id and streams only its asset', async () => {
    const urls: string[] = [];
    const control = new StreetPhotosControl(() => 'https://px.example', async (url) => {
        urls.push(url);
        if (url.endsWith(`/items/${ITEM.id}`)) return new Response(JSON.stringify(ITEM), { status: 200 });
        return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    });
    const sink = new Sink();
    await control.image('0ed40f63-1bb5-46ba-8fac-c728b96293b1', ITEM.id, 'sd', sink as unknown as ExpressResponse);
    assert.deepStrictEqual(urls, [
        `https://px.example/api/collections/0ed40f63-1bb5-46ba-8fac-c728b96293b1/items/${ITEM.id}`,
        ITEM.assets.sd.href,
    ]);
    assert.strictEqual(sink.statusCode, 200);
    assert.strictEqual(sink.headers['content-type'], 'image/jpeg');
    assert.deepStrictEqual(Buffer.concat(sink.chunks), Buffer.from([0xff, 0xd8, 0xff]));
});

test('image: S3 storage says octet-stream, the bytes decide (JPEG)', async () => {
    // Measured 26 XI 2026: panoramax-storage-public-fast.s3.gra.perf.cloud.ovh.net answers binary/octet-stream.
    const control = new StreetPhotosControl(() => 'https://px.example', async (url) => {
        if (url.includes('/items/')) return new Response(JSON.stringify(ITEM), { status: 200 });
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]), { status: 200, headers: { 'content-type': 'binary/octet-stream' } });
    });
    const sink = new Sink();
    await control.image('c', ITEM.id, 'sd', sink as unknown as ExpressResponse);
    assert.strictEqual(sink.headers['content-type'], 'image/jpeg');
    assert.deepStrictEqual(Buffer.concat(sink.chunks), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]));
});

test('image: refuses non-image answers and bad ids', async () => {
    const control = new StreetPhotosControl(() => 'https://px.example', async (url) => {
        if (url.includes('/items/')) return new Response(JSON.stringify(ITEM), { status: 200 });
        return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
    });
    await assert.rejects(control.image('c', ITEM.id, 'sd', new Sink() as unknown as ExpressResponse), (err: { status: number }) => err.status === 503);
    await assert.rejects(control.image('../c', ITEM.id, 'sd', new Sink() as unknown as ExpressResponse), (err: { status: number }) => err.status === 400);
});
