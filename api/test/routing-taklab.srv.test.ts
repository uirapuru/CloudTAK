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

// Atrapa GraphHoppera
const graphhopper = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
        profiles.push(JSON.parse(raw).profile);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ paths: [{
            distance: 1000,
            time: 60000,
            points: { type: 'LineString', coordinates: [[21, 52], [21.01, 52.01]] },
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

test('Teardown', async () => {
    await new Promise<void>(resolve => graphhopper.close(() => resolve()));
});

flight.landing();
