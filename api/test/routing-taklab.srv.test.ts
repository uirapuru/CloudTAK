import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { GenerateUpsert } from '@openaddresses/batch-generic';
import Flight from './flight.js';

const flight = new Flight();

flight.init({ takserver: true });
flight.takeoff();
flight.user();

const profiles: unknown[] = [];
const points: unknown[] = [];

// Atrapa GraphHoppera
const graphhopper = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
        if (req.method === 'GET') {
            // GET /info: atrapa nie zna profili, więc tryb Szlaki jest ukryty
            res.statusCode = 404;
            res.end('{}');
            return;
        }
        profiles.push(JSON.parse(raw).profile);
        points.push(JSON.parse(raw).points);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ paths: [{
            distance: 1000,
            time: 60000,
            points: { type: 'LineString', coordinates: JSON.parse(raw).points },
        }] }));
    });
});

async function setting(key: string, value: string): Promise<void> {
    await flight.config!.models.Setting.generate({ key, value }, { upsert: GenerateUpsert.UPDATE });
}

test('Setup: dostawca taklab z atrapą GraphHoppera', async () => {
    await new Promise<void>(resolve => graphhopper.listen(0, '127.0.0.1', resolve));
    await setting('taklab::routing::graphhopper_url', `http://127.0.0.1:${(graphhopper.address() as AddressInfo).port}`);
    await setting('taklab::routing::enabled', 'true');
});

test('GET /api/search/route - bez travelMode dostawca taklab jedzie samochodem', async () => {
    const res = await flight.fetch('/api/search/route?start=21,52&end=21.01,52.01&callsign=Test', {
        method: 'GET',
        auth: { bearer: flight.token.admin },
    }, true);

    assert.equal(res.status, 200);
    assert.equal(res.body.features.length, 1);
    assert.equal(res.body.features[0].properties.type, 'b-m-r');
    assert.equal(res.body.features[0].properties.callsign, 'Test');
    assert.equal(profiles[0], 'car');
});

test('GET /api/search/route - pusty travelMode też daje samochód', async () => {
    const res = await flight.fetch('/api/search/route?start=21,52&end=21.01,52.01&callsign=Test&travelMode=', {
        method: 'GET',
        auth: { bearer: flight.token.admin },
    }, true);

    assert.equal(res.status, 200);
    assert.equal(res.body.features.length, 1);
});

test('GET /api/search/route - via = punkty pośrednie, odcinek na zapytanie', async () => {
    points.length = 0;
    const res = await flight.fetch('/api/search/route?start=21,52&via=21.005,52.005&end=21.01,52.01&callsign=Test&travelMode=foot', {
        method: 'GET',
        auth: { bearer: flight.token.admin },
    }, true);

    assert.equal(res.status, 200);
    assert.deepEqual(points, [[[21, 52], [21.005, 52.005]], [[21.005, 52.005], [21.01, 52.01]]]);
    const plan = res.body.features[0].properties.metadata.taklab_route;
    assert.equal(plan.waypoints.length, 3);
    assert.equal(plan.legs.length, 2);
});

test('GET /api/search/route - zły via = 400', async () => {
    const res = await flight.fetch('/api/search/route?start=21,52&via=abc&end=21.01,52.01&callsign=Test', {
        method: 'GET',
        auth: { bearer: flight.token.admin },
    }, false);

    assert.equal(res.status, 400);
});

test('POST /api/search/route/legs - przesunięcie celu przelicza jeden odcinek', async () => {
    const created = await flight.fetch('/api/search/route?start=21,52&via=21.005,52.005&end=21.01,52.01&callsign=Test&travelMode=foot', {
        method: 'GET',
        auth: { bearer: flight.token.admin },
    }, true);
    const feature = created.body.features[0];
    const plan = feature.properties.metadata.taklab_route;

    points.length = 0;
    const res = await flight.fetch('/api/search/route/legs', {
        method: 'POST',
        auth: { bearer: flight.token.admin },
        body: {
            travelMode: 'foot',
            waypoints: [[21, 52], [21.005, 52.005], [21.02, 52.02]],
            coordinates: feature.geometry.coordinates,
            legs: plan.legs,
            first: 1,
            count: 1,
            added: 0,
        },
    }, true);

    assert.equal(res.status, 200);
    assert.deepEqual(points, [[[21.005, 52.005], [21.02, 52.02]]]);
    assert.deepEqual(res.body.features[0].geometry.coordinates.at(-1).slice(0, 2), [21.02, 52.02]);
});

test('POST /api/search/route/legs - dostawca bez przeliczania odcinków = 400', async () => {
    const res = await flight.fetch('/api/search/route/legs', {
        method: 'POST',
        auth: { bearer: flight.token.admin },
        body: {
            provider: 'nieznany',
            travelMode: 'foot',
            waypoints: [[21, 52], [21.01, 52.01]],
            coordinates: [[21, 52], [21.01, 52.01]],
            legs: [{ start: 0, end: 1, distance_m: 1, duration_s: 1 }],
            first: 0,
            count: 1,
            added: 0,
        },
    }, false);

    assert.equal(res.status, 400);
});

test('Teardown', async () => {
    await new Promise<void>(resolve => graphhopper.close(() => resolve()));
});

flight.landing();
