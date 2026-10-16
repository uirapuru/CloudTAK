import test from 'node:test';
import assert from 'node:assert';
import { CoTParser } from '@tak-ps/node-cot';
import type CoT from '@tak-ps/node-cot';
import Flight from './flight.js';
import { deps } from '../common/author-destinations.js';

const flight = new Flight();

flight.init({ takserver: true });
flight.takeoff();
flight.user();

const time = new Date('2025-03-04T22:54:15.447Z').toISOString();
const coords = [[17.03, 51.11, 0], [17.05, 51.1, 0], [17.07, 51.09, 0]];
const plan = {
    version: 1, mode: 'foot', mode_name: 'Pieszo',
    waypoints: [[17.03, 51.11], [17.07, 51.09]],
    legs: [{ start: 0, end: 2, distance_m: 3000, duration_s: 2000 }],
};

const sent: CoT[][] = [];
let original: typeof deps.fetchEndpoints;

test('podmiana wysyłki i urządzeń autora', () => {
    original = deps.fetchEndpoints;
    deps.fetchEndpoints = async () => [{ uid: 'ANDROID-1', username: 'admin@example.com' }];
    flight.config!.hub.submitCots = async (opts) => {
        sent.push(opts.cots as CoT[]);
    };
});

function route(id = 'route-1') {
    return {
        id, type: 'Feature', path: '/',
        properties: { type: 'b-m-r', how: 'm-g', time, start: time, stale: time, callsign: 'Trasa', archived: true, center: [17.05, 51.1], metadata: { taklab_route: plan } },
        geometry: { type: 'LineString', coordinates: coords },
    };
}

function put(body: object, query = '') {
    return flight.fetch(`/api/profile/feature${query}`, {
        method: 'PUT', auth: { bearer: flight.token.admin }, body,
    }, true);
}

function xml(cot: CoT): string {
    return CoTParser.to_xml(cot);
}

test('PUT submit trasy z planem: jeden CoT z __taklab_route i adresatem', async () => {
    sent.length = 0;
    await put(route(), '?submit=true');
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].length, 1);
    const text = xml(sent[0][0]);
    assert.match(text, /<__taklab_route /);
    assert.match(text, /<marti><dest uid="ANDROID-1"\/><\/marti>/);
});

test('PUT bez submit: nic nie wysłane', async () => {
    sent.length = 0;
    await put(route('route-2'));
    assert.strictEqual(sent.length, 0);
});

test('PUT submit znacznika a-f-G: bez planu i bez zmiany adresatów', async () => {
    sent.length = 0;
    await put({
        id: 'marker-1', type: 'Feature', path: '/',
        properties: { type: 'a-f-G', how: 'm-g', time, start: time, stale: time, callsign: 'Znacznik', archived: true, center: [17.05, 51.1], metadata: { taklab_route: plan } },
        geometry: { type: 'Point', coordinates: [17.03, 51.11, 0] },
    }, '?submit=true');
    assert.strictEqual(sent.length, 1);
    const text = xml(sent[0][0]);
    assert.doesNotMatch(text, /__taklab_route/);
    assert.doesNotMatch(text, /ANDROID-1/);
});

test('PUT submit bez archiwizacji też dopisuje plan i adresatów', async () => {
    sent.length = 0;
    await put(route('route-3'), '?submit=true&archive=false');
    assert.strictEqual(sent.length, 1);
    const text = xml(sent[0][0]);
    assert.match(text, /<__taklab_route /);
    assert.match(text, /<dest uid="ANDROID-1"\/>/);
});

test('DELETE submit trasy: t-x-d-d z link jako pierwszym dzieckiem detail', async () => {
    sent.length = 0;
    await flight.fetch('/api/profile/feature/route-1?submit=true', {
        method: 'DELETE', auth: { bearer: flight.token.admin },
    }, true);
    assert.strictEqual(sent.length, 1);
    const text = xml(sent[0][0]);
    assert.match(text, /type="t-x-d-d"/);
    assert.match(text, /<detail><link [^>]*\/>/);
    const link = text.match(/<detail><link ([^>]*)\/>/)![1];
    assert.match(link, /uid="route-1"/);
    assert.match(link, /relation="p-p"/);
    assert.match(link, /type="b-m-r"/);
    assert.match(text, /<__forcedelete\/>/);
    assert.match(text, /<marti><dest uid="ANDROID-1"\/><\/marti>/);
    // zdarzenie usuwające ma własny uid, nie uid trasy
    assert.doesNotMatch(text, /<event [^>]*uid="route-1"/);
});

test('DELETE bez submit: nic nie wysłane', async () => {
    sent.length = 0;
    await flight.fetch('/api/profile/feature/route-2', {
        method: 'DELETE', auth: { bearer: flight.token.admin },
    }, true);
    assert.strictEqual(sent.length, 0);
});

test('DELETE submit znacznika: nic nie wysłane', async () => {
    sent.length = 0;
    await flight.fetch('/api/profile/feature/marker-1?submit=true', {
        method: 'DELETE', auth: { bearer: flight.token.admin },
    }, true);
    assert.strictEqual(sent.length, 0);
});

test('DELETE submit nieistniejącej cechy: 404 jak dotąd i bez wysyłki', async () => {
    sent.length = 0;
    const res = await flight.fetch('/api/profile/feature/nie-ma?submit=true', {
        method: 'DELETE', auth: { bearer: flight.token.admin },
    }, false);
    assert.strictEqual(res.status, 404);
    assert.strictEqual(sent.length, 0);
});

test('sprzątanie', () => {
    deps.fetchEndpoints = original;
});

flight.landing();
