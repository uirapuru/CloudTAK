import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { runJob, type JobDeps } from '../src/area-package/job.ts';
import AreaPackagePool from '../src/area-package/pool.ts';
import type { AreaPackageJob } from '../src/area-package/types.ts';

const SECRET = 'test-secret';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

type Call = { method: string; url: string; body: Record<string, unknown> };

async function server(handler: (call: Call, res: http.ServerResponse) => void): Promise<{ base: string; calls: Call[]; close: () => Promise<void> }> {
    const calls: Call[] = [];
    const srv = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString();
            const call = { method: req.method || '', url: req.url || '', body: raw ? JSON.parse(raw) : {} };
            calls.push(call);
            handler(call, res);
        });
    });
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
    return {
        base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`,
        calls,
        close: () => new Promise((resolve) => srv.close(() => resolve())),
    };
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
}

function job(extra: Partial<AreaPackageJob> = {}): AreaPackageJob {
    return {
        id: '6c4c4b5e-3c7a-4d7c-9e55-0b8f0e6f6a11',
        created: '2026-11-24T10:00:00Z',
        updated: '2026-11-24T10:00:00Z',
        username: 'user@example.com',
        name: 'Wyjście 23 XI',
        token: 'x'.repeat(43),
        status: 'Running',
        error: null,
        progress: 0,
        bounds: { type: 'Polygon', coordinates: [[[20.9, 52.1], [21.1, 52.1], [21.1, 52.3], [20.9, 52.3], [20.9, 52.1]]] },
        layers: [{ source: 'basemap', id: 7, name: 'OSM', format: 'png', host: 'job-test.svc', minzoom: 10, maxzoom: 11 }],
        features: [{
            type: 'Feature',
            properties: {
                type: 'u-d-p', how: 'h-g-i-g-o', callsign: 'PO-1',
                time: '2026-11-23T18:00:00Z', start: '2026-11-23T18:00:00Z', stale: '2026-11-24T18:00:00Z',
                center: [21, 52.2],
            },
            geometry: { type: 'Point', coordinates: [21, 52.2] },
        }],
        assets: [],
        size: 0,
        ...extra,
    };
}

function deps(uploads: string[], removed: string[] = []): JobDeps {
    return {
        upload: async (key: string) => {
            uploads.push(key);
        },
        remove: async (key: string) => {
            removed.push(key);
        },
        attachment: async () => null,
        toPMTiles: async (mbtiles: string, out: string) => {
            fs.copyFileSync(mbtiles, out);
        },
    };
}

function tmpdir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'area-job-test-'));
}

test('runJob - success: one profile asset per layer, the zip and a Success report', async () => {
    const tiles = await server((call, res) => {
        res.statusCode = 200;
        res.end(PNG);
    });
    const api = await server((call, res) => {
        if (call.method === 'POST' && call.url === '/api/profile/asset') return json(res, 200, { id: call.body.id });
        return json(res, 200, job());
    });

    const uploads: string[] = [];
    const dir = tmpdir();

    try {
        await runJob(job(), { api: api.base, tiles: tiles.base, secret: SECRET, tmpdir: dir, progressInterval: 0, retryDelayMs: 0 }, deps(uploads));

        const assets = api.calls.filter((c) => c.method === 'POST' && c.url === '/api/profile/asset');
        assert.equal(assets.length, 1);
        assert.equal(assets[0].body.name, 'Wyjście 23 XI – OSM.pmtiles');
        assert.deepEqual(assets[0].body.artifacts, [{ ext: '.pmtiles' }]);

        const assetId = String(assets[0].body.id);
        assert.ok(uploads.includes(`profile/user@example.com/${assetId}.pmtiles`), JSON.stringify(uploads));
        assert.ok(uploads.includes(`area-package/${job().id}/package.zip`), JSON.stringify(uploads));

        const patches = api.calls.filter((c) => c.method === 'PATCH');
        assert.ok(patches.some((c) => typeof c.body.progress === 'number' && c.body.status === undefined), 'progress reported');

        // The asset is on the row as soon as it exists, so a DELETE in the meantime removes it
        const assetPost = api.calls.findIndex((c) => c.method === 'POST' && c.url === '/api/profile/asset');
        const reported = api.calls.findIndex((c, i) => i > assetPost && c.method === 'PATCH' && Array.isArray(c.body.assets) && c.body.status === undefined);
        assert.ok(reported > assetPost, 'assets reported right after creation');

        const last = patches[patches.length - 1];
        assert.equal(last.body.status, 'Success');
        assert.equal(last.body.progress, 100);
        assert.deepEqual(last.body.assets, [assetId]);
        assert.ok(Number(last.body.size) > 0);

        assert.deepEqual(fs.readdirSync(dir), [], 'temporary files removed');
    } finally {
        await tiles.close();
        await api.close();
    }
});

test('runJob - package deleted while building: stops without uploading', async () => {
    const tiles = await server((call, res) => {
        res.statusCode = 200;
        res.end(PNG);
    });
    const api = await server((call, res) => {
        if (call.method === 'PATCH') return json(res, 404, { status: 404, message: 'Area Package Not Found' });
        return json(res, 200, {});
    });

    const uploads: string[] = [];
    const dir = tmpdir();

    try {
        await runJob(job(), { api: api.base, tiles: tiles.base, secret: SECRET, tmpdir: dir, progressInterval: 0, retryDelayMs: 0 }, deps(uploads));

        assert.equal(api.calls.filter((c) => c.method === 'POST').length, 0);
        assert.deepEqual(uploads, []);
        assert.equal(api.calls.filter((c) => c.body.status === 'Fail').length, 0);
        assert.deepEqual(fs.readdirSync(dir), [], 'temporary files removed');
    } finally {
        await tiles.close();
        await api.close();
    }
});

test('runJob - no access to the layer: Fail with the layer name', async () => {
    const tiles = await server((call, res) => {
        res.statusCode = 403;
        res.end();
    });
    const api = await server((call, res) => json(res, 200, job()));

    const dir = tmpdir();

    try {
        await runJob(job({
            layers: [{ source: 'basemap', id: 7, name: 'OSM', format: 'png', host: 'job-forbidden.svc', minzoom: 10, maxzoom: 10 }],
        }), { api: api.base, tiles: tiles.base, secret: SECRET, tmpdir: dir, progressInterval: 0, retryDelayMs: 0 }, deps([]));

        const last = api.calls.filter((c) => c.method === 'PATCH').pop();
        assert.equal(last?.body.status, 'Fail');
        assert.match(String(last?.body.error), /OSM/);
        assert.deepEqual(fs.readdirSync(dir), []);
    } finally {
        await tiles.close();
        await api.close();
    }
});

test('runJob - package above the size limit fails', async () => {
    const tiles = await server((call, res) => {
        res.statusCode = 200;
        res.end(PNG);
    });
    const api = await server((call, res) => {
        if (call.method === 'POST') return json(res, 200, { id: call.body.id });
        return json(res, 200, job());
    });

    const before = process.env.AREA_PACKAGE_MAX_BYTES;
    // Tiles (a few hundred bytes) fit, the finished zip (MBTiles + manifest) does not
    process.env.AREA_PACKAGE_MAX_BYTES = '1500';

    try {
        await runJob(job(), { api: api.base, tiles: tiles.base, secret: SECRET, tmpdir: tmpdir(), progressInterval: 0, retryDelayMs: 0 }, deps([]));

        const last = api.calls.filter((c) => c.method === 'PATCH').pop();
        assert.equal(last?.body.status, 'Fail');
        assert.match(String(last?.body.error), /limit rozmiaru/);
        assert.equal((last?.body.assets as string[] | undefined)?.length, 1, 'uploaded asset kept so DELETE can remove it');
    } finally {
        if (before === undefined) delete process.env.AREA_PACKAGE_MAX_BYTES;
        else process.env.AREA_PACKAGE_MAX_BYTES = before;
        await tiles.close();
        await api.close();
    }
});

test('AreaPackagePool - requeues before the first poll', async () => {
    const api = await server((call, res) => {
        if (call.url === '/api/area-package/requeue') return json(res, 200, { count: 0 });
        return json(res, 200, { items: [] });
    });

    const pool = new AreaPackagePool({ api: api.base, tiles: 'http://127.0.0.1:1', secret: SECRET, tmpdir: tmpdir(), interval: 20 });

    try {
        await pool.start();
        await new Promise((resolve) => setTimeout(resolve, 100));
        await pool.close();

        assert.equal(api.calls[0].url, '/api/area-package/requeue');
        assert.ok(api.calls.slice(1).some((c) => c.method === 'GET' && c.url.startsWith('/api/area-package?')));
    } finally {
        await api.close();
    }
});

test('runJob - deleted after a layer was uploaded: removes the uploaded asset', async () => {
    const tiles = await server((call, res) => {
        res.statusCode = 200;
        res.end(PNG);
    });
    let assetCreated = false;
    const api = await server((call, res) => {
        if (call.method === 'POST' && call.url === '/api/profile/asset') {
            assetCreated = true;
            return json(res, 200, { id: call.body.id });
        }
        if (call.method === 'DELETE') return json(res, 200, { status: 200 });
        if (call.method === 'PATCH' && assetCreated) return json(res, 404, { status: 404 });
        return json(res, 200, job());
    });

    const uploads: string[] = [];
    try {
        await runJob(job(), { api: api.base, tiles: tiles.base, secret: SECRET, tmpdir: tmpdir(), progressInterval: 0, retryDelayMs: 0 }, deps(uploads));

        const assetId = String(api.calls.find((c) => c.method === 'POST')?.body.id);
        assert.ok(api.calls.some((c) => c.method === 'DELETE' && c.url === `/api/profile/asset/${assetId}`), 'orphan asset removed');
        assert.ok(!uploads.some((k) => k.startsWith('area-package/')), 'no zip uploaded');
    } finally {
        await tiles.close();
        await api.close();
    }
});

test('runJob - deleted right after the zip upload: removes the zip and the assets', async () => {
    const tiles = await server((call, res) => {
        res.statusCode = 200;
        res.end(PNG);
    });
    const api = await server((call, res) => {
        if (call.method === 'POST') return json(res, 200, { id: call.body.id });
        if (call.method === 'DELETE') return json(res, 200, { status: 200 });
        if (call.method === 'PATCH' && call.body.status === 'Success') return json(res, 404, { status: 404 });
        return json(res, 200, job());
    });

    const removed: string[] = [];
    try {
        await runJob(job(), { api: api.base, tiles: tiles.base, secret: SECRET, tmpdir: tmpdir(), progressInterval: 0, retryDelayMs: 0 }, deps([], removed));

        assert.deepEqual(removed, [`area-package/${job().id}/package.zip`]);
        assert.equal(api.calls.filter((c) => c.method === 'DELETE').length, 1);
    } finally {
        await tiles.close();
        await api.close();
    }
});

test('runJob - assets left by an interrupted attempt are removed before building again', async () => {
    const tiles = await server((call, res) => {
        res.statusCode = 200;
        res.end(PNG);
    });
    const api = await server((call, res) => {
        if (call.method === 'POST') return json(res, 200, { id: call.body.id });
        if (call.method === 'DELETE') return json(res, 200, { status: 200 });
        return json(res, 200, job());
    });

    try {
        await runJob(job({ assets: ['11111111-1111-4111-8111-111111111111'] }), { api: api.base, tiles: tiles.base, secret: SECRET, tmpdir: tmpdir(), progressInterval: 0, retryDelayMs: 0 }, deps([]));

        assert.equal(api.calls[0].method, 'DELETE');
        assert.equal(api.calls[0].url, '/api/profile/asset/11111111-1111-4111-8111-111111111111');
        assert.equal(api.calls.filter((c) => c.method === 'PATCH').pop()?.body.status, 'Success');
    } finally {
        await tiles.close();
        await api.close();
    }
});

test('runJob - a failed progress report does not fail the job', async () => {
    const tiles = await server((call, res) => {
        res.statusCode = 200;
        res.end(PNG);
    });
    let failedOnce = false;
    const api = await server((call, res) => {
        if (call.method === 'POST') return json(res, 200, { id: call.body.id });
        if (call.method === 'PATCH' && !failedOnce) {
            failedOnce = true;
            return json(res, 502, { status: 502 });
        }
        return json(res, 200, job());
    });

    try {
        await runJob(job(), { api: api.base, tiles: tiles.base, secret: SECRET, tmpdir: tmpdir(), progressInterval: 0, retryDelayMs: 0 }, deps([]));
        assert.equal(api.calls.filter((c) => c.method === 'PATCH').pop()?.body.status, 'Success');
    } finally {
        await tiles.close();
        await api.close();
    }
});

test('runJob - downloaded bytes above the limit fail before converting anything', async () => {
    const tiles = await server((call, res) => {
        res.statusCode = 200;
        res.end(PNG);
    });
    const api = await server((call, res) => json(res, 200, job()));

    const before = process.env.AREA_PACKAGE_MAX_BYTES;
    process.env.AREA_PACKAGE_MAX_BYTES = String(PNG.length * 2);
    let converted = false;

    try {
        await runJob(job(), { api: api.base, tiles: tiles.base, secret: SECRET, tmpdir: tmpdir(), progressInterval: 0, retryDelayMs: 0 }, {
            ...deps([]),
            toPMTiles: async () => {
                converted = true;
            },
        });

        const last = api.calls.filter((c) => c.method === 'PATCH').pop();
        assert.equal(last?.body.status, 'Fail');
        assert.match(String(last?.body.error), /limit rozmiaru/);
        assert.equal(converted, false);
    } finally {
        if (before === undefined) delete process.env.AREA_PACKAGE_MAX_BYTES;
        else process.env.AREA_PACKAGE_MAX_BYTES = before;
        await tiles.close();
        await api.close();
    }
});

test('AreaPackagePool - claims jobs atomically and skips one another worker took', async () => {
    const api = await server((call, res) => {
        if (call.url === '/api/area-package/requeue') return json(res, 200, { count: 0 });
        if (call.url.endsWith('/claim')) return json(res, 409, { status: 409 });
        return json(res, 200, { items: [job({ status: 'Pending' })] });
    });

    const pool = new AreaPackagePool({ api: api.base, tiles: 'http://127.0.0.1:1', secret: SECRET, tmpdir: tmpdir(), interval: 20, deps: deps([]) });

    try {
        await pool.start();
        await new Promise((resolve) => setTimeout(resolve, 100));
        await pool.close();

        assert.ok(api.calls.some((c) => c.method === 'POST' && c.url === `/api/area-package/${job().id}/claim`));
        assert.ok(!api.calls.some((c) => c.method === 'PATCH'), 'no unconditional PATCH to Running');
    } finally {
        await api.close();
    }
});
