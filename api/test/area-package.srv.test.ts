import test from 'node:test';
import assert from 'node:assert';
import Flight from './flight.js';
import Sinon from 'sinon';
import S3 from '../common/aws/s3.js';
import { Basemap_Type, Basemap_Format } from '../common/enums.js';

const flight = new Flight();

flight.init({ takserver: true });
flight.takeoff();
flight.user();
flight.user({ username: 'user', admin: false });
flight.user({ username: 'other', admin: false });

const AREA: [number, number, number, number] = [20.9, 52.1, 21.1, 52.3];

let osm = 0;
let google = 0;
let vector = 0;
let pkgId = '';

test('Create basemaps', async () => {
    const models = flight.config!.models;

    osm = (await models.Basemap.generate({
        name: 'OSM',
        url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
        minzoom: 0,
        maxzoom: 18,
        format: Basemap_Format.PNG,
        type: Basemap_Type.RASTER,
    })).id;

    google = (await models.Basemap.generate({
        name: 'Google Satelita',
        url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        minzoom: 0,
        maxzoom: 20,
        format: Basemap_Format.JPEG,
        type: Basemap_Type.RASTER,
    })).id;

    vector = (await models.Basemap.generate({
        name: 'Vector',
        url: 'https://example.com/{z}/{x}/{y}.mvt',
        minzoom: 0,
        maxzoom: 14,
        format: Basemap_Format.MVT,
        type: Basemap_Type.VECTOR,
    })).id;
});

test('POST: api/profile/area-package/preview - availability and size', async () => {
    const res = await flight.fetch('/api/profile/area-package/preview', {
        method: 'POST',
        auth: { bearer: flight.token.user },
        body: {
            bounds: AREA,
            layers: [
                { source: 'basemap', id: osm, minzoom: 10, maxzoom: 10 },
                { source: 'basemap', id: google },
                { source: 'basemap', id: vector },
                { source: 'profile', file: '00000000-0000-4000-8000-000000000000' },
            ],
        },
    }, false);

    assert.equal(res.status, 200, JSON.stringify(res.body));

    const [o, g, v, p] = res.body.layers;

    assert.equal(o.available, true);
    assert.equal(o.name, 'OSM');
    assert.equal(o.tiles, 4);
    assert.equal(o.bytes, 4 * 15000);
    assert.equal(o.layer_minzoom, 0);
    assert.equal(o.layer_maxzoom, 18);

    assert.equal(g.available, false);
    assert.equal(g.reason, 'google');
    assert.equal(g.tiles, 0);

    assert.equal(v.available, false);
    assert.equal(v.reason, 'vector');

    assert.equal(p.available, false);
    assert.equal(p.reason, 'forbidden');

    assert.equal(res.body.tiles, 4);
    assert.equal(res.body.bytes, 60000);
    assert.deepEqual(res.body.limits, { tiles: 100000, bytes: 2147483648, features: 5000 });
});

function body(extra: Record<string, unknown> = {}) {
    return {
        name: 'Wyjście 23 XI',
        bounds: AREA,
        layers: [{ source: 'basemap', id: osm, minzoom: 10, maxzoom: 12 }],
        features: [{
            id: 'marker-1',
            type: 'Feature',
            path: '/',
            properties: {
                type: 'u-d-p',
                how: 'h-g-i-g-o',
                callsign: 'PO-1',
                time: '2026-11-23T18:00:00Z',
                start: '2026-11-23T18:00:00Z',
                stale: '2026-11-24T18:00:00Z',
                center: [21, 52.2],
            },
            geometry: { type: 'Point', coordinates: [21, 52.2] },
        }],
        ...extra,
    };
}

test('POST: api/profile/area-package - rejects Google', async () => {
    const res = await flight.fetch('/api/profile/area-package', {
        method: 'POST',
        auth: { bearer: flight.token.user },
        body: body({ layers: [{ source: 'basemap', id: google, minzoom: 10, maxzoom: 12 }] }),
    }, false);
    assert.equal(res.status, 400);
});

test('POST: api/profile/area-package - rejects zoom outside of the layer range', async () => {
    const res = await flight.fetch('/api/profile/area-package', {
        method: 'POST',
        auth: { bearer: flight.token.user },
        body: body({ layers: [{ source: 'basemap', id: osm, minzoom: 10, maxzoom: 19 }] }),
    }, false);
    assert.equal(res.status, 400);
});

test('POST: api/profile/area-package - rejects minzoom above maxzoom', async () => {
    const res = await flight.fetch('/api/profile/area-package', {
        method: 'POST',
        auth: { bearer: flight.token.user },
        body: body({ layers: [{ source: 'basemap', id: osm, minzoom: 12, maxzoom: 10 }] }),
    }, false);
    assert.equal(res.status, 400);
});

test('POST: api/profile/area-package - rejects too many features', async () => {
    const one = body().features[0];
    const features = Array.from({ length: 5001 }, (_, i) => ({ ...one, id: `m-${i}` }));
    const res = await flight.fetch('/api/profile/area-package', {
        method: 'POST',
        auth: { bearer: flight.token.user },
        body: body({ features }),
    }, false);
    assert.equal(res.status, 400);
});

test('POST: api/profile/area-package - rejects an area above the tile limit', async () => {
    const res = await flight.fetch('/api/profile/area-package', {
        method: 'POST',
        auth: { bearer: flight.token.user },
        body: body({
            bounds: [14.1, 49.0, 24.1, 54.8],
            layers: [{ source: 'basemap', id: osm, minzoom: 0, maxzoom: 18 }],
        }),
    }, false);
    assert.equal(res.status, 400);
    assert.match(res.body.message, /tile/i);
});

