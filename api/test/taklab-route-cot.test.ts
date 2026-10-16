import test from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { CoTParser } from '@tak-ps/node-cot';
import { attachRoutePlan, readRoutePlan, readRouteActor, applyRouteActor, routeFingerprint, setMartiDestinations, MAX_PLAN_BYTES } from '../common/taklab-route-cot.js';

const coords = [[17.03, 51.11], [17.05, 51.1], [17.07, 51.09]];
const plan = {
    version: 1, mode: 'foot', mode_name: 'Pieszo',
    waypoints: [[17.03, 51.11], [17.07, 51.09]],
    legs: [{ start: 0, end: 2, distance_m: 3000, duration_s: 2000 }],
    analysis: { length_m: 3000 },
};

function feature(p: unknown = plan, c = coords) {
    return {
        id: 'route-1', type: 'Feature' as const, path: '/',
        properties: { type: 'b-m-r', how: 'm-g', callsign: 'Trasa', archived: true, metadata: { taklab_route: p } },
        geometry: { type: 'LineString' as const, coordinates: c },
    };
}

test('routeFingerprint: SHA-256 z lon,lat do 6 miejsc', () => {
    const expected = createHash('sha256').update('17.030000,51.110000;17.050000,51.100000;17.070000,51.090000').digest('hex');
    assert.strictEqual(routeFingerprint(coords), expected);
    assert.strictEqual(routeFingerprint([[17.03, 51.11, 120], [17.05, 51.1, 0], [17.07, 51.09, 5]]), expected);
});

test('attach + read: plan przechodzi przez XML bez analizy', async () => {
    const f = feature();
    const cot = await CoTParser.from_geojson(f);
    assert.strictEqual(attachRoutePlan(cot, f), true);
    const back = await CoTParser.from_xml(CoTParser.to_xml(cot));
    const out = readRoutePlan(back, coords);
    assert.ok(out);
    assert.strictEqual(out.mode, 'foot');
    assert.strictEqual('analysis' in out, false);
});

test('read: inna geometria (edycja w ATAK) = null', async () => {
    const f = feature();
    const cot = await CoTParser.from_geojson(f);
    attachRoutePlan(cot, f);
    const back = await CoTParser.from_xml(CoTParser.to_xml(cot));
    assert.strictEqual(readRoutePlan(back, [[17.03, 51.11], [17.06, 51.1], [17.07, 51.09]]), null);
});

test('attach: nie trasa, brak planu albo zły plan = false', async () => {
    const f = feature();
    const marker = { ...f, properties: { ...f.properties, type: 'a-f-G' } };
    assert.strictEqual(attachRoutePlan(await CoTParser.from_geojson(f), marker), false);
    const none = feature(null);
    assert.strictEqual(attachRoutePlan(await CoTParser.from_geojson(none), none), false);
    const bad = feature({ ...plan, legs: [{ start: 0, end: 5, distance_m: 1, duration_s: 1 }] });
    assert.strictEqual(attachRoutePlan(await CoTParser.from_geojson(bad), bad), false);
});

test('attach: plan ponad 16 KB nie jest dopisywany', async () => {
    const big = feature({ ...plan, legs: [{ ...plan.legs[0], steps: ['x'.repeat(MAX_PLAN_BYTES)] }] });
    const cot = await CoTParser.from_geojson(big);
    const calls: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
        calls.push(args);
    };
    try {
        assert.strictEqual(attachRoutePlan(cot, big), false);
    } finally {
        console.warn = original;
    }
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][0], 'taklab route plan too large');
    assert.strictEqual(calls[0][1], 'route-1');
    assert.ok(typeof calls[0][2] === 'number' && calls[0][2] > MAX_PLAN_BYTES);
    assert.strictEqual(CoTParser.to_xml(cot).includes('__taklab_route'), false);
});

test('read: zły JSON, zła wersja, brak elementu = null', async () => {
    const f = feature();
    for (const mutate of [
        (xml: string) => xml.replace(/"version":1/, '"version":2'),
        (xml: string) => xml.replace(/<__taklab_route v="1"/, '<__taklab_route v="2"'),
        (xml: string) => xml.replace(/<__taklab_route[^>]*>[^<]*<\/__taklab_route>/, '<__taklab_route v="1" fp="x">{</__taklab_route>'),
        (xml: string) => xml.replace(/<__taklab_route[^>]*>[^<]*<\/__taklab_route>/, ''),
    ]) {
        const cot = await CoTParser.from_geojson(f);
        attachRoutePlan(cot, f);
        const back = await CoTParser.from_xml(mutate(CoTParser.to_xml(cot)));
        assert.strictEqual(readRoutePlan(back, coords), null);
    }
});

test('setMartiDestinations: jeden <marti>, bez duplikatów', async () => {
    const cot = await CoTParser.from_geojson(feature());
    setMartiDestinations(cot, ['A', 'B', 'A']);
    const xml = CoTParser.to_xml(cot);
    assert.strictEqual((xml.match(/<marti>/g) || []).length, 1);
    assert.ok(xml.includes('<dest uid="A"/><dest uid="B"/>'));
});

