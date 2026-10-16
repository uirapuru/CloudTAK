// Pliki wzorcowe planera tras (nagrane ze starego kodu TS w Task 1) sprawdzają teraz klienta CloudTAK:
// atrapa planera oddaje `output` z pliku, a klient po normalize_geojson ma zachować te same
// geometry i properties (type, how, callsign, archived, remarks, metadata) oraz komunikaty błędów.
import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import { AddressInfo } from 'node:net';
import Err from '@openaddresses/batch-error';
import TaklabRoute from '../stateless/lib/routing/taklab.js';
import type Config from '../common/config.js';

const FIXTURE = new URL('./fixtures/routeplan-golden.json', import.meta.url);

type Recorded = {
    name: string;
    call: 'config' | 'route' | 'reroute' | 'variants';
    input: Record<string, unknown>;
    status: number;
    output: { message?: string; features?: unknown[] };
};

const PATHS = { route: '/plan', reroute: '/legs', variants: '/variants' } as const;

let current: Recorded | null = null;
let seen: { method: string; url: string; body: unknown } | null = null;

const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
        seen = { method: String(req.method), url: String(req.url), body: raw ? JSON.parse(raw) : null };
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = current && current.call !== 'config' ? current.status : 200;
        res.end(JSON.stringify(current ? current.output : {}));
    });
});

function stripFeature(f: { type: string; geometry: unknown; properties: Record<string, unknown> }) {
    const p = f.properties;
    return {
        type: f.type,
        geometry: f.geometry,
        properties: { type: p.type, how: p.how, callsign: p.callsign, archived: p.archived, remarks: p.remarks, metadata: p.metadata },
    };
}

test('routeplan golden: klient oddaje to, co zwrócił planer', async (t) => {
    const cases: Recorded[] = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    assert.equal(cases.length, 40);

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const planner = new TaklabRoute({} as Config, base, { planner: 2000, modes: 2000 });

    try {
        for (const c of cases) {
            await t.test(c.name, async () => {
                current = c;
                seen = null;

                if (c.call === 'config') {
                    assert.deepStrictEqual(await planner.config(), c.output);
                    assert.equal(seen!.url, '/modes');
                    return;
                }

                const run = async () => {
                    if (c.call === 'route') {
                        return await planner.route(c.input.stops as Array<[number, number]>, c.input.travelMode as string | undefined, c.input.options as never, c.input.threats as never);
                    } else if (c.call === 'reroute') {
                        return await planner.reroute(c.input as never);
                    }
                    return await planner.variants(c.input as never);
                };

                if (c.status === 200) {
                    const fc = await run();
                    assert.equal(fc.type, 'FeatureCollection');
                    assert.deepStrictEqual(fc.features.map(f => stripFeature(f as never)), c.output.features);
                } else {
                    await assert.rejects(run, (err: unknown) => {
                        assert.ok(err instanceof Err);
                        assert.equal(err.status, 400);
                        assert.equal(err.safe, c.output.message);
                        return true;
                    });
                }

                assert.equal(seen!.url, PATHS[c.call]);
                if (c.call === 'route') {
                    const { stops, travelMode, options, threats } = c.input;
                    assert.deepStrictEqual(seen!.body, JSON.parse(JSON.stringify({ waypoints: stops, travelMode: travelMode ?? 'car', options, threats })));
                } else {
                    assert.deepStrictEqual(seen!.body, c.input);
                }
            });
        }
    } finally {
        server.closeAllConnections();
        server.close();
    }
});
