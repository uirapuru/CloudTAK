import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { GenerateUpsert } from '@openaddresses/batch-generic';
import TaklabRoute, { simplifyLine, joinLegs, composeRemarks, composeAnalysis, validPlan, MAX_ROUTE_POINTS } from '../stateless/lib/routing/taklab.js';
import type { RouteAnalysis } from '../stateless/lib/routing/taklab.js';
import type { RoutePlan } from '../stateless/lib/routing/taklab.js';
import { RouteManager } from '../stateless/lib/interface-route.js';
import Config from '../common/config.js';
import { testDatabase } from './db.js';

let config: Config;
let base = '';
const ghBodies: Array<Record<string, unknown>> = [];
// Profile zwracane przez GET /info; null = 404
let infoProfiles: string[] | null = null;
let infoCalls = 0;
// Przełaj: kiedy przyszło zapytanie i kiedy poszła odpowiedź
const terrainLog: Array<{ start: number[]; received: number; sent: number }> = [];
// Przełaj: ciała zapytań (opcje trasy)
const terrainBodies: Array<Record<string, unknown>> = [];

// Analiza terenu zwracana przez atrapę /terrain/analyze
const ANALYSIS: RouteAnalysis = {
    length_m: 9179,
    elevation_min_m: 320,
    elevation_max_m: 503,
    ascent_m: 210,
    descent_m: 180,
    land: { path: 0.52, open: 0.11, forest: 0.28, scrub: 0.008, built_up: 0.01, wetland: 0, stream: 0.07, water: 0 },
    cover: { concealed: 0.284, exposed: 0.125, unknown: 0.52 },
    slope: { max_deg: 27, buckets: { '0-5': 0.716, '5-15': 0.162, '15-25': 0.11, '25+': 0.012 } },
    obstacles: [
        { kind: 'steep', from_m: 267, to_m: 351 },
        { kind: 'stream', from_m: 815, to_m: 839 },
        { kind: 'wetland', from_m: 3000, to_m: 3200 },
        { kind: 'water_near', from_m: 5431, to_m: 5966 },
    ],
    danger: [
        { kind: 'built_up', from_m: 486, to_m: 1573 },
        { kind: 'road_crossing', from_m: 1435, to_m: 1521 },
        { kind: 'open', from_m: 2100, to_m: 2600 },
        { kind: 'open', from_m: 4000, to_m: 4250 },
        { kind: 'skyline', from_m: 7100, to_m: 7400 },
    ],
    key_terrain: [
        { kind: 'crossing', from_m: 5103, to_m: 5163 },
        { kind: 'height', lon: 16.66483, lat: 50.35886, elevation_m: 517, above_route_m: 89, nearest_m: 9179, distance_m: 1434, bearing_deg: 308, visible_ratio: 0.35, visible: [{ from_m: 6100, to_m: 6800 }, { from_m: 8000, to_m: 9179 }] },
        { kind: 'height', lon: 16.59, lat: 50.29, elevation_m: 601, above_route_m: 99, nearest_m: 0, distance_m: 400, bearing_deg: 195, visible_ratio: 0, visible: [] },
    ],
};
let analyzeBodies: Array<{ coordinates: number[][] }> = [];

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

        if (req.method === 'GET' && req.url === '/info') {
            infoCalls++;
            if (!infoProfiles) return send(404, '{}');
            return send(200, JSON.stringify({ profiles: infoProfiles.map(name => ({ name })) }));
        }

        if (req.method === 'POST' && req.url === '/route') {
            ghBodies.push(body as unknown as Record<string, unknown>);
            if (body.points[0][0] === 0) return send(400, JSON.stringify({ message: 'Cannot find point 0: 0.0,0.0' }));
            if (body.points[0][0] === 1) return send(400, JSON.stringify({ hints: [] }));
            if (body.points[0][0] === 7) return send(400, JSON.stringify({ message: 'Cannot find point 0: 7.0,52.0' }));
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
                // linia od pierwszego do drugiego punktu zapytania: widać granice odcinków
                points: { type: 'LineString', coordinates: [[...body.points[0], 100], [...body.points[1], 110]] },
                instructions: [
                    { text: 'Kieruj się na północ', distance: 12000, time: 1000000 },
                    { text: 'Cel', distance: 0, time: 0 },
                ],
            }] }));
        }

        if (req.method === 'POST' && req.url === '/terrain/analyze') {
            const analyzeBody = body as unknown as { coordinates: number[][] };
            analyzeBodies.push(analyzeBody);
            if (analyzeBody.coordinates[0][0] === 4) return send(502, '<html>Bad Gateway</html>');
            return send(200, JSON.stringify(ANALYSIS));
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
            terrainBodies.push(body as unknown as Record<string, unknown>);
            const entry = { start: body.start, received: Date.now(), sent: 0 };
            terrainLog.push(entry);
            const end = (body as unknown as { end: number[] }).end;
            setTimeout(() => {
                entry.sent = Date.now();
                send(200, JSON.stringify({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: [body.start, end] },
                    properties: { distance_m: 2300, duration_s: 2700, ascent_m: 15, descent_m: 3, offpath_ratio: 0.63 },
                }));
            }, 30);
            return;
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

