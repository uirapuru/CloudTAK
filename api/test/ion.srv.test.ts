import test from 'node:test';
import assert from 'node:assert';
import Flight from './flight.js';
import { ionControl } from '../stateless/lib/control/ion.js';

const flight = new Flight();

flight.init({ takserver: true });
flight.takeoff();
flight.user();
flight.user({ admin: false });

const ionCalls: Array<{ url: string; auth: string | null }> = [];

test('mock ion', () => {
    ionControl.cache.clear();
    ionControl.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        ionCalls.push({ url: String(input), auth: new Headers(init?.headers).get('Authorization') });
        return new Response(JSON.stringify({
            type: '3DTILES',
            options: { url: 'https://tile.googleapis.com/v1/3dtiles/root.json?key=abc' },
            attributions: [{ html: '<b>Google</b>' }],
        }), { status: 200 });
    }) as typeof fetch;
});

test('GET api/ion without auth', async () => {
    const res = await flight.fetch('/api/ion', { method: 'GET' }, false);
    assert.equal(res.status, 401);
});

test('GET api/ion without a token lists nothing', async () => {
    delete process.env.CESIUM_ION_TOKEN;
    const res = await flight.fetch('/api/ion', { method: 'GET', auth: { bearer: flight.token.user } }, true);
    assert.deepEqual(res.body, { items: [] });
});

test('GET api/ion/:name/endpoint without a token', async () => {
    const res = await flight.fetch('/api/ion/osm-buildings/endpoint', { method: 'GET', auth: { bearer: flight.token.user } }, false);
    assert.equal(res.status, 404);
    assert.equal(res.body.message, 'Cesium ion is not configured');
});

test('PUT api/config ion::token', async () => {
    const res = await flight.fetch('/api/config', {
        method: 'PUT',
        auth: { bearer: flight.token.admin },
        body: { 'ion::token': 'config-token' },
    }, true);
    assert.deepEqual(res.body, { 'ion::token': 'config-token' });
});

test('GET api/config ion::token as non-admin', async () => {
    const res = await flight.fetch('/api/config?keys=ion::token', { method: 'GET', auth: { bearer: flight.token.user } }, false);
    assert.equal(res.status, 401);
    assert.equal(JSON.stringify(res.body).includes('config-token'), false);
});

test('GET api/ion lists the allowlist', async () => {
    const res = await flight.fetch('/api/ion', { method: 'GET', auth: { bearer: flight.token.user } }, true);
    assert.deepEqual(res.body, {
        items: [
            { name: 'osm-buildings', label: 'OSM Buildings' },
            { name: 'google-photorealistic', label: 'Google Photorealistic' },
        ],
    });
});

test('GET api/ion/:name/endpoint rejects unknown names', async () => {
    const res = await flight.fetch('/api/ion/96188/endpoint', { method: 'GET', auth: { bearer: flight.token.user } }, false);
    assert.equal(res.status, 404);
    assert.equal(ionCalls.length, 0);
});

test('GET api/ion/:name/endpoint returns sanitized access', async () => {
    const res = await flight.fetch('/api/ion/google-photorealistic/endpoint', { method: 'GET', auth: { bearer: flight.token.user } }, true);
    assert.deepEqual(res.body, {
        url: 'https://tile.googleapis.com/v1/3dtiles/root.json?key=abc',
        attributions: [{ text: 'Google' }],
    });
    assert.equal(ionCalls.length, 1);
    assert.equal(ionCalls[0].url, 'https://api.cesium.com/v1/assets/2275207/endpoint');
    assert.equal(ionCalls[0].auth, 'Bearer config-token');
});

test('GET api/ion/:name/endpoint uses the cache', async () => {
    await flight.fetch('/api/ion/google-photorealistic/endpoint', { method: 'GET', auth: { bearer: flight.token.user } }, true);
    assert.equal(ionCalls.length, 1);
});

test('empty ion::token falls back to CESIUM_ION_TOKEN', async () => {
    await flight.fetch('/api/config', {
        method: 'PUT',
        auth: { bearer: flight.token.admin },
        body: { 'ion::token': '' },
    }, false);
    process.env.CESIUM_ION_TOKEN = 'env-token';

    const res = await flight.fetch('/api/ion/google-photorealistic/endpoint', { method: 'GET', auth: { bearer: flight.token.user } }, true);
    assert.equal(res.status, 200);
    assert.equal(ionCalls.length, 2);
    assert.equal(ionCalls[1].auth, 'Bearer env-token');

    delete process.env.CESIUM_ION_TOKEN;
});

flight.landing();
