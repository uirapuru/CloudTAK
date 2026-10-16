// Rejestrator plików wzorcowych planera tras.
// RECORD_GOLDEN=1 zapisuje test/fixtures/routeplan-golden.json; bez zmiennej test porównuje kod z plikiem.
import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import { AddressInfo } from 'node:net';
import Err from '@openaddresses/batch-error';
import TaklabRoute from '../stateless/lib/routing/taklab.js';
import type { RouteAnalysis, RoutePlan } from '../stateless/lib/routing/taklab.js';
import type Config from '../common/config.js';

const FIXTURE = new URL('./fixtures/routeplan-golden.json', import.meta.url);
const DEFAULT_PROFILES = ['car', 'offroad', 'foot', 'hike'];

let base = '';
// Profile zwracane przez GET /info; null = 404
let infoProfiles: string[] | null = DEFAULT_PROFILES;
// Zapytania do atrapy w bieżącym przypadku
let upstream: Array<{ path: string; body: unknown }> = [];

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
        let parsed = false;
        try {
            body = JSON.parse(raw);
            parsed = true;
        } catch {
            // ciało nie jest JSON-em
        }
        upstream.push({ path: String(req.url), body: req.method === 'GET' || !parsed ? null : body });

        if (req.method === 'GET' && req.url === '/info') {
            if (!infoProfiles) return send(404, '{}');
            return send(200, JSON.stringify({ profiles: infoProfiles.map(name => ({ name })) }));
        }

        if (req.method === 'POST' && req.url === '/route') {
            if ((body as unknown as { algorithm?: string }).algorithm === 'alternative_route') {
                const path = (dy: number) => ({ distance: 12000 + dy * 1e5, time: 1000000, points: { type: 'LineString', coordinates: [body.points[0], [body.points[0][0], body.points[0][1] + dy], body.points[1]] } });
                return send(200, JSON.stringify({ paths: [path(0), path(0.01), path(-0.01)] }));
            }
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
            if (analyzeBody.coordinates[0][0] === 4) return send(502, '<html>Bad Gateway</html>');
            return send(200, JSON.stringify(ANALYSIS));
        }

        if (req.method === 'POST' && req.url === '/terrain/variants') {
            const end = (body as unknown as { end: number[] }).end;
            const variant = (dy: number) => ({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [body.start, [body.start[0], body.start[1] + dy], end] },
                properties: { distance_m: 2600, duration_s: 3000, ascent_m: 10, descent_m: 5, offpath_ratio: 0.8, overlap_ratio: 0.1 },
            });
            return send(200, JSON.stringify({ type: 'FeatureCollection', features: [variant(0.01), variant(-0.01)] }));
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
            const end = (body as unknown as { end: number[] }).end;
            return send(200, JSON.stringify({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [body.start, end] },
                properties: { distance_m: 2300, duration_s: 2700, ascent_m: 15, descent_m: 3, offpath_ratio: 0.63 },
            }));
        }

        send(404, '{}');
    });
});

type Pt = [number, number];
type Call = 'route' | 'reroute' | 'variants' | 'config';
type Input = Record<string, unknown>;
type Case = {
    name: string;
    call: Call;
    // Wejście zapisywane w pliku; dla reroute i variants może zależeć od wyników wcześniejszych przypadków
    input: (done: Map<string, Recorded>) => Input;
};
type Recorded = {
    name: string;
    call: Call;
    input: Input;
    status: number;
    output: unknown;
    upstream: Array<{ path: string; body: unknown }>;
};

const A: Pt = [17.03, 51.11];
const B: Pt = [17.07, 51.09];
const C: Pt = [17.05, 51.10];
const THREE: Pt[] = [A, C, B];
const THREATS = {
    observers: [[17.05, 51.1], [17.06, 51.1]],
    closed_areas: [[[17, 51], [17.01, 51], [17.01, 51.01], [17, 51]]],
};
const TERRAIN_OPTIONS = { avoid_wetland: true, avoid_streams: true, max_slope_deg: 20, exposure: 'avoid', avoid_observation: true };

function routeCase(name: string, stops: Pt[], travelMode: string | undefined, extra: Input = {}): Case {
    return { name, call: 'route', input: () => ({ stops, ...(travelMode === undefined ? {} : { travelMode }), ...extra }) };
}

