import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { tileRange, countTiles, safeFileName } from '../src/area-package/tiles.ts';
import { HostLimiter, limiterFor } from '../src/area-package/limiter.ts';
import { fetchLayerTiles, tileUrl } from '../src/area-package/fetch-tiles.ts';
import type { AreaPackageLayer, BBox } from '../src/area-package/types.ts';

const SECRET = 'test-secret';

// Same values as api/test/area-package-tiles.test.ts: the two copies must agree
test('tileRange / countTiles - same values as the API copy', () => {
    assert.deepEqual(tileRange([20.9, 52.1, 21.1, 52.3], 10), { minX: 571, maxX: 572, minY: 336, maxY: 337 });
    assert.equal(countTiles([20.9, 52.1, 21.1, 52.3], 10, 10), 4);
    assert.equal(tileRange([-10, -89, 10, 89], 2).maxY, 3);
    assert.equal(tileRange([170, 0, 180, 10], 3).maxX, 7);
});

test('safeFileName - same rules as the API copy', () => {
    const name = safeFileName('../Wyjście "A"/23');
    assert.ok(!name.includes('/') && !name.includes('..') && !name.includes('"'));
    assert.ok(name.includes('Wyjście'));
    assert.equal(safeFileName('///'), 'paczka');
    assert.equal(safeFileName('a'.repeat(300)).length, 100);
});

type Handler = (z: number, x: number, y: number, attempt: number) => { status: number; body?: Buffer };

