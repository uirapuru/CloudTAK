// Klient usługi planowania tras: atrapa planera przez http.createServer, bez Postgresa.
import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import Err from '@openaddresses/batch-error';
import TaklabRoute from '../stateless/lib/routing/taklab.js';
import type Config from '../common/config.js';

type Mode = 'ok' | 'error400' | 'html502' | 'hang';

let mode: Mode = 'ok';
let modesFail = false;
const requests: Array<{ method: string; url: string; body: unknown }> = [];

const FEATURES = {
    type: 'FeatureCollection',
    features: [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[17.03, 51.11, 120], [17.07, 51.09, 130]] },
        properties: { type: 'b-m-r', how: 'm-g', callsign: 'Trasa', archived: true, remarks: 'opis', metadata: { taklab_route: { waypoints: [[17.03, 51.11], [17.07, 51.09]] } } },
    }],
};

const MODES = { id: 'taklab', name: 'taklab', modes: [{ id: 'car', name: 'Samochód' }, { id: 'foot', name: 'Pieszo' }] };

const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
        let body: unknown;
        try {
            body = raw ? JSON.parse(raw) : null;
        } catch {
            body = raw;
        }
        requests.push({ method: String(req.method), url: String(req.url), body });

        const send = (status: number, type: string, text: string) => {
            res.statusCode = status;
            res.setHeader('Content-Type', type);
            res.end(text);
        };

        if (req.method === 'GET' && req.url === '/modes') {
            if (modesFail) return send(502, 'text/html', '<html>bramka</html>');
            return send(200, 'application/json', JSON.stringify(MODES));
        }
        if (mode === 'hang') return;
        if (mode === 'error400') return send(400, 'application/json', JSON.stringify({ message: 'Nieznany tryb trasy' }));
        if (mode === 'html502') return send(502, 'text/html', '<html>Bad gateway</html>');
        send(200, 'application/json', JSON.stringify(FEATURES));
    });
});

let base = '';
const planner = () => new TaklabRoute({} as Config, base + '/', { planner: 200, modes: 200 });

async function rejects(promise: Promise<unknown>, status: number, message: string): Promise<void> {
    await assert.rejects(promise, (err: unknown) => {
        assert.ok(err instanceof Err);
        assert.equal(err.status, status);
        assert.equal(err.safe, message);
        return true;
    });
}