// Stan wyjściowy dla reroute i variants: linia i plan z wyniku przypadku źródłowego
function stateOf(done: Map<string, Recorded>, source: string): { coordinates: number[][]; legs: unknown[] } {
    const recorded = done.get(source);
    if (!recorded) throw new Error(`Brak przypadku źródłowego ${source}`);
    const feature = (recorded.output as { features: Array<{ geometry: { coordinates: number[][] }; properties: { metadata: { taklab_route: RoutePlan } } }> }).features[0];
    return { coordinates: feature.geometry.coordinates, legs: feature.properties.metadata.taklab_route.legs };
}

function rerouteCase(name: string, source: string, mode: string, waypoints: Pt[], first: number, count: number, added: number, extra: Input = {}): Case {
    return {
        name,
        call: 'reroute',
        input: done => {
            const { coordinates, legs } = stateOf(done, source);
            return { travelMode: mode, waypoints, coordinates, legs, first, count, added, ...extra };
        },
    };
}

function variantsCase(name: string, source: string, mode: string, waypoints: Pt[], count: number): Case {
    return {
        name,
        call: 'variants',
        input: done => ({ travelMode: mode, waypoints, coordinates: stateOf(done, source).coordinates, count }),
    };
}

const CASES: Case[] = [
    { name: 'config-all', call: 'config', input: () => ({}) },
    { name: 'config-no-hike', call: 'config', input: () => ({ infoProfiles: ['car', 'offroad', 'foot'] }) },
    { name: 'config-no-terrain', call: 'config', input: () => ({ terrain: false }) },
    routeCase('car-two-points', [A, B], 'car'),
    routeCase('default-mode', [A, B], undefined),
    routeCase('agol-default-mode', [A, B], 'Driving Time'),
    routeCase('car-no-motorway', [A, B], 'car_no_motorway'),
    routeCase('foot-three-points', THREE, 'foot'),
    routeCase('dense-car', [[3, 52], [3.5, 52]], 'car'),
    routeCase('gh-error-message', [[0, 0], [1, 1]], 'car'),
    routeCase('gh-error-no-message', [[1, 52], [2, 52]], 'car'),
    routeCase('second-leg-error', [[17, 51], [7, 52], [17.1, 51.1]], 'car'),
    routeCase('unknown-mode', [A, B], 'nope'),
    routeCase('terrain-plain', [A, B], 'foot_cross_country'),
    routeCase('terrain-options', [A, B], 'foot_cross_country', { options: TERRAIN_OPTIONS }),
    routeCase('terrain-exposure-medium', [A, B], 'foot_cross_country', { options: { exposure: 'medium' } }),
    routeCase('terrain-exposure-allow', [A, B], 'foot_cross_country', { options: { exposure: 'allow', max_slope_deg: 35 } }),
    routeCase('terrain-exposure-bad', [A, B], 'foot_cross_country', { options: { exposure: 'x' } }),
    routeCase('terrain-slope-bad', [A, B], 'foot_cross_country', { options: { max_slope_deg: 40 } }),
    routeCase('terrain-no-path', [[0, 51], B], 'foot_cross_country'),
    routeCase('terrain-fastapi-422', [[1, 51], B], 'foot_cross_country'),
    routeCase('terrain-html', [[2, 51], B], 'foot_cross_country'),
    routeCase('terrain-three-points', THREE, 'foot_cross_country'),
    routeCase('analysis-failed', [[4, 52], [4.1, 52]], 'car'),
    routeCase('threats-terrain', [A, B], 'foot_cross_country', { threats: THREATS }),
    routeCase('threats-foot', [A, B], 'foot', { threats: THREATS }),
    routeCase('threats-car-observers-only', [A, B], 'car', { threats: { observers: [[17.05, 51.1]] } }),
    routeCase('ignore-zones-foot', [A, B], 'foot', { threats: THREATS, options: { ignore_danger_zones: true } }),
    routeCase('ignore-zones-terrain', [A, B], 'foot_cross_country', { threats: THREATS, options: { ignore_danger_zones: true } }),
    routeCase('threats-bad-ring', [A, B], 'foot', { threats: { closed_areas: [[[17, 51], [17.01, 51]]] } }),
    routeCase('threats-plural-5', [A, B], 'foot', { threats: { closed_areas: Array.from({ length: 5 }, () => THREATS.closed_areas[0]) } }),
    rerouteCase('reroute-move-end', 'foot-three-points', 'foot', [A, C, [17.08, 51.09]], 1, 1, 0),
    rerouteCase('reroute-insert', 'car-two-points', 'car', [A, C, B], 0, 1, 1),
    rerouteCase('reroute-remove-via', 'foot-three-points', 'foot', [A, B], 0, 2, -1),
    rerouteCase('reroute-remove-start', 'foot-three-points', 'foot', [C, B], 0, 1, -1),
    {
        // linia ma trzy wierzchołki, plan z car-two-points kończy się na drugim
        name: 'reroute-bad-plan',
        call: 'reroute',
        input: done => {
            const { coordinates, legs } = stateOf(done, 'car-two-points');
            return { travelMode: 'car', waypoints: [A, B], coordinates: [...coordinates, [17.1, 51.0, 120]], legs, first: 0, count: 1, added: 0 };
        },
    },
    // terrain-options ma jeden odcinek, więc first 1 wymaga stanu z trzech punktów: bierzemy terrain-three-points
    rerouteCase('reroute-terrain-options', 'terrain-three-points', 'foot_cross_country', [A, C, [17.08, 51.09]], 1, 1, 0, { options: TERRAIN_OPTIONS }),
    variantsCase('variants-terrain', 'terrain-plain', 'foot_cross_country', [A, B], 2),
    variantsCase('variants-road', 'car-two-points', 'car', [A, B], 2),
    variantsCase('variants-bad-count', 'car-two-points', 'car', [A, B], 3),
];