test('hike: tryb Szlaki tylko gdy GraphHopper ma profil hike', async () => {
    infoProfiles = ['foot', 'car', 'offroad', 'hike'];
    const route = new TaklabRoute(config, base, base + '/terrain');
    assert.deepEqual((await route.config()).modes.map(m => m.id),
        ['car', 'car_no_motorway', 'offroad', 'foot', 'hike', 'foot_cross_country']);
    assert.equal((await route.config()).modes.find(m => m.id === 'hike')?.name, 'Szlaki');

    ghBodies.length = 0;
    await route.route([[21, 52.2], [21.1, 52.3]], 'hike');
    assert.equal(ghBodies[0].profile, 'hike');
    assert.equal(ghBodies[0].custom_model, undefined);
    infoProfiles = null;
});

test('hike: wynik /info pamiętany 60 s', async () => {
    infoProfiles = ['foot', 'hike'];
    infoCalls = 0;
    const route = new TaklabRoute(config, base, '');
    await route.config();
    await route.config();
    await route.route([[21, 52.2], [21.1, 52.3]], 'foot');
    assert.equal(infoCalls, 1);
    infoProfiles = null;
});

test('hike: bez profilu albo przy błędzie /info tryb ukryty i odrzucany', async () => {
    infoProfiles = ['foot', 'car'];
    const route = new TaklabRoute(config, base, '');
    assert.ok(!(await route.config()).modes.some(m => m.id === 'hike'));
    infoProfiles = null;
    const broken = new TaklabRoute(config, 'http://127.0.0.1:9', '');
    assert.ok(!(await broken.config()).modes.some(m => m.id === 'hike'));
    await assert.rejects(new TaklabRoute(config, base, '').route([[21, 52.2], [21.1, 52.3]], 'hike'), status(400));
});

test('trzy punkty = dwa zapytania po dwa punkty i plan z dwoma odcinkami', async () => {
    ghBodies.length = 0;
    const stops: Array<[number, number]> = [[21, 52], [21.1, 52.1], [21.2, 52.2]];
    const fc = await new TaklabRoute(config, base, '').route(stops, 'foot');
    assert.equal(ghBodies.length, 2);
    assert.deepEqual(ghBodies.map(b => b.points), [[[21, 52], [21.1, 52.1]], [[21.1, 52.1], [21.2, 52.2]]]);

    const f = fc.features[0];
    assert.deepEqual(f.geometry.coordinates, [[21, 52], [21.1, 52.1], [21.2, 52.2]]);
    const plan = (f.properties.metadata as { taklab_route: RoutePlan }).taklab_route;
    assert.equal(plan.version, 1);
    assert.equal(plan.mode, 'foot');
    assert.equal(plan.mode_name, 'Pieszo');
    assert.deepEqual(plan.waypoints, stops);
    assert.deepEqual(plan.legs.map(l => [l.start, l.end]), [[0, 1], [1, 2]]);
    assert.equal(plan.legs[0].distance_m, 12345);
    assert.ok(validPlan(plan, 3));
    assert.match(String(f.properties.remarks), /Długość: 24,7 km/);
    assert.match(String(f.properties.remarks), /Odcinek 1: 12,3 km, 18 min/);
    assert.match(String(f.properties.remarks), /Odcinek 2: 12,3 km, 18 min/);
});

