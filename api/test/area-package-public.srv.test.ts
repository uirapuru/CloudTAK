import test from 'node:test';
import assert from 'node:assert';
import { Readable } from 'node:stream';
import jwt from 'jsonwebtoken';
import Flight from './flight.js';
import Sinon from 'sinon';
import S3 from '../common/aws/s3.js';
import bboxPolygon from '@turf/bbox-polygon';
import { sql } from 'drizzle-orm';

const flight = new Flight();

flight.init({ takserver: true });
flight.takeoff();
flight.user();
flight.user({ username: 'user', admin: false });

const SECRET = 'coe-wildland-fire';

function etl(access: string): string {
    return `etl.${jwt.sign({ access, internal: true }, SECRET)}`;
}

let pending = { id: '', token: '' };
let done = { id: '', token: '' };

test('Create packages', async () => {
    const models = flight.config!.models;

    const base = {
        username: 'user@example.com',
        bounds: bboxPolygon([20.9, 52.1, 21.1, 52.3]).geometry,
        layers: [],
        features: [{ type: 'Feature', properties: { callsign: 'PO-1' }, geometry: { type: 'Point', coordinates: [21, 52.2] } }],
    };


    const p = await models.AreaPackage.generate({ ...base, name: 'Pending', token: 'pending-token-pending-token-pending-token-00' } as never);
    pending = { id: p.id, token: p.token };

    const d = await models.AreaPackage.generate({ ...base, name: 'Wyjście "A"', token: 'success-token-success-token-success-token-0', status: 'Success' } as never);
    done = { id: d.id, token: d.token };
});

async function download(token: string) {
    return await flight.fetch(`/api/public/area-package/${token}.zip`, { method: 'GET' }, { verify: false, json: false });
}

test('GET: api/public/area-package - unknown token is 404', async () => {
    const res = await download('nope');
    assert.equal(res.status, 404);
});

test('GET: api/public/area-package - package that is not ready is 404', async () => {
    const res = await download(pending.token);
    assert.equal(res.status, 404);
});

test('GET: api/public/area-package - finished package downloads without auth', async () => {
    const getObject = Sinon.stub(S3, 'getObject').resolves({
        body: Readable.from([Buffer.from('PK-fake-zip')]),
        contentLength: 11,
        contentType: 'application/zip',
    });

    try {
        const res = await download(done.token);

        assert.equal(res.status, 200);
        assert.ok(getObject.calledWith(`area-package/${done.id}/package.zip`));
        assert.equal(res.headers.get('content-type'), 'application/zip');
        assert.equal(res.headers.get('content-length'), '11');

        const disposition = res.headers.get('content-disposition');
        assert.match(disposition, /^attachment; filename="Wyj_cie A\.zip"; filename\*=UTF-8''Wyj%C5%9Bcie%20A\.zip$/);
    } finally {
        getObject.restore();
    }
});

test('GET: api/public/area-package - every miss looks the same', async () => {
    const a = await download('nope');
    const b = await download(pending.token);

    assert.equal(a.status, 404);
    assert.equal(b.status, 404);
    assert.equal(a.body, b.body);
});

test('GET: api/area-package - import token is rejected', async () => {
    const res = await flight.fetch('/api/area-package?status=Pending', {
        method: 'GET',
        auth: { bearer: etl('import') },
    }, false);
    assert.ok([401, 403].includes(res.status), String(res.status));
});

test('GET: api/area-package - user token is rejected', async () => {
    const res = await flight.fetch('/api/area-package?status=Pending', {
        method: 'GET',
        auth: { bearer: flight.token.user },
    }, false);
    assert.ok([401, 403].includes(res.status), String(res.status));
});

test('GET: api/area-package - worker lists pending jobs with features', async () => {
    const res = await flight.fetch('/api/area-package?status=Pending&limit=5', {
        method: 'GET',
        auth: { bearer: etl('area_package') },
    }, false);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].id, pending.id);
    assert.equal(res.body.items[0].username, 'user@example.com');
    assert.equal(res.body.items[0].features.length, 1);
});