// Przypadki, w których GET /info zwraca inne profile niż domyślne
function profilesOf(input: Input): string[] | null {
    return 'infoProfiles' in input ? input.infoProfiles as string[] | null : DEFAULT_PROFILES;
}

function stripFeature(f: { type: string; geometry: unknown; properties: Record<string, unknown> }) {
    const p = f.properties;
    return {
        type: f.type,
        geometry: f.geometry,
        properties: { type: p.type, how: p.how, callsign: p.callsign, archived: p.archived, remarks: p.remarks, metadata: p.metadata },
    };
}

function byPathThenBody(a: { path: string; body: unknown }, b: { path: string; body: unknown }): number {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    const x = JSON.stringify(a.body);
    const y = JSON.stringify(b.body);
    return x < y ? -1 : x > y ? 1 : 0;
}

async function run(c: Case, done: Map<string, Recorded>): Promise<Recorded> {
    const input = c.input(done);
    infoProfiles = profilesOf(input);
    upstream = [];

    const terrainUrl = input.terrain === false ? '' : base + '/terrain';
    const planner = new TaklabRoute({} as Config, base, terrainUrl, { graphhopper: 2000, terrain: 2000, info: 1000, analyze: 1000 });

    let status = 200;
    let output: unknown;
    try {
        if (c.call === 'config') {
            output = await planner.config();
        } else {
            let fc;
            if (c.call === 'route') {
                fc = await planner.route(input.stops as Pt[], input.travelMode as string | undefined, input.options as never, input.threats as never);
            } else if (c.call === 'reroute') {
                fc = await planner.reroute(input as never);
            } else {
                fc = await planner.variants(input as never);
            }
            output = { type: fc.type, features: fc.features.map(f => stripFeature(f as never)) };
        }
    } catch (err) {
        if (!(err instanceof Err)) throw err;
        status = err.status;
        output = { message: err.safe };
    }

    // Wynik ma przejść przez JSON, tak jak plik
    return JSON.parse(JSON.stringify({
        name: c.name,
        call: c.call,
        input,
        status,
        output,
        upstream: upstream.slice().sort(byPathThenBody),
    }));
}

test('routeplan golden', async (t) => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const recording = process.env.RECORD_GOLDEN === '1';
    const expected: Recorded[] | null = recording ? null : JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const done = new Map<string, Recorded>();

    try {
        for (const c of CASES) {
            await t.test(c.name, async () => {
                const actual = await run(c, done);
                done.set(c.name, actual);
                if (expected) {
                    const want = expected.find(e => e.name === c.name);
                    assert.ok(want, `brak przypadku ${c.name} w pliku`);
                    assert.deepStrictEqual(actual, want);
                }
            });
        }

        if (expected) {
            assert.deepStrictEqual(expected.map(e => e.name), CASES.map(c => c.name));
        } else {
            fs.mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
            fs.writeFileSync(FIXTURE, JSON.stringify(CASES.map(c => done.get(c.name)), null, 1) + '\n');
        }
    } finally {
        server.close();
    }
});