test('przełaj przez trzy punkty liczy odcinki po kolei', async () => {
    terrainLog.length = 0;
    const fc = await new TaklabRoute(config, base, base + '/terrain')
        .route([[20.5, 52.3], [20.51, 52.3], [20.52, 52.31]], 'foot_cross_country');
    assert.equal(terrainLog.length, 2);
    assert.ok(terrainLog[1].received >= terrainLog[0].sent, 'drugi odcinek dopiero po pierwszym');
    const plan = (fc.features[0].properties.metadata as { taklab_route: RoutePlan }).taklab_route;
    assert.equal(plan.legs.length, 2);
    assert.equal(plan.legs[0].offpath_ratio, 0.63);
    assert.match(String(fc.features[0].properties.remarks), /Czas marszu: 1 h 30 min/);
    assert.match(String(fc.features[0].properties.remarks), /Poza drogami: 63%/);
});

test('błąd drugiego odcinka podaje jego numer', async () => {
    await assert.rejects(
        new TaklabRoute(config, base, '').route([[21, 52], [7, 52], [21.2, 52.2]], 'car'),
        (err: { status: number; message: string }) => err.status === 400 && /^Odcinek 2: Punkt poza siecią dróg/.test(err.message),
    );
});

test('joinLegs: dwa gęste odcinki mieszczą się w limicie, granice zostają', () => {
    const zigzag = (x0: number) => Array.from({ length: 5000 }, (_, i) => [x0 + i * 0.0001, 52 + (i % 2) * 0.0003]);
    const a = zigzag(21);
    const b = zigzag(21 + 4999 * 0.0001);
    b[0] = a[4999]; // drugi odcinek zaczyna się tam, gdzie kończy pierwszy
    const joined = joinLegs([
        { coordinates: a, leg: { distance_m: 1, duration_s: 1 } },
        { coordinates: b, leg: { distance_m: 1, duration_s: 1 } },
    ]);
    assert.ok(joined.coordinates.length <= MAX_ROUTE_POINTS);
    assert.deepEqual(joined.coordinates[joined.legs[0].end], a[4999]);
    assert.equal(joined.legs[1].start, joined.legs[0].end, 'wspólny wierzchołek graniczny');
    assert.deepEqual(joined.coordinates[joined.legs[1].end], b[4999]);
    assert.ok(validPlan({ version: 1, mode: 'x', mode_name: 'x', waypoints: [[0, 0], [1, 1], [2, 2]], legs: joined.legs }, joined.coordinates.length));
});

test('joinLegs: odcinek z jednym punktem (dwa punkty usera w tym samym miejscu)', () => {
    const joined = joinLegs([
        { coordinates: [[21, 52], [21.1, 52.1]], leg: { distance_m: 1, duration_s: 1 } },
        { coordinates: [[21.1, 52.1]], leg: { distance_m: 0, duration_s: 0 } },
        { coordinates: [[21.1, 52.1], [21.2, 52.2]], leg: { distance_m: 1, duration_s: 1 } },
    ]);
    assert.deepEqual(joined.coordinates, [[21, 52], [21.1, 52.1], [21.2, 52.2]]);
    assert.deepEqual(joined.legs.map(l => [l.start, l.end]), [[0, 1], [1, 1], [1, 2]]);
});