test('Setup', async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test('route() wysyła POST /plan i zwraca cechy z planera po normalize_geojson', async () => {
    mode = 'ok';
    requests.length = 0;
    const threats = { observers: [[17.05, 51.1]] as Array<[number, number]> };
    const fc = await planner().route([[17.03, 51.11], [17.07, 51.09]], 'foot', { exposure: 'avoid' }, threats);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/plan');
    assert.deepStrictEqual(requests[0].body, { waypoints: [[17.03, 51.11], [17.07, 51.09]], travelMode: 'foot', options: { exposure: 'avoid' }, threats });

    assert.equal(fc.type, 'FeatureCollection');
    assert.equal(fc.features.length, 1);
    const f = fc.features[0];
    assert.equal(f.type, 'Feature');
    assert.match(String(f.id), /^[0-9a-f-]{36}$/);
    assert.deepStrictEqual(f.geometry, FEATURES.features[0].geometry);
    const p = f.properties as Record<string, unknown>;
    assert.equal(p.type, 'b-m-r');
    assert.equal(p.how, 'm-g');
    assert.equal(p.callsign, 'Trasa');
    assert.equal(p.archived, true);
    assert.equal(p.remarks, 'opis');
    assert.deepStrictEqual(p.metadata, FEATURES.features[0].properties.metadata);
    for (const key of ['time', 'start', 'stale', 'center']) assert.ok(key in p, `brak ${key}`);
});

test('route() bez trybu wysyła car, bez opcji i zagrożeń nie wysyła kluczy ani null', async () => {
    mode = 'ok';
    requests.length = 0;
    await planner().route([[17.03, 51.11], [17.07, 51.09]]);
    assert.deepStrictEqual(requests[0].body, { waypoints: [[17.03, 51.11], [17.07, 51.09]], travelMode: 'car' });
});

test('reroute() wysyła cały RerouteInput na POST /legs', async () => {
    mode = 'ok';
    requests.length = 0;
    const input = {
        travelMode: 'foot',
        waypoints: [[17.03, 51.11], [17.07, 51.09]] as Array<[number, number]>,
        coordinates: [[17.03, 51.11, 1], [17.07, 51.09, 2]],
        legs: [{ start: 0, end: 1, distance_m: 10, duration_s: 5 }],
        first: 0, count: 1, added: 0 as const,
    };
    const fc = await planner().reroute(input);
    assert.equal(requests[0].url, '/legs');
    assert.deepStrictEqual(requests[0].body, input);
    assert.equal(fc.features.length, 1);
});

test('variants() wysyła POST /variants', async () => {
    mode = 'ok';
    requests.length = 0;
    const input = { travelMode: 'car', waypoints: [[17.03, 51.11], [17.07, 51.09]] as Array<[number, number]>, coordinates: [[17.03, 51.11], [17.07, 51.09]], count: 2 };
    const fc = await planner().variants(input);
    assert.equal(requests[0].url, '/variants');
    assert.deepStrictEqual(requests[0].body, input);
    assert.equal(fc.features.length, 1);
});

test('config() czyta GET /modes, błąd /modes daje puste tryby', async () => {
    modesFail = false;
    requests.length = 0;
    assert.deepStrictEqual(await planner().config(), MODES);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].url, '/modes');

    modesFail = true;
    assert.deepStrictEqual(await planner().config(), { id: 'taklab', name: 'taklab', modes: [] });
    modesFail = false;

    const dead = new TaklabRoute({} as Config, 'http://127.0.0.1:1', { planner: 200, modes: 200 });
    assert.deepStrictEqual(await dead.config(), { id: 'taklab', name: 'taklab', modes: [] });
});

test('400 z message planera trafia do Err 400', async () => {
    mode = 'error400';
    await rejects(planner().route([[1, 1], [2, 2]], 'nope'), 400, 'Nieznany tryb trasy');
});

test('502 z HTML daje ogólny komunikat', async () => {
    mode = 'html502';
    await rejects(planner().route([[1, 1], [2, 2]], 'car'), 400, 'Nie udało się wyznaczyć trasy.');
});

test('planer, który nie odpowiada, daje komunikat o braku usługi', async () => {
    mode = 'hang';
    await rejects(planner().route([[1, 1], [2, 2]], 'car'), 400, 'Usługa planowania tras nie odpowiada.');
});

function stubConfig(overrides: Record<string, unknown>): Config {
    return { models: { Setting: { typedMany: async (defaults: Record<string, unknown>) => ({ ...defaults, ...overrides }) } } } as unknown as Config;
}

test('init(): wyłączone lub pusty adres daje null, komplet daje obiekt', async () => {
    assert.equal(await TaklabRoute.init(stubConfig({})), null);
    assert.equal(await TaklabRoute.init(stubConfig({ 'taklab::routing::enabled': false, 'taklab::routing::planner_url': 'http://x' })), null);
    assert.equal(await TaklabRoute.init(stubConfig({ 'taklab::routing::enabled': true, 'taklab::routing::planner_url': '' })), null);
    const route = await TaklabRoute.init(stubConfig({ 'taklab::routing::enabled': true, 'taklab::routing::planner_url': 'http://planner:8000/' }));
    assert.ok(route instanceof TaklabRoute);
    assert.equal(route.planner, 'http://planner:8000');
});

test('Teardown', async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
});

test('PATCH /api/config: ciało z trzema kluczami tras przechodzi walidację', async () => {
    const { Type } = await import('@sinclair/typebox');
    const { Value } = await import('@sinclair/typebox/value');
    const { FullConfig } = await import('../common/types.js');
    const body = {
        'taklab::routing::graphhopper_url': 'http://gh:8989',
        'taklab::routing::terrain_url': 'http://terrain:8000',
        'taklab::routing::planner_url': 'http://planner:8000',
    };
    assert.ok(Value.Check(Type.Partial(FullConfig), body));
});