test('PATCH: api/area-package/:id - user token is rejected', async () => {
    const res = await flight.fetch(`/api/area-package/${pending.id}`, {
        method: 'PATCH',
        auth: { bearer: flight.token.user },
        body: { status: 'Running' },
    }, false);
    assert.ok([401, 403].includes(res.status), String(res.status));
});

test('PATCH: api/area-package/:id - worker reports progress', async () => {
    const res = await flight.fetch(`/api/area-package/${pending.id}`, {
        method: 'PATCH',
        auth: { bearer: etl('area_package') },
        body: { status: 'Running', progress: 40 },
    }, false);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'Running');
    assert.equal(res.body.progress, 40);
    assert.equal(res.body.username, 'user@example.com');
});

test('PATCH: api/area-package/:id - unknown package is 404', async () => {
    const res = await flight.fetch('/api/area-package/00000000-0000-4000-8000-000000000000', {
        method: 'PATCH',
        auth: { bearer: etl('area_package') },
        body: { progress: 10 },
    }, false);
    assert.equal(res.status, 404);
});

test('POST: api/area-package/requeue - running jobs go back to pending', async () => {
    const res = await flight.fetch('/api/area-package/requeue', {
        method: 'POST',
        auth: { bearer: etl('area_package') },
        body: {},
    }, false);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.count, 1);

    const row = await flight.config!.models.AreaPackage.from(pending.id);
    assert.equal(row.status, 'Pending');
    assert.equal(row.progress, 0);
});

test('POST: api/area-package/:id/claim - only one worker gets a pending job', async () => {
    const first = await flight.fetch(`/api/area-package/${pending.id}/claim`, {
        method: 'POST',
        auth: { bearer: etl('area_package') },
        body: {},
    }, false);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.status, 'Running');
    assert.equal(first.body.attempts, 1);
    assert.equal(first.body.features.length, 1);

    const second = await flight.fetch(`/api/area-package/${pending.id}/claim`, {
        method: 'POST',
        auth: { bearer: etl('area_package') },
        body: {},
    }, false);
    assert.equal(second.status, 409);
});

test('POST: api/area-package/requeue - a job with a recent heartbeat stays Running', async () => {
    const res = await flight.fetch('/api/area-package/requeue', {
        method: 'POST',
        auth: { bearer: etl('area_package') },
        body: { stale_minutes: 15 },
    }, false);
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 0);
    assert.equal((await flight.config!.models.AreaPackage.from(pending.id)).status, 'Running');
});

test('POST: api/area-package/requeue - a stale job goes back to Pending', async () => {
    await flight.config!.pg.execute(sql`UPDATE area_packages SET updated = Now() - interval '1 hour' WHERE id = ${pending.id}`);

    const res = await flight.fetch('/api/area-package/requeue', {
        method: 'POST',
        auth: { bearer: etl('area_package') },
        body: { stale_minutes: 15 },
    }, false);
    assert.equal(res.body.count, 1);
    assert.equal((await flight.config!.models.AreaPackage.from(pending.id)).status, 'Pending');
});

test('POST: api/area-package/requeue - a job interrupted three times fails', async () => {
    await flight.config!.pg.execute(sql`UPDATE area_packages SET status = 'Running', attempts = 3 WHERE id = ${pending.id}`);

    const res = await flight.fetch('/api/area-package/requeue', {
        method: 'POST',
        auth: { bearer: etl('area_package') },
        body: {},
    }, false);
    assert.equal(res.status, 200);

    const row = await flight.config!.models.AreaPackage.from(pending.id);
    assert.equal(row.status, 'Fail');
    assert.match(String(row.error), /3/);
});

test('GET: api/public/area-package - deleted package is 404', async () => {
    const del = Sinon.stub(S3, 'del').resolves();
    try {
        const res = await flight.fetch(`/api/profile/area-package/${done.id}`, {
            method: 'DELETE',
            auth: { bearer: flight.token.user },
        }, false);
        assert.equal(res.status, 200);
    } finally {
        del.restore();
    }

    const res = await download(done.token);
    assert.equal(res.status, 404);
});

flight.landing();
