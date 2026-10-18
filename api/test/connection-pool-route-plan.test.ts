import test from 'node:test';
import assert from 'node:assert';
import { CoTParser } from '@tak-ps/node-cot';
import { attachRoutePlan, applyRoutePlan, applyRouteMeta } from '../common/taklab-route-cot.js';

const coords = [[17.03, 51.11], [17.05, 51.1], [17.07, 51.09]];
const plan = {
    version: 1, mode: 'foot', mode_name: 'Pieszo',
    waypoints: [[17.03, 51.11], [17.07, 51.09]],
    legs: [{ start: 0, end: 2, distance_m: 3000, duration_s: 2000 }],
};

function feature(type = 'b-m-r', c = coords) {
    return {
        id: 'route-1', type: 'Feature' as const, path: '/',
        properties: { type, how: 'm-g', callsign: 'Trasa', archived: true, metadata: { taklab_route: plan } },
        geometry: { type: 'LineString' as const, coordinates: c },
    };
}

async function incoming() {
    const f = feature();
    const cot = await CoTParser.from_geojson(f);
    attachRoutePlan(cot, f);
    return CoTParser.from_xml(CoTParser.to_xml(cot));
}

test('applyRoutePlan: ważny element trafia do metadata, inne klucze zostają', async () => {
    const cot = await incoming();
    const feat = { geometry: { type: 'LineString', coordinates: coords }, properties: { type: 'b-m-r', metadata: { other: 1 } } };
    applyRoutePlan(cot, feat);
    const meta = feat.properties.metadata as Record<string, unknown>;
    assert.strictEqual(meta.other, 1);
    assert.strictEqual((meta.taklab_route as Record<string, unknown>).mode, 'foot');
});

test('applyRoutePlan: inna geometria usuwa taklab_route, zostawia resztę', async () => {
    const cot = await incoming();
    const other = [[17.03, 51.11], [17.06, 51.1], [17.07, 51.09]];
    const feat = { geometry: { type: 'LineString', coordinates: other }, properties: { type: 'b-m-r', metadata: { other: 1, taklab_route: plan } } };
    applyRoutePlan(cot, feat);
    assert.deepStrictEqual(feat.properties.metadata, { other: 1 });
});

test('applyRoutePlan: brak elementu i brak metadata nie tworzy metadata; puste istniejące zostaje {}', async () => {
    const f = feature();
    const cot = await CoTParser.from_geojson(f);
    const a: { geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> } = { geometry: f.geometry, properties: { type: 'b-m-r' } };
    applyRoutePlan(cot, a);
    assert.strictEqual('metadata' in a.properties, false);
    const b = { geometry: f.geometry, properties: { type: 'b-m-r', metadata: { taklab_route: plan } } };
    applyRoutePlan(cot, b);
    assert.deepStrictEqual(b.properties.metadata, {});
});

test('applyRoutePlan: nie-trasa bez zmian', async () => {
    const cot = await incoming();
    const feat = { geometry: { type: 'Point', coordinates: [17, 51] }, properties: { type: 'a-f-G', metadata: { taklab_route: plan } } };
    applyRoutePlan(cot, feat);
    assert.deepStrictEqual(feat.properties.metadata, { taklab_route: plan });
});

test('round trip: geojson -> CoT -> XML -> CoT -> geojson zachowuje plan (7+ miejsc, z wysokością)', async () => {
    const c = [[17.0300001234, 51.1100004321, 123.4], [17.0500009876, 51.1000001111, 124.5], [17.0700005555, 51.0900007777, 125.6]];
    const f = feature('b-m-r', c);
    const cot = await CoTParser.from_geojson(f);
    attachRoutePlan(cot, f);
    const back = await CoTParser.from_xml(CoTParser.to_xml(cot));
    const geo = await CoTParser.to_geojson(back) as unknown as { geometry: { type: string; coordinates: number[][] }; properties: Record<string, unknown> };
    applyRoutePlan(back, geo);
    const meta = geo.properties.metadata as Record<string, unknown> | undefined;
    assert.ok(meta && meta.taklab_route, 'taklab_route musi przeżyć konwersję geometrii: ' + JSON.stringify(geo.geometry.coordinates));
});