test('round-trip: znaki specjalne i polskie litery w krokach', async () => {
    const expected = {
        version: 1, mode: 'foot', mode_name: 'Pieszo',
        waypoints: plan.waypoints,
        legs: [{ ...plan.legs[0], steps: ['1. Skręć w lewo <A&B> "przez" most', '2. It\'s > 5 & < 9 żółć'] }],
    };
    const f = feature({ ...expected, analysis: { length_m: 1 } });
    const cot = await CoTParser.from_geojson(f);
    assert.strictEqual(attachRoutePlan(cot, f), true);
    const back = await CoTParser.from_xml(CoTParser.to_xml(cot));
    assert.deepStrictEqual(readRoutePlan(back, coords), expected);
});

test('attach: nie zmienia planu w cesze wejściowej', async () => {
    const f = feature();
    const cot = await CoTParser.from_geojson(f);
    attachRoutePlan(cot, f);
    assert.deepStrictEqual(f.properties.metadata.taklab_route, plan);
    assert.ok('analysis' in plan);
});

test('read: dwa elementy w detail = null bez wyjątku', async () => {
    const f = feature();
    const cot = await CoTParser.from_geojson(f);
    attachRoutePlan(cot, f);
    const xml = CoTParser.to_xml(cot);
    const element = xml.match(/<__taklab_route[^>]*>[^<]*<\/__taklab_route>/)![0];
    const back = await CoTParser.from_xml(xml.replace(element, element + element));
    assert.strictEqual(readRoutePlan(back, coords), null);
});

async function withActor(attrs: Record<string, string> | null) {
    const f = feature();
    const cot = await CoTParser.from_geojson(f);
    if (attrs) (cot.raw.event.detail as Record<string, unknown>).__taklab_actor = { _attributes: attrs };
    return CoTParser.from_xml(CoTParser.to_xml(cot));
}

test('readRouteActor: czyta uid, on_behalf, log i fp po przejściu przez XML', async () => {
    const fp = routeFingerprint(coords);
    const back = await withActor({ uid: 'ai_buddy', on_behalf: 'ANDROID-1', log: 'a1', fp });
    assert.deepStrictEqual(readRouteActor(back), { uid: 'ai_buddy', on_behalf: 'ANDROID-1', log: 'a1', fp });
});

test('readRouteActor: brak elementu albo pusty atrybut = null', async () => {
    assert.strictEqual(readRouteActor(await withActor(null)), null);
    assert.strictEqual(readRouteActor(await withActor({ uid: 'ai_buddy', on_behalf: '', log: 'a1' })), null);
    assert.strictEqual(readRouteActor(await withActor({ uid: 'ai_buddy', on_behalf: 'X' })), null);
    // Bez fp (starszy bot) nie wiadomo, czy linia jest ta, którą bot wysłał
    assert.strictEqual(readRouteActor(await withActor({ uid: 'ai_buddy', on_behalf: 'X', log: 'a1' })), null);
});

test('applyRouteActor: ustawia i usuwa metadata.taklab_actor, nie tworzy metadata bez potrzeby', async () => {
    const withIt = await withActor({ uid: 'ai_buddy', on_behalf: 'ANDROID-1', log: 'a1', fp: routeFingerprint(coords) });
    const without = await withActor(null);
    const geometry = { type: 'LineString', coordinates: coords };
    const a = { geometry, properties: { type: 'b-m-r', metadata: { keep: 1 } } as Record<string, unknown> };
    applyRouteActor(withIt, a);
    assert.deepStrictEqual(a.properties.metadata, { keep: 1, taklab_actor: { uid: 'ai_buddy', on_behalf: 'ANDROID-1', log: 'a1' } });
    applyRouteActor(without, a);
    assert.deepStrictEqual(a.properties.metadata, { keep: 1 });
    const b = { geometry, properties: { type: 'b-m-r' } as Record<string, unknown> };
    applyRouteActor(without, b);
    assert.strictEqual('metadata' in b.properties, false);
    const marker = { geometry: { type: 'Point', coordinates: [1, 2] }, properties: { type: 'a-f-G' } as Record<string, unknown> };
    applyRouteActor(withIt, marker);
    assert.strictEqual('metadata' in marker.properties, false);
});

test('applyRouteActor: fp innej geometrii (trasa zmieniona w ATAK) usuwa taklab_actor', async () => {
    const stale = await withActor({ uid: 'ai_buddy', on_behalf: 'ANDROID-1', log: 'a1', fp: routeFingerprint(coords) });
    const moved = [[17.03, 51.11], [17.06, 51.1], [17.07, 51.09]];
    const f = { geometry: { type: 'LineString', coordinates: moved }, properties: { type: 'b-m-r', metadata: { keep: 1, taklab_actor: { uid: 'ai_buddy', on_behalf: 'ANDROID-1', log: 'a0' } } } as Record<string, unknown> };
    applyRouteActor(stale, f);
    assert.deepStrictEqual(f.properties.metadata, { keep: 1 });

    const fresh = { geometry: { type: 'LineString', coordinates: moved }, properties: { type: 'b-m-r' } as Record<string, unknown> };
    applyRouteActor(stale, fresh);
    assert.strictEqual('metadata' in fresh.properties, false);
});