test('joinLegs: odcinki bez wspólnego punktu leżą obok siebie', () => {
    const joined = joinLegs([
        { coordinates: [[21, 52], [21.1, 52.1]], leg: { distance_m: 1, duration_s: 1 } },
        { coordinates: [[21.11, 52.1], [21.2, 52.2]], leg: { distance_m: 1, duration_s: 1 } },
    ]);
    assert.deepEqual(joined.legs.map(l => [l.start, l.end]), [[0, 1], [2, 3]]);
});

test('validPlan odrzuca plany niezgodne z linią', () => {
    // zwykła funkcja logiczna: strażnik typu zawężałby `good` do never po pierwszym false
    const check = (plan: unknown, count: number): boolean => validPlan(plan, count);
    const good: RoutePlan = { version: 1, mode: 'foot', mode_name: 'Pieszo', waypoints: [[0, 0], [1, 1]], legs: [{ start: 0, end: 4, distance_m: 1, duration_s: 1 }] };
    assert.ok(check(good, 5));
    assert.ok(!check(good, 6), 'ostatni odcinek nie kończy się na ostatnim wierzchołku');
    assert.ok(!check({ ...good, version: 2 }, 5));
    assert.ok(!check({ ...good, waypoints: [[0, 0]] }, 5));
    assert.ok(!check({ ...good, legs: [{ ...good.legs[0], start: 1 }] }, 5));
    assert.ok(!check({ ...good, waypoints: [[0, 0], [1, 1], [2, 2]] }, 5), 'odcinków o jeden mniej niż punktów');
    assert.ok(!check(null, 5));
    assert.ok(!check({ ...good, legs: [{ start: 0, end: 2, distance_m: 1, duration_s: 1 }, { start: 1, end: 4, distance_m: 1, duration_s: 1 }], waypoints: [[0, 0], [1, 1], [2, 2]] }, 5), 'odcinki nachodzą');
});

test('composeRemarks: jeden odcinek ma dzisiejszy układ', () => {
    const text = composeRemarks({ version: 1, mode: 'car', mode_name: 'Samochód', waypoints: [[0, 0], [1, 1]], legs: [
        { start: 0, end: 1, distance_m: 12345, duration_s: 1080, ascent_m: 120, descent_m: 80, steps: ['1. Kieruj się na północ (12,0 km)'] },
    ] });
    assert.equal(text, 'Tryb: Samochód\nDługość: 12,3 km\nCzas: 18 min\nPodejścia: 120 m, zejścia: 80 m\n\n1. Kieruj się na północ (12,0 km)');
});

test('reroute: przesunięcie celu przelicza tylko ostatni odcinek', async () => {
    const route = new TaklabRoute(config, base, '');
    const before = (await route.route([[21, 52], [21.1, 52.1], [21.2, 52.2]], 'foot')).features[0];
    const plan = (before.properties.metadata as { taklab_route: RoutePlan }).taklab_route;
    ghBodies.length = 0;
    const after = (await route.reroute({
        travelMode: 'foot',
        waypoints: [[21, 52], [21.1, 52.1], [21.3, 52.3]],
        coordinates: before.geometry.coordinates as number[][],
        legs: plan.legs,
        first: 1, count: 1, added: 0,
    })).features[0];
    assert.deepEqual(ghBodies.map(b => b.points), [[[21.1, 52.1], [21.3, 52.3]]]);
    assert.deepEqual(after.geometry.coordinates, [[21, 52], [21.1, 52.1], [21.3, 52.3]]);
    const newPlan = (after.properties.metadata as { taklab_route: RoutePlan }).taklab_route;
    assert.deepEqual(newPlan.waypoints[2], [21.3, 52.3]);
    assert.equal(newPlan.legs.length, 2);
});

