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

const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

// Atrapa usługi taklab-nav-planner: liczy prostą linię przez punkty zapytania
const planner = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET') {
            res.end(JSON.stringify({ id: 'taklab', name: 'taklab', modes: [{ id: 'car', name: 'Samochód' }] }));
            return;
        }
        const body = JSON.parse(raw);
        requests.push({ url: String(req.url), body });
        const coordinates = req.url === '/legs' ? body.coordinates : body.waypoints;
        res.end(JSON.stringify({ type: 'FeatureCollection', features: [{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates },
            properties: { type: 'b-m-r', how: 'm-g', callsign: 'Trasa', archived: true, remarks: '', metadata: { taklab_route: { waypoints: body.waypoints, legs: [] } } },
        }] }));
    });
});

async function setting(key: string, value: string): Promise<void> {
    await flight.config!.models.Setting.generate({ key, value }, { upsert: GenerateUpsert.UPDATE });
}

test('Setup: dostawca taklab z atrapą planera', async () => {
    await new Promise<void>(resolve => planner.listen(0, '127.0.0.1', resolve));
    await setting('taklab::routing::planner_url', `http://127.0.0.1:${(planner.address() as AddressInfo).port}`);
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
    assert.equal(requests[0].url, '/plan');
    assert.equal(requests[0].body.travelMode, 'car');
});

test('GET /api/search/route - via = punkty pośrednie przekazane planerowi', async () => {
    requests.length = 0;
    const res = await flight.fetch('/api/search/route?start=21,52&via=21.005,52.005&end=21.01,52.01&callsign=Test&travelMode=foot', {
        method: 'GET',
        auth: { bearer: flight.token.admin },
    }, true);

    assert.equal(res.status, 200);
    assert.deepEqual(requests[0].body.waypoints, [[21, 52], [21.005, 52.005], [21.01, 52.01]]);
    assert.equal(res.body.features[0].properties.metadata.taklab_route.waypoints.length, 3);
});

test('GET /api/search/route - zły via = 400', async () => {
    const res = await flight.fetch('/api/search/route?start=21,52&via=abc&end=21.01,52.01&callsign=Test', {
        method: 'GET',
        auth: { bearer: flight.token.admin },
    }, false);

    assert.equal(res.status, 400);
});

test('GET /api/search/route - opcje przełaju w zapytaniu: dobre przechodzą, zły limit nachylenia = 400', async () => {
    const ok = await flight.fetch('/api/search/route?start=21,52&end=21.01,52.01&callsign=Test&travelMode=foot&avoidWetland=true&avoidStreams=false&maxSlope=20&exposure=avoid', {
        method: 'GET',
        auth: { bearer: flight.token.admin },
    }, false);
    assert.equal(ok.status, 200);

    const bad = await flight.fetch('/api/search/route?start=21,52&end=21.01,52.01&callsign=Test&travelMode=foot&maxSlope=50', {
        method: 'GET',
        auth: { bearer: flight.token.admin },
    }, false);
    assert.equal(bad.status, 400);

    const badExposure = await flight.fetch('/api/search/route?start=21,52&end=21.01,52.01&callsign=Test&travelMode=foot&exposure=never', {
        method: 'GET',
        auth: { bearer: flight.token.admin },
    }, false);
    assert.equal(badExposure.status, 400);
});

test('POST /api/search/route/legs - przekazuje RerouteInput planerowi', async () => {
    requests.length = 0;
    const res = await flight.fetch('/api/search/route/legs', {
        method: 'POST',
        auth: { bearer: flight.token.admin },
        body: {
            travelMode: 'foot',
            waypoints: [[21, 52], [21.02, 52.02]],
            coordinates: [[21, 52], [21.02, 52.02]],
            legs: [{ start: 0, end: 1, distance_m: 1, duration_s: 1 }],
            first: 0,
            count: 1,
            added: 0,
        },
    }, true);

    assert.equal(res.status, 200);
    assert.equal(requests[0].url, '/legs');
    assert.deepEqual(requests[0].body.waypoints, [[21, 52], [21.02, 52.02]]);
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

test('POST /api/search/route/plan liczy trasę z body', async () => {
    const res = await flight.fetch('/api/search/route/plan', {
        method: 'POST', auth: { bearer: flight.token.admin },
        body: { travelMode: 'foot', callsign: 'Z body', waypoints: [[21, 52], [21.01, 52.01]], threats: { closed_areas: [[[21, 52], [21.001, 52], [21.001, 52.001], [21, 52]]] } },
    }, false);
    assert.equal(res.status, 200);
    assert.equal(res.body.features[0].properties.callsign, 'Z body');
});

test('POST /api/search/route/variants zwraca FeatureCollection', async () => {
    const res = await flight.fetch('/api/search/route/variants', {
        method: 'POST', auth: { bearer: flight.token.admin },
        body: { travelMode: 'foot', waypoints: [[21, 52], [21.01, 52.01]], coordinates: [[21, 52], [21.01, 52.01]], count: 1 },
    }, false);
    assert.equal(res.status, 200);
    assert.equal(res.body.type, 'FeatureCollection');
});

test('Teardown', async () => {
    await new Promise<void>(resolve => planner.close(() => resolve()));
});

flight.landing();
