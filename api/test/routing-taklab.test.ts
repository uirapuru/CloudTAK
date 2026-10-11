import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { GenerateUpsert } from '@openaddresses/batch-generic';
import TaklabRoute, { simplifyLine } from '../stateless/lib/routing/taklab.js';
import { RouteManager } from '../stateless/lib/interface-route.js';
import Config from '../common/config.js';
import { testDatabase } from './db.js';

let config: Config;
let base = '';
const ghBodies: Array<Record<string, unknown>> = [];

// Jeden serwer udaje oba silniki: GraphHopper pod /route, przełaj pod /terrain/route
const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
        const send = (status: number, body: string) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json');
            res.end(body);
        };

        let body: { points: number[][]; start: number[] } = { points: [], start: [] };
        try {
            body = JSON.parse(raw);
        } catch {
            // ciało nie jest JSON-em
        }

        if (req.method === 'POST' && req.url === '/route') {
            ghBodies.push(body as unknown as Record<string, unknown>);
            if (body.points[0][0] === 0) return send(400, JSON.stringify({ message: 'Cannot find point 0: 0.0,0.0' }));
            if (body.points[0][0] === 1) return send(400, JSON.stringify({ hints: [] }));
            if (body.points[0][0] === 3) {
                // gęsta geometria: zygzak z 5000 punktów
                const coordinates = Array.from({ length: 5000 }, (_, i) => [21 + i * 0.0001, 52 + (i % 2) * 0.0003]);
                return send(200, JSON.stringify({ paths: [{ distance: 1, time: 1000, points: { type: 'LineString', coordinates } }] }));
            }
            return send(200, JSON.stringify({ paths: [{
                distance: 12345,
                time: 1080000,
                ascend: 120,
                descend: 80,
                points: { type: 'LineString', coordinates: [[21.0, 52.2, 100], [21.1, 52.3, 110]] },
                instructions: [
                    { text: 'Kieruj się na północ', distance: 12000, time: 1000000 },
                    { text: 'Cel', distance: 0, time: 0 },
                ],
            }] }));
        }

        if (req.method === 'POST' && req.url === '/terrain/route') {
            if (body.start[0] === 0) {
                return send(422, JSON.stringify({ detail: { code: 'no_path', message: 'Brak przejścia między punktami.' } }));
            }
            if (body.start[0] === 1) {
                // walidacja FastAPI: detail jest tablicą
                return send(422, JSON.stringify({ detail: [{ loc: ['body', 'start'], msg: 'field required', type: 'missing' }] }));
            }
            if (body.start[0] === 2) return send(502, '<html>Bad Gateway</html>');
            return send(200, JSON.stringify({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[20.5, 52.3], [20.52, 52.31]] },
                properties: { distance_m: 2300, duration_s: 2700, ascent_m: 15, descent_m: 3, offpath_ratio: 0.63 },
            }));
        }

        send(404, '{}');
    });
});

function status(code: number) {
    return (err: { status: number }) => err.status === code;
}

test('Taklab routing - setup', async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    config = await Config.env({
        postgres: await testDatabase({ reset: false }),
        silent: true,
        noevents: true,
        noetlevents: true,
        nocache: true,
    });
});

test('config: pięć trybów z terenem, cztery bez', async () => {
    const withTerrain = new TaklabRoute(config, base, base + '/terrain');
    assert.deepEqual((await withTerrain.config()).modes.map(m => m.id),
        ['car', 'car_no_motorway', 'offroad', 'foot', 'foot_cross_country']);
    const without = new TaklabRoute(config, base, '');
    assert.equal((await without.config()).modes.length, 4);
});

test('car_no_motorway wysyła model bez autostrad', async () => {
    ghBodies.length = 0;
    await new TaklabRoute(config, base, '').route([[21, 52.2], [21.1, 52.3]], 'car_no_motorway');
    assert.equal(ghBodies[0].profile, 'car');
    assert.deepEqual(ghBodies[0].custom_model, { priority: [{ if: 'road_class == MOTORWAY', multiply_by: '0' }] });
    assert.equal(ghBodies[0].locale, 'pl');
    assert.equal(ghBodies[0].points_encoded, false);
    assert.equal(ghBodies[0].way_point_max_distance, 20);
});