test('reroute: wstawienie punktu dzieli odcinek na dwa', async () => {
    const route = new TaklabRoute(config, base, '');
    const before = (await route.route([[21, 52], [21.2, 52.2]], 'foot')).features[0];
    const plan = (before.properties.metadata as { taklab_route: RoutePlan }).taklab_route;
    ghBodies.length = 0;
    const after = (await route.reroute({
        travelMode: 'foot', waypoints: [[21, 52], [21.1, 52.15], [21.2, 52.2]],
        coordinates: before.geometry.coordinates as number[][], legs: plan.legs, first: 0, count: 1, added: 1,
    })).features[0];
    assert.equal(ghBodies.length, 2);
    const newPlan = (after.properties.metadata as { taklab_route: RoutePlan }).taklab_route;
    assert.equal(newPlan.legs.length, 2);
    assert.deepEqual(after.geometry.coordinates, [[21, 52], [21.1, 52.15], [21.2, 52.2]]);
});

test('reroute: usunięcie punktu pośredniego łączy odcinki, usunięcie startu zdejmuje odcinek bez zapytań', async () => {
    const route = new TaklabRoute(config, base, '');
    const before = (await route.route([[21, 52], [21.1, 52.1], [21.2, 52.2]], 'foot')).features[0];
    const plan = (before.properties.metadata as { taklab_route: RoutePlan }).taklab_route;
    const coordinates = before.geometry.coordinates as number[][];

    ghBodies.length = 0;
    const merged = (await route.reroute({
        travelMode: 'foot', waypoints: [[21, 52], [21.2, 52.2]], coordinates, legs: plan.legs, first: 0, count: 2, added: -1,
    })).features[0];
    assert.deepEqual(ghBodies.map(b => b.points), [[[21, 52], [21.2, 52.2]]]);
    assert.equal((merged.properties.metadata as { taklab_route: RoutePlan }).taklab_route.legs.length, 1);

    ghBodies.length = 0;
    const trimmed = (await route.reroute({
        travelMode: 'foot', waypoints: [[21.1, 52.1], [21.2, 52.2]], coordinates, legs: plan.legs, first: 0, count: 1, added: -1,
    })).features[0];
    assert.equal(ghBodies.length, 0);
    assert.deepEqual(trimmed.geometry.coordinates, [[21.1, 52.1], [21.2, 52.2]]);
    assert.deepEqual((trimmed.properties.metadata as { taklab_route: RoutePlan }).taklab_route.legs.map(l => [l.start, l.end]), [[0, 1]]);
});

test('reroute: plan niezgodny z linią albo zła liczba punktów = 400', async () => {
    const route = new TaklabRoute(config, base, '');
    const legs = [{ start: 0, end: 1, distance_m: 1, duration_s: 1 }];
    await assert.rejects(route.reroute({ travelMode: 'foot', waypoints: [[21, 52], [21.1, 52.1]], coordinates: [[21, 52], [21.05, 52], [21.1, 52.1]], legs, first: 0, count: 1, added: 0 }), status(400));
    await assert.rejects(route.reroute({ travelMode: 'foot', waypoints: [[21, 52]], coordinates: [[21, 52], [21.1, 52.1]], legs, first: 0, count: 1, added: 0 }), status(400));
    await assert.rejects(route.reroute({ travelMode: 'foot', waypoints: [[21, 52], [21.1, 52.1]], coordinates: [[21, 52], [21.1, 52.1]], legs, first: 1, count: 1, added: 0 }), status(400));
});

test('opcje przełaju idą do usługi terenu, do planu i do opisu', async () => {
    terrainBodies.length = 0;
    const options = { avoid_wetland: true, avoid_streams: true, max_slope_deg: 20 };
    const fc = await new TaklabRoute(config, base, base + '/terrain').route([[20.5, 52.3], [20.52, 52.31]], 'foot_cross_country', options);
    assert.equal(terrainBodies.length, 1);
    assert.equal(terrainBodies[0].avoid_wetland, true);
    assert.equal(terrainBodies[0].avoid_streams, true);
    assert.equal(terrainBodies[0].max_slope_deg, 20);
    const plan = (fc.features[0].properties.metadata as { taklab_route: RoutePlan }).taklab_route;
    assert.deepEqual(plan.options, options);
    assert.match(String(fc.features[0].properties.remarks), /Opcje: omija bagna, omija strumienie i rowy, nachylenie do 20°/);
});