async function tileServer(handler: Handler): Promise<{ base: string; close: () => Promise<void>; urls: string[] }> {
    const attempts = new Map<string, number>();
    const urls: string[] = [];

    const server = http.createServer((req, res) => {
        urls.push(req.url || '');
        const match = /\/(\d+)\/(\d+)\/(\d+)(\.\w+)?(\?|$)/.exec(req.url || '');
        if (!match) {
            res.statusCode = 400;
            res.end();
            return;
        }

        const [z, x, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
        const key = `${z}/${x}/${y}`;
        const attempt = (attempts.get(key) || 0) + 1;
        attempts.set(key, attempt);

        const out = handler(z, x, y, attempt);
        res.statusCode = out.status;
        res.end(out.body);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    return {
        base: `http://127.0.0.1:${port}`,
        urls,
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}

const BOUNDS: BBox = [20.9, 52.1, 21.1, 52.3];

function layer(extra: Partial<AreaPackageLayer> = {}): AreaPackageLayer {
    return {
        source: 'basemap',
        id: 7,
        name: 'OSM',
        format: 'png',
        host: 'test.svc',
        minzoom: 10,
        maxzoom: 10,
        ...extra,
    } as AreaPackageLayer;
}

async function collect(gen: AsyncGenerator<{ z: number; x: number; y: number; data: Buffer }>) {
    const out = [];
    for await (const t of gen) out.push(t);
    return out;
}

test('tileUrl - basemap and profile file routes with a signed token', () => {
    const basemap = new URL(tileUrl('http://tiles:5002', layer(), 'user@example.com', SECRET, 10, 571, 336));
    assert.equal(basemap.pathname, '/tiles/basemap/7/tiles/10/571/336');
    assert.deepEqual(jwt.verify(basemap.searchParams.get('token') || '', SECRET), {
        ...(jwt.decode(basemap.searchParams.get('token') || '') as object),
        access: 'user',
        email: 'user@example.com',
    });

    const profile = new URL(tileUrl('http://tiles:5002', layer({
        source: 'profile',
        file: 'abc',
        host: 'profile',
        format: 'jpeg',
    } as Partial<AreaPackageLayer>), 'user@example.com', SECRET, 3, 1, 2));
    assert.equal(profile.pathname, '/tiles/profile/user%40example.com/abc/tiles/3/1/2.jpeg');
    const claims = jwt.verify(profile.searchParams.get('token') || '', SECRET) as Record<string, string>;
    assert.equal(claims.access, 'profile');
    assert.equal(claims.email, 'user@example.com');
});

test('fetchLayerTiles - yields every tile of the area', async () => {
    const srv = await tileServer(() => ({ status: 200, body: Buffer.from('png') }));
    try {
        const tiles = await collect(fetchLayerTiles({
            tilesBase: srv.base, secret: SECRET, username: 'user@example.com',
            layer: layer(), bounds: BOUNDS, signal: new AbortController().signal,
        }));

        assert.deepEqual(tiles.map((t) => `${t.z}/${t.x}/${t.y}`).sort(), ['10/571/336', '10/571/337', '10/572/336', '10/572/337']);
        assert.equal(tiles[0].data.toString(), 'png');
    } finally {
        await srv.close();
    }
});

test('fetchLayerTiles - skips missing and empty tiles', async () => {
    const srv = await tileServer((z, x, y) => {
        if (x === 571 && y === 336) return { status: 404 };
        if (x === 572 && y === 337) return { status: 200, body: Buffer.alloc(0) };
        return { status: 200, body: Buffer.from('png') };
    });
    try {
        const tiles = await collect(fetchLayerTiles({
            tilesBase: srv.base, secret: SECRET, username: 'user@example.com',
            layer: layer(), bounds: BOUNDS, signal: new AbortController().signal,
        }));
        assert.equal(tiles.length, 2);
    } finally {
        await srv.close();
    }
});

test('fetchLayerTiles - backs off on 429 and retries', async () => {
    const srv = await tileServer((z, x, y, attempt) => {
        if (x === 571 && y === 336 && attempt === 1) return { status: 429 };
        return { status: 200, body: Buffer.from('png') };
    });
    try {
        const start = Date.now();
        const tiles = await collect(fetchLayerTiles({
            tilesBase: srv.base, secret: SECRET, username: 'user@example.com',
            layer: layer({ host: 'backoff-test.svc' }), bounds: BOUNDS, signal: new AbortController().signal,
        }));
        assert.equal(tiles.length, 4);
        assert.ok(Date.now() - start >= 1000, 'waited at least a second');
    } finally {
        await srv.close();
    }
});

test('fetchLayerTiles - gives up after three server errors with the layer name', async () => {
    const srv = await tileServer((z, x, y) => {
        if (x === 571 && y === 336) return { status: 500 };
        return { status: 200, body: Buffer.from('png') };
    });
    try {
        await assert.rejects(collect(fetchLayerTiles({
            tilesBase: srv.base, secret: SECRET, username: 'user@example.com',
            layer: layer({ host: 'errors-test.svc' }), bounds: BOUNDS, signal: new AbortController().signal,
        })), /OSM: 500/);

        assert.equal(srv.urls.filter((u) => u.includes('/571/336')).length, 3);
    } finally {
        await srv.close();
    }
});

test('fetchLayerTiles - no access to the layer fails instead of producing an empty package', async () => {
    const srv = await tileServer(() => ({ status: 403 }));
    try {
        await assert.rejects(collect(fetchLayerTiles({
            tilesBase: srv.base, secret: SECRET, username: 'user@example.com',
            layer: layer({ host: 'forbidden-test.svc' }), bounds: BOUNDS, signal: new AbortController().signal,
        })), /OSM: brak dostępu albo brak danych/);
    } finally {
        await srv.close();
    }
});

test('fetchLayerTiles - stops when aborted', async () => {
    const srv = await tileServer(() => ({ status: 200, body: Buffer.from('png') }));
    try {
        const controller = new AbortController();
        const out = [];
        for await (const t of fetchLayerTiles({
            tilesBase: srv.base, secret: SECRET, username: 'user@example.com',
            layer: layer({ maxzoom: 12, host: 'abort-test.svc' }), bounds: BOUNDS, signal: controller.signal,
        })) {
            out.push(t);
            controller.abort();
        }
        assert.ok(out.length < countTiles(BOUNDS, 10, 12));
    } finally {
        await srv.close();
    }
});

test('HostLimiter - never more than the concurrency, never faster than the rate', async () => {
    const limiter = new HostLimiter({ concurrency: 2, perSecond: 10 });
    let running = 0;
    let peak = 0;

    const start = Date.now();
    await Promise.all(Array.from({ length: 30 }, () => limiter.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
    })));

    assert.ok(peak <= 2, `peak ${peak}`);
    assert.ok(Date.now() - start >= 2500, `took ${Date.now() - start} ms`);
});

test('limiterFor - internal hosts and profile files get the fast lane', () => {
    assert.equal(limiterFor('taklab-tiles.taklab-system.svc').concurrency, 16);
    assert.equal(limiterFor('x.tak-public.svc.cluster.local').concurrency, 16);
    assert.equal(limiterFor('profile').concurrency, 16);
    assert.equal(limiterFor('tile.openstreetmap.de').concurrency, 2);
    assert.equal(limiterFor('tile.openstreetmap.de').perSecond, 10);
    assert.equal(limiterFor('tile.openstreetmap.de'), limiterFor('tile.openstreetmap.de'));
});