test('car nie wysyła custom_model', async () => {
    ghBodies.length = 0;
    await new TaklabRoute(config, base, '').route([[21, 52.2], [21.1, 52.3]], 'car');
    assert.equal(ghBodies[0].custom_model, undefined);
});

test('trasa drogowa = b-m-r 2D z opisem po polsku', async () => {
    const fc = await new TaklabRoute(config, base, '').route([[21, 52.2], [21.1, 52.3]], 'offroad');
    const f = fc.features[0];
    assert.equal(f.properties.type, 'b-m-r');
    assert.deepEqual(f.geometry.coordinates, [[21.0, 52.2], [21.1, 52.3]]);
    assert.match(String(f.properties.remarks), /Tryb: Drogi gruntowe/);
    assert.match(String(f.properties.remarks), /Długość: 12,3 km/);
    assert.match(String(f.properties.remarks), /Czas: 18 min/);
    assert.match(String(f.properties.remarks), /1\. Kieruj się na północ/);
});

test('domyślny tryb to car', async () => {
    ghBodies.length = 0;
    await new TaklabRoute(config, base, '').route([[21, 52.2], [21.1, 52.3]]);
    assert.equal(ghBodies[0].profile, 'car');
});

test('tryb domyślny schematu zapytania (Driving Time), pusty i brak to car', async () => {
    const route = new TaklabRoute(config, base, '');
    for (const mode of ['Driving Time', '', undefined]) {
        ghBodies.length = 0;
        await route.route([[21, 52.2], [21.1, 52.3]], mode);
        assert.equal(ghBodies[0].profile, 'car', `tryb ${JSON.stringify(mode)}`);
    }
});

test('trasa drogowa ma najwyżej 1000 punktów, z końcami', async () => {
    const fc = await new TaklabRoute(config, base, '').route([[3, 52.2], [21.1, 52.3]], 'car');
    const coordinates = fc.features[0].geometry.coordinates as number[][];
    assert.ok(coordinates.length <= 1000);
    assert.deepEqual(coordinates[0], [21, 52]);
    assert.deepEqual(coordinates[coordinates.length - 1], [21 + 4999 * 0.0001, 52 + 0.0003]);
});

test('simplifyLine: prosta linia zwija się do dwóch punktów', () => {
    const line = Array.from({ length: 2000 }, (_, i) => [21 + i * 0.001, 52 + i * 0.0005]);
    assert.deepEqual(simplifyLine(line), [line[0], line[1999]]);
});

test('simplifyLine: zygzak z 5000 punktów schodzi do 1000, końce zostają', () => {
    const zigzag = Array.from({ length: 5000 }, (_, i) => [21 + i * 0.0001, 52 + (i % 2) * 0.0003]);
    const out = simplifyLine(zigzag);
    assert.ok(out.length <= 1000);
    assert.deepEqual(out[0], zigzag[0]);
    assert.deepEqual(out[out.length - 1], zigzag[4999]);
});

test('simplifyLine: łuk z 5000 punktów schodzi do 1000 i dalej go przypomina', () => {
    const arc = Array.from({ length: 5000 }, (_, i) => [21 + Math.sin(i / 800) * 0.5, 52 + Math.cos(i / 800) * 0.5]);
    const out = simplifyLine(arc);
    assert.ok(out.length <= 1000 && out.length > 10);
    assert.deepEqual(out[0], arc[0]);
    assert.deepEqual(out[out.length - 1], arc[4999]);
});

test('simplifyLine: krótka linia bez zmian', () => {
    const line = [[0, 0], [1, 1], [2, 0]];
    assert.equal(simplifyLine(line), line);
});