test('przełaj bez opcji nie wysyła pól opcji i nie zapisuje ich w planie', async () => {
    terrainBodies.length = 0;
    const fc = await new TaklabRoute(config, base, base + '/terrain').route([[20.5, 52.3], [20.52, 52.31]], 'foot_cross_country', { avoid_wetland: false, max_slope_deg: 35 });
    assert.deepEqual(Object.keys(terrainBodies[0]).sort(), ['end', 'start']);
    const plan = (fc.features[0].properties.metadata as { taklab_route: RoutePlan }).taklab_route;
    assert.equal(plan.options, undefined);
    assert.doesNotMatch(String(fc.features[0].properties.remarks), /Opcje:/);
});

test('opcje przełaju w trybie drogowym są pomijane', async () => {
    const fc = await new TaklabRoute(config, base, base + '/terrain').route([[21, 52], [21.1, 52.1]], 'foot', { avoid_wetland: true });
    const plan = (fc.features[0].properties.metadata as { taklab_route: RoutePlan }).taklab_route;
    assert.equal(plan.options, undefined);
});

test('ekspozycja: średnia i unikaj idą do usługi i opisu, może być jest pomijane, nieznana = 400', async () => {
    const route = new TaklabRoute(config, base, base + '/terrain');
    terrainBodies.length = 0;
    const fc = await route.route([[20.5, 52.3], [20.52, 52.31]], 'foot_cross_country', { exposure: 'avoid' });
    assert.equal(terrainBodies[0].exposure, 'avoid');
    assert.match(String(fc.features[0].properties.remarks), /Opcje: unika terenu odsłoniętego/);

    terrainBodies.length = 0;
    const medium = await route.route([[20.5, 52.3], [20.52, 52.31]], 'foot_cross_country', { exposure: 'medium' });
    assert.match(String(medium.features[0].properties.remarks), /Opcje: ogranicza teren odsłonięty/);

    terrainBodies.length = 0;
    const allow = await route.route([[20.5, 52.3], [20.52, 52.31]], 'foot_cross_country', { exposure: 'allow' });
    assert.equal(terrainBodies[0].exposure, undefined);
    assert.equal((allow.features[0].properties.metadata as { taklab_route: RoutePlan }).taklab_route.options, undefined);

    await assert.rejects(route.route([[20.5, 52.3], [20.52, 52.31]], 'foot_cross_country', { exposure: 'never' as 'avoid' }), status(400));
});

test('nachylenie poza 5–35° = 400', async () => {
    const route = new TaklabRoute(config, base, base + '/terrain');
    await assert.rejects(route.route([[20.5, 52.3], [20.52, 52.31]], 'foot_cross_country', { max_slope_deg: 50 }), status(400));
    await assert.rejects(route.route([[20.5, 52.3], [20.52, 52.31]], 'foot_cross_country', { max_slope_deg: 2 }), status(400));
});

test('reroute przełaju liczy z opcjami i zostawia je w planie', async () => {
    const route = new TaklabRoute(config, base, base + '/terrain');
    const options = { avoid_wetland: true };
    const before = (await route.route([[20.5, 52.3], [20.52, 52.31]], 'foot_cross_country', options)).features[0];
    const plan = (before.properties.metadata as { taklab_route: RoutePlan }).taklab_route;
    terrainBodies.length = 0;
    const after = (await route.reroute({
        travelMode: 'foot_cross_country',
        waypoints: [[20.5, 52.3], [20.53, 52.32]],
        coordinates: before.geometry.coordinates as number[][],
        legs: plan.legs,
        first: 0, count: 1, added: 0,
        options,
    })).features[0];
    assert.equal(terrainBodies.length, 1);
    assert.equal(terrainBodies[0].avoid_wetland, true);
    assert.deepEqual((after.properties.metadata as { taklab_route: RoutePlan }).taklab_route.options, options);
});