// Zdarzenie zbudowane przez bota (routes/plan_cot.py build_route_event): czysty ASCII,
// polskie znaki jako odwołania, ten sam fp w planie i w <__taklab_actor>.
const BOT_XML = '<event version="2.0" uid="r-1" type="b-m-r" how="h-e" time="2026-10-16T09:00:00.000Z" start="2026-10-16T09:00:00.000Z" stale="2026-10-30T09:00:00.000Z"><point lat="51.1100004" lon="17.0300001" hae="9999999.0" ce="9999999.0" le="9999999.0" /><detail><link uid="r-1.0" type="b-m-p-w" point="51.1100004321,17.0300001234" callsign="START" relation="c" /><link uid="r-1.1" type="b-m-p-c" point="51.1000001111,17.0500009876" relation="c" /><link uid="r-1.2" type="b-m-p-w" point="51.0900007777,17.0700005555" callsign="CEL" relation="c" /><link_attr color="-65536" method="Walking" direction="Infil" routetype="Primary" order="Ascending Check Points" planningmethod="Infil" prefix="CP" stroke="3" style="0" /><contact callsign="Do &#378;r&#243;d&#322;a" /><creator uid="ANDROID-1" callsign="WOLF" type="a-f-G-U-C" time="2026-10-16T09:00:00.000Z" /><remarks>Trasa przez &#322;&#261;k&#281; #ai-buddy na pro&#347;b&#281; @WOLF, 2026-10-16 09:00Z</remarks><archive /><__taklab_route v="1" fp="057fab9978d12e49dbd8397c01580429e5fa1e5a64b636e8a422f16b67e22750">{"version":1,"mode":"foot","mode_name":"Pieszo","waypoints":[[17.0300001234,51.1100004321],[17.0700005555,51.0900007777]],"legs":[{"start":0,"end":2,"distance_m":3000,"duration_s":2000}]}</__taklab_route><__taklab_actor uid="ai_buddy" on_behalf="ANDROID-1" log="7" fp="057fab9978d12e49dbd8397c01580429e5fa1e5a64b636e8a422f16b67e22750" /><marti><dest uid="ANDROID-1" /></marti></detail></event>';

test('zdarzenie bota: plan i taklab_actor przechodzą przez to_geojson, polski tekst wraca', async () => {
    const back = await CoTParser.from_xml(BOT_XML);
    const geo = await CoTParser.to_geojson(back) as unknown as { geometry: { type: string; coordinates: number[][] }; properties: Record<string, unknown> };
    applyRouteMeta(back, geo);
    const meta = geo.properties.metadata as Record<string, unknown>;
    assert.ok(meta.taklab_route, 'plan bota musi się czytać w CloudTAK');
    assert.deepStrictEqual(meta.taklab_actor, { uid: 'ai_buddy', on_behalf: 'ANDROID-1', log: '7' });
    assert.strictEqual(geo.properties.callsign, 'Do źródła');
});

test('zdarzenie bota poprawione w ATAK (inna linia, stary actor) traci taklab_actor i plan', async () => {
    const moved = BOT_XML.replace('51.1000001111,17.0500009876', '51.1000001111,17.0600009876');
    const back = await CoTParser.from_xml(moved);
    const geo = await CoTParser.to_geojson(back) as unknown as { geometry: { type: string; coordinates: number[][] }; properties: Record<string, unknown> };
    applyRouteMeta(back, geo);
    const meta = (geo.properties.metadata ?? {}) as Record<string, unknown>;
    assert.strictEqual('taklab_actor' in meta, false);
    assert.strictEqual('taklab_route' in meta, false);
});