test('zawieszona usługa = 400 po limicie czasu (GraphHopper i przełaj)', async () => {
    const hanging = http.createServer(() => undefined);
    await new Promise<void>(resolve => hanging.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(hanging.address() as AddressInfo).port}`;
    try {
        const route = new TaklabRoute(config, url, url, { graphhopper: 150, terrain: 150 });
        await assert.rejects(route.route([[21, 52], [21.1, 52.1]], 'car'),
            (err: { status: number; safe: string }) => err.status === 400 && err.safe === 'Usługa tras drogowych nie odpowiada.');
        await assert.rejects(route.route([[21, 52], [21.1, 52.1]], 'foot_cross_country'),
            (err: { status: number; safe: string }) => err.status === 400 && err.safe === 'Usługa tras na przełaj nie odpowiada.');
    } finally {
        hanging.closeAllConnections();
        await new Promise<void>(resolve => hanging.close(() => resolve()));
    }
});

test('błąd GraphHoppera = 400 po polsku', async () => {
    await assert.rejects(
        new TaklabRoute(config, base, '').route([[0, 0], [21, 52]], 'car'),
        (err: { status: number; message: string }) => err.status === 400 && /poza siecią dróg/.test(err.message),
    );
});

test('błąd GraphHoppera bez pola message = 400 z ogólnym tekstem', async () => {
    await assert.rejects(
        new TaklabRoute(config, base, '').route([[1, 1], [21, 52]], 'car'),
        (err: { status: number; message: string }) => err.status === 400 && err.message === 'Nie udało się wyznaczyć trasy.',
    );
});

test('przełaj idzie do usługi terenu', async () => {
    const fc = await new TaklabRoute(config, base, base + '/terrain').route([[20.5, 52.3], [20.52, 52.31]], 'foot_cross_country');
    assert.match(String(fc.features[0].properties.remarks), /Poza drogami: 63%/);
    assert.match(String(fc.features[0].properties.remarks), /Czas marszu: 45 min/);
});

test('błąd przełaju = 400 z komunikatem usługi', async () => {
    await assert.rejects(
        new TaklabRoute(config, base, base + '/terrain').route([[0, 0], [1, 1]], 'foot_cross_country'),
        (err: { status: number; message: string }) => err.status === 400 && err.message === 'Brak przejścia między punktami.',
    );
});

test('walidacja FastAPI (detail jako tablica) = 400 z ogólnym tekstem', async () => {
    await assert.rejects(
        new TaklabRoute(config, base, base + '/terrain').route([[1, 1], [2, 2]], 'foot_cross_country'),
        (err: { status: number; message: string }) => err.status === 400 && err.message === 'Nie udało się wyznaczyć trasy na przełaj.',
    );
});

test('odpowiedź usługi terenu nie jest JSON-em = 400, nie 500', async () => {
    await assert.rejects(
        new TaklabRoute(config, base, base + '/terrain').route([[2, 2], [3, 3]], 'foot_cross_country'),
        (err: { status: number; message: string }) => err.status === 400 && err.message === 'Nie udało się wyznaczyć trasy na przełaj.',
    );
});

test('usługa terenu nie odpowiada = 400, nie 500', async () => {
    await assert.rejects(
        new TaklabRoute(config, base, 'http://127.0.0.1:9').route([[20.5, 52.3], [20.52, 52.31]], 'foot_cross_country'),
        status(400),
    );
});

test('nieznany tryb = 400', async () => {
    await assert.rejects(new TaklabRoute(config, base, '').route([[21, 52], [21.1, 52.1]], 'boat'), status(400));
});

test('init: wyłączony albo bez adresu GraphHoppera = null', async () => {
    const set = (key: string, value: string) =>
        config.models.Setting.generate({ key, value }, { upsert: GenerateUpsert.UPDATE });

    await set('taklab::routing::enabled', 'false');
    assert.equal(await TaklabRoute.init(config), null);

    await set('taklab::routing::enabled', 'true');
    await set('taklab::routing::graphhopper_url', '');
    assert.equal(await TaklabRoute.init(config), null);

    await set('taklab::routing::graphhopper_url', 'http://gh.example.com/');
    await set('taklab::routing::terrain_url', 'http://terrain.example.com');
    const route = await TaklabRoute.init(config);
    assert.ok(route);
    assert.equal(route._id, 'taklab');
    assert.equal(route.graphhopper, 'http://gh.example.com');

    const manager = await RouteManager.init(config);
    assert.equal(manager.defaultProvider, 'taklab');

    await set('taklab::routing::enabled', 'false');
});

test('Taklab routing - teardown', async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await config.pg.end();
});