test('composeAnalysis: blok OCOKA z charakterystyką, ukryciem, nachyleniem, przeszkodami, strefami i terenem kluczowym', () => {
    const text = composeAnalysis(ANALYSIS);
    assert.equal(text, [
        'Analiza terenu (OCOKA)',
        'Charakterystyka: 9,2 km, wysokość 320–503 m n.p.m. Drogi i ścieżki 52%, las 28%, teren otwarty 11%, cieki 7%, zabudowa 1%, zarośla 1%.',
        'Ukrycie: osłona lasu lub zarośli 28% trasy, teren odsłonięty 13%, drogi 52% (osłona zależy od otoczenia drogi). Najdłuższy odsłonięty odcinek: km 2,1–2,6 (500 m).',
        'Nachylenie: największe 27°. Do 5°: 72%, 5–15°: 16%, 15–25°: 11%, ponad 25°: 1%.',
        'Przeszkody: stromo (ponad 25°) km 0,3–0,4; ciek km 0,8; bagno km 3,0–3,2; woda przy trasie km 5,4–6,0.',
        'Strefy niebezpieczne: zabudowa km 0,5–1,6; przejście przez drogę km 1,4; teren otwarty km 2,1–2,6; teren otwarty km 4,0–4,3; grzbiet, sylwetka na tle nieba km 7,1–7,4.',
        'Teren kluczowy i obserwacja:',
        '- przeprawa (most) km 5,1',
        '- wzgórze 517 m n.p.m. (89 m nad trasą), 1,4 km na płn.-zach. od km 9,2 (50.35886, 16.66483): widzi 35% trasy, km 6,1–6,8, km 8,0–9,2',
        '- wzgórze 601 m n.p.m. (99 m nad trasą), 0,4 km na płd. od km 0,0 (50.29000, 16.59000): trasy nie widzi',
        'Założenia: osłona i przeszkody z OSM, wysokości z DTED2 (kratka 30 m), korony drzew przyjęte jako 15 m, obserwacja do 3 km. Model nie zna gęstości lasu, płotów, drobnych uskoków ani dróg podejścia przeciwnika.',
    ].join('\n'));
});

test('composeAnalysis: długie listy są skracane', () => {
    const many = { ...ANALYSIS, obstacles: Array.from({ length: 10 }, (_, i) => ({ kind: 'stream' as const, from_m: i * 1000, to_m: i * 1000 + 30 })) };
    assert.match(composeAnalysis(many), /ciek km 5,0; i 4 inne\./);
});

test('trasa dostaje analizę terenu w opisie i w planie', async () => {
    analyzeBodies = [];
    const fc = await new TaklabRoute(config, base, base + '/terrain').route([[21, 52], [21.1, 52.1]], 'foot');
    assert.equal(analyzeBodies.length, 1);
    assert.deepEqual(analyzeBodies[0].coordinates, fc.features[0].geometry.coordinates.map(c => [(c as number[])[0], (c as number[])[1]]));
    assert.match(String(fc.features[0].properties.remarks), /\n\nAnaliza terenu \(OCOKA\)\nCharakterystyka:/);
    const plan = (fc.features[0].properties.metadata as { taklab_route: RoutePlan }).taklab_route;
    assert.equal(plan.analysis?.length_m, 9179);
});

test('błąd analizy nie psuje trasy, opis o tym mówi', async () => {
    const fc = await new TaklabRoute(config, base, base + '/terrain').route([[4, 52], [4.1, 52.1]], 'foot');
    assert.match(String(fc.features[0].properties.remarks), /Analiza terenu: niedostępna\./);
    const plan = (fc.features[0].properties.metadata as { taklab_route: RoutePlan }).taklab_route;
    assert.equal(plan.analysis, undefined);
});

test('bez usługi terenu trasa nie ma analizy ani wzmianki o niej', async () => {
    analyzeBodies = [];
    const fc = await new TaklabRoute(config, base, '').route([[21, 52], [21.1, 52.1]], 'foot');
    assert.equal(analyzeBodies.length, 0);
    assert.doesNotMatch(String(fc.features[0].properties.remarks), /Analiza terenu/);
});

