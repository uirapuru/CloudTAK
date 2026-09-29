import test from 'node:test';
import assert from 'node:assert';
import Flight from './flight.js';
import { liveControl } from '../stateless/lib/control/live.js';

const flight = new Flight();

flight.init({ takserver: true });
flight.takeoff();
flight.user();
flight.user({ admin: false });

const calls: string[] = [];
const INDEX = { items: [{ name: 'mpk-wroclaw', label: 'Komunikacja miejska Wrocław', refresh: 10, attribution: 'MPK Wrocław', updated: null, stale: true }] };
const LAYER = { type: 'FeatureCollection', features: [], attribution: 'MPK Wrocław', updated: null, stale: true };

test('mock live-feeds pod', () => {
    liveControl.fetch = (async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/layers')) return new Response(JSON.stringify(INDEX), { status: 200 });
        if (url.includes('/layers/mpk-wroclaw?since=')) return new Response(JSON.stringify({ unchanged: true, updated: 'x' }), { status: 200 });
        if (url.endsWith('/layers/mpk-wroclaw/veh-1')) return new Response(JSON.stringify({ properties: { a: 1 } }), { status: 200 });
        if (url.endsWith('/layers/mpk-wroclaw')) return new Response(JSON.stringify(LAYER), { status: 200 });
        return new Response(JSON.stringify({ error: 'unknown layer' }), { status: 404 });
    }) as typeof fetch;
});

test('GET api/live without auth', async () => {
    const res = await flight.fetch('/api/live', { method: 'GET' }, false);
    assert.equal(res.status, 401);
});

test('GET api/live without LIVE_FEEDS_URL lists nothing', async () => {
    delete process.env.LIVE_FEEDS_URL;
    const res = await flight.fetch('/api/live', { method: 'GET', auth: { bearer: flight.token.user } }, true);
    assert.deepEqual(res.body, { items: [] });
    assert.equal(calls.length, 0);
});

test('GET api/live proxies the pod index', async () => {
    process.env.LIVE_FEEDS_URL = 'http://pod.test:8080/';
    const res = await flight.fetch('/api/live', { method: 'GET', auth: { bearer: flight.token.user } }, true);
    assert.deepEqual(res.body, INDEX);
    assert.equal(calls.at(-1), 'http://pod.test:8080/layers');
});

test('GET api/live/:name proxies the layer unchanged', async () => {
    const res = await flight.fetch('/api/live/mpk-wroclaw', { method: 'GET', auth: { bearer: flight.token.user } }, false);
    assert.deepEqual(res.body, LAYER);
});

test('GET api/live/:name for an unknown layer', async () => {
    const res = await flight.fetch('/api/live/nope', { method: 'GET', auth: { bearer: flight.token.user } }, false);
    assert.equal(res.status, 404);
});

test('GET api/live/:name rejects names outside the pattern', async () => {
    const before = calls.length;
    const res = await flight.fetch('/api/live/..%2Fhealth', { method: 'GET', auth: { bearer: flight.token.user } }, false);
    assert.equal(res.status, 400);
    assert.equal(calls.length, before);
});

test('GET api/live/:name passes since URL-encoded to the pod', async () => {
    const res = await flight.fetch('/api/live/mpk-wroclaw?since=2026-09-29T10:00:00%2B00:00', { method: 'GET', auth: { bearer: flight.token.user } }, false);
    assert.deepEqual(res.body, { unchanged: true, updated: 'x' });
    assert.equal(calls.at(-1), 'http://pod.test:8080/layers/mpk-wroclaw?since=2026-09-29T10%3A00%3A00%2B00%3A00');
});

test('GET api/live/:name/:id returns feature details', async () => {
    const res = await flight.fetch('/api/live/mpk-wroclaw/veh-1', { method: 'GET', auth: { bearer: flight.token.user } }, false);
    assert.deepEqual(res.body, { properties: { a: 1 } });
});

test('GET api/live/:name/:id unknown feature is 404', async () => {
    const res = await flight.fetch('/api/live/mpk-wroclaw/veh-2', { method: 'GET', auth: { bearer: flight.token.user } }, false);
    assert.equal(res.status, 404);
    assert.match(JSON.stringify(res.body), /Obiekt już niedostępny/);
});

test('GET api/live/:name unknown layer keeps its own message', async () => {
    const res = await flight.fetch('/api/live/nope', { method: 'GET', auth: { bearer: flight.token.user } }, false);
    assert.match(JSON.stringify(res.body), /Unknown live layer/);
});

test('GET api/live/:name/:id rejects a bad id without calling the pod', async () => {
    const before = calls.length;
    const res = await flight.fetch('/api/live/mpk-wroclaw/a%20b%3Fx', { method: 'GET', auth: { bearer: flight.token.user } }, false);
    assert.equal(res.status, 400);
    assert.equal(calls.length, before);
});

test('GET api/live/:name/:id without auth', async () => {
    const res = await flight.fetch('/api/live/mpk-wroclaw/veh-1', { method: 'GET' }, false);
    assert.equal(res.status, 401);
});

test('GET api/live/:name without auth', async () => {
    const res = await flight.fetch('/api/live/mpk-wroclaw', { method: 'GET' }, false);
    assert.equal(res.status, 401);
});

test('GET api/live when the pod is down', async () => {
    liveControl.fetch = (async () => {
        throw new TypeError('fetch failed');
    }) as typeof fetch;
    const res = await flight.fetch('/api/live', { method: 'GET', auth: { bearer: flight.token.user } }, false);
    assert.equal(res.status, 502);
    delete process.env.LIVE_FEEDS_URL;
});

flight.landing();