test('POST: api/profile/area-package - rejects an antimeridian crossing', async () => {
    const res = await flight.fetch('/api/profile/area-package', {
        method: 'POST',
        auth: { bearer: flight.token.user },
        body: body({ bounds: [170, 0, -170, 10] }),
    }, false);
    assert.equal(res.status, 400);
});

test('POST: api/profile/area-package', async () => {
    const res = await flight.fetch('/api/profile/area-package', {
        method: 'POST',
        auth: { bearer: flight.token.user },
        body: body(),
    }, false);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'Pending');
    assert.equal(res.body.name, 'Wyjście 23 XI');
    assert.match(res.body.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(res.body.features, undefined);
    assert.deepEqual(res.body.layers, [{
        source: 'basemap',
        id: osm,
        name: 'OSM',
        format: 'png',
        host: 'tile.openstreetmap.de',
        minzoom: 10,
        maxzoom: 12,
    }]);
    assert.deepEqual(res.body.assets, []);

    pkgId = res.body.id;

    // The CoT UID in the ATAK package comes from the feature id: it must survive validation
    const row = await flight.config!.models.AreaPackage.from(pkgId);
    assert.equal(row.features[0].id, 'marker-1');
    assert.equal(row.features[0].path, '/');
    assert.equal(row.features[0].properties.callsign, 'PO-1');
});

test('POST: api/profile/area-package - at most three active packages per user', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
        const res = await flight.fetch('/api/profile/area-package', {
            method: 'POST',
            auth: { bearer: flight.token.user },
            body: body({ name: `extra ${i}` }),
        }, false);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        ids.push(res.body.id);
    }

    const fourth = await flight.fetch('/api/profile/area-package', {
        method: 'POST',
        auth: { bearer: flight.token.user },
        body: body({ name: 'fourth' }),
    }, false);
    assert.equal(fourth.status, 400);
    assert.match(fourth.body.message, /3/);

    const other = await flight.fetch('/api/profile/area-package', {
        method: 'POST',
        auth: { bearer: flight.token.other },
        body: body({ name: 'other user' }),
    }, false);
    assert.equal(other.status, 200, 'the limit is per user');

    for (const id of [...ids, other.body.id]) await flight.config!.models.AreaPackage.delete(id);
});

test('GET: api/profile/area-package - owner sees the package', async () => {
    const res = await flight.fetch('/api/profile/area-package', {
        method: 'GET',
        auth: { bearer: flight.token.user },
    }, false);

    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].id, pkgId);
    assert.equal(res.body.items[0].features, undefined);
});

test('GET: api/profile/area-package - other user does not', async () => {
    const res = await flight.fetch('/api/profile/area-package', {
        method: 'GET',
        auth: { bearer: flight.token.other },
    }, false);

    assert.equal(res.status, 200);
    assert.equal(res.body.total, 0);
});

test('GET: api/profile/area-package/:id/qr - not ready yet is 409', async () => {
    const res = await flight.fetch(`/api/profile/area-package/${pkgId}/qr`, {
        method: 'GET',
        auth: { bearer: flight.token.user },
    }, false);

    assert.equal(res.status, 409);
});

test('GET: api/profile/area-package/:id/qr - ATAK import link for a finished package', async () => {
    const row = await flight.config!.models.AreaPackage.commit(pkgId, { status: 'Success' });

    const res = await flight.fetch(`/api/profile/area-package/${pkgId}/qr`, {
        method: 'GET',
        auth: { bearer: flight.token.user },
    }, false);

    assert.equal(res.status, 200, JSON.stringify(res.body));

    const url = `${flight.config!.API_URL}/api/public/area-package/${row.token}.zip`;
    assert.equal(res.body.url, url);
    assert.equal(res.body.uri, `tak://com.atakmap.app/import?url=${encodeURIComponent(url)}&filename=${encodeURIComponent('Wyjście 23 XI.zip')}`);
    assert.match(res.body.svg, /^<svg/);
});

test('GET: api/profile/area-package/:id/qr - other user gets 404', async () => {
    const res = await flight.fetch(`/api/profile/area-package/${pkgId}/qr`, {
        method: 'GET',
        auth: { bearer: flight.token.other },
    }, false);

    assert.equal(res.status, 404);
});

test('GET: api/profile/area-package/:id - other user gets 404', async () => {
    const res = await flight.fetch(`/api/profile/area-package/${pkgId}`, {
        method: 'GET',
        auth: { bearer: flight.token.other },
    }, false);

    assert.equal(res.status, 404);
});

test('DELETE: api/profile/area-package/:id - other user gets 404', async () => {
    const res = await flight.fetch(`/api/profile/area-package/${pkgId}`, {
        method: 'DELETE',
        auth: { bearer: flight.token.other },
    }, false);

    assert.equal(res.status, 404);
});

test('DELETE: api/profile/area-package/:id', async () => {
    const del = Sinon.stub(S3, 'del').resolves();

    try {
        const res = await flight.fetch(`/api/profile/area-package/${pkgId}`, {
            method: 'DELETE',
            auth: { bearer: flight.token.user },
        }, false);

        assert.equal(res.status, 200);
        assert.ok(del.calledWith(`area-package/${pkgId}/`, { recurse: true }));
    } finally {
        del.restore();
    }

    const res = await flight.fetch(`/api/profile/area-package/${pkgId}`, {
        method: 'GET',
        auth: { bearer: flight.token.user },
    }, false);

    assert.equal(res.status, 404);
});

flight.landing();