test('zagrożenia z mapy idą do usługi terenu i do opisu', async () => {
    terrainBodies.length = 0;
    const threats = {
        observers: [[20.51, 52.31]] as Array<[number, number]>,
        closed_areas: [[[20.5, 52.3], [20.51, 52.3], [20.51, 52.29], [20.5, 52.3]]] as Array<Array<[number, number]>>,
    };
    const fc = await new TaklabRoute(config, base, base + '/terrain').route([[20.5, 52.3], [20.52, 52.31]], 'foot_cross_country', { avoid_observation: true }, threats);
    assert.deepEqual(terrainBodies[0].observers, threats.observers);
    assert.deepEqual(terrainBodies[0].closed_areas, threats.closed_areas);
    assert.equal(terrainBodies[0].avoid_observation, true);
    const remarks = String(fc.features[0].properties.remarks);
    assert.match(remarks, /Opcje: unika widoczności ze wzgórz/);
    assert.match(remarks, /Z mapy: 1 posterunek przeciwnika, 1 teren zamknięty\./);
    const plan = (fc.features[0].properties.metadata as { taklab_route: RoutePlan }).taklab_route;
    assert.deepEqual(plan.threats, { observers: 1, closed_areas: 1 });
});

test('teren zamknięty w trasie drogowej to obszar w custom_model', async () => {
    ghBodies.length = 0;
    const ring: Array<[number, number]> = [[21, 52], [21.01, 52], [21.01, 52.01], [21, 52]];
    await new TaklabRoute(config, base, '').route([[21, 52], [21.1, 52.1]], 'car_no_motorway', undefined, { closed_areas: [ring] });
    assert.deepEqual(ghBodies[0].custom_model, {
        priority: [
            { if: 'road_class == MOTORWAY', multiply_by: '0' },
            { if: 'in_closed0', multiply_by: '0' },
        ],
        areas: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'closed0', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] },
    });
});

test('posterunki w trasie drogowej są pomijane, bez zagrożeń brak custom_model', async () => {
    ghBodies.length = 0;
    await new TaklabRoute(config, base, '').route([[21, 52], [21.1, 52.1]], 'car', undefined, { observers: [[21, 52]] });
    assert.equal(ghBodies[0].custom_model, undefined);
});

test('zły wielokąt albo za dużo zagrożeń = 400', async () => {
    const route = new TaklabRoute(config, base, base + '/terrain');
    await assert.rejects(route.route([[20.5, 52.3], [20.52, 52.31]], 'foot_cross_country', undefined, { closed_areas: [[[1, 1], [2, 2]]] }), status(400));
    const many = Array.from({ length: 51 }, () => [20.5, 52.3] as [number, number]);
    await assert.rejects(route.route([[20.5, 52.3], [20.52, 52.31]], 'foot_cross_country', undefined, { observers: many }), status(400));
});

test('composeAnalysis: łączna widoczność ze wzgórz, gdy jest observed_ratio', () => {
    assert.match(composeAnalysis({ ...ANALYSIS, observed_ratio: 0.42 }), /\nWidoczność ze wzgórz łącznie: 42% trasy\.\n/);
});

test('odmiana liczebników w opisie zagrożeń', async () => {
    const ring: Array<[number, number]> = [[20.5, 52.3], [20.51, 52.3], [20.51, 52.29], [20.5, 52.3]];
    const fc = await new TaklabRoute(config, base, base + '/terrain').route([[20.5, 52.3], [20.52, 52.31]], 'foot_cross_country', undefined, {
        observers: Array.from({ length: 5 }, () => [20.51, 52.31] as [number, number]),
        closed_areas: [ring, ring],
    });
    assert.match(String(fc.features[0].properties.remarks), /Z mapy: 5 posterunków przeciwnika, 2 tereny zamknięte\./);
});

test('Taklab routing - teardown', async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await config.pg.end();
});
