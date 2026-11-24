import test from 'node:test';
import assert from 'node:assert';
import { Writable } from 'node:stream';
import type { Response as ExpressResponse } from 'express';
import { CoTParser } from '@tak-ps/node-cot';
import {
    RecordingsControl,
    normalizeRecording,
    normalizeTrack,
    normalizeUsage,
    listItems,
    otsQuery,
    archiveQuery,
    safeId,
    type OtsTransport,
} from '../stateless/lib/control/recordings.js';
import { readRecordingRef, applyRecordingRef } from '../common/taklab-recording-cot.js';

const AUTH = { cert: 'CERT-alfa', key: 'KEY-alfa' };

type Seen = { url: string; method: string; headers: Record<string, string>; body?: string; auth: typeof AUTH };

function fake(routes: (s: Seen) => Response): { control: RecordingsControl; seen: Seen[] } {
    const seen: Seen[] = [];
    const control = new RecordingsControl(() => 'https://public-ots:8443/');
    const transport: OtsTransport = async (url, init, auth) => {
        const s = { url, method: init.method, headers: init.headers, body: init.body, auth };
        seen.push(s);
        return routes(s);
    };
    control.transport = transport;
    return { control, seen };
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const ROW = {
    id: 7, kind: 'video', account: 'alfa', callsign: 'WOLF', uid: 'ANDROID-1', name: 'Patrol',
    started_at: '2026-11-24T10:00:00Z', ended_at: '2026-11-24T10:10:00Z', duration_s: 600,
    lat: 51.1, lon: 17.0, size_bytes: 45_000_000, has_text: false,
};

test('otsQuery keeps only contract keys, checks kind and sends dates as ISO UTC', () => {
    assert.equal(otsQuery({}), '');
    assert.equal(otsQuery({ kind: 'bogus', page: 1 }), '');
    assert.equal(
        otsQuery({ kind: 'scan', account: ' alfa ', from: '2026-11-24T10:00:00Z', to: '2026-11-24T12:00:00+01:00', page: 3 }),
        '?kind=scan&account=alfa&from=2026-11-24T10%3A00%3A00.000Z&to=2026-11-24T11%3A00%3A00.000Z&page=3',
    );
    assert.throws(() => otsQuery({ from: 'jutro' }), (err: { status: number }) => err.status === 400);
});

test('safeId refuses anything that could leave the path', () => {
    assert.equal(safeId(12), '12');
    assert.equal(safeId('a-B_9'), 'a-B_9');
    for (const bad of ['../usage', '1/file', '', 'x'.repeat(65), '1?x=2']) {
        assert.throws(() => safeId(bad), (err: { status: number }) => err.status === 400, bad);
    }
});

test('normalizeRecording: author or administrator may manage unless OTS says otherwise', () => {
    assert.equal(normalizeRecording(ROW, 'ALFA', false)?.can_manage, true);
    assert.equal(normalizeRecording(ROW, 'bravo', false)?.can_manage, false);
    assert.equal(normalizeRecording(ROW, 'bravo', true)?.can_manage, true);
    assert.equal(normalizeRecording({ ...ROW, can_delete: false }, 'alfa', true)?.can_manage, false);
    assert.equal(normalizeRecording({ ...ROW, can_manage: true }, 'bravo', false)?.can_manage, true);
    assert.equal(normalizeRecording({ ...ROW, account: '' }, '', false)?.can_manage, false);
    assert.equal(normalizeRecording({ ...ROW, kind: 'photo' }, 'alfa', false), null);
    assert.equal(normalizeRecording(null, 'alfa', false), null);

    const r = normalizeRecording({ ...ROW, ended_at: null, duration_s: null, lat: '51.2', size_bytes: undefined }, 'alfa', false);
    assert.equal(r?.id, '7');
    assert.equal(r?.ended_at, null);
    assert.equal(r?.duration_s, null);
    assert.equal(r?.lat, 51.2);
    assert.equal(r?.size_bytes, null);
});

test('normalizeTrack drops broken points and keeps [lat, lon, t]', () => {
    assert.deepEqual(normalizeTrack(undefined), []);
    assert.deepEqual(normalizeTrack([[51, 17, '2026-11-24T10:00:00Z'], [91, 17, 1], ['x', 1], [51.1, 17.1], 'zle']), [
        [51, 17, '2026-11-24T10:00:00Z'],
        [51.1, 17.1, null],
    ]);
});

test('listItems and normalizeUsage accept the shapes OTS may answer with', () => {
    assert.equal(listItems([ROW]).items.length, 1);
    assert.deepEqual(listItems({ results: [ROW], page: 2, total_pages: 5 }).total_pages, 5);
    assert.equal(listItems({ items: [ROW, ROW] }).items.length, 2);
    assert.deepEqual(listItems({ results: [ROW], total: 31, current_page: 3, total_pages: 4, per_page: 10 }).page, 3);
    assert.deepEqual(listItems('x').items, []);

    assert.deepEqual(normalizeUsage({ used_bytes: 10, limit_bytes: 20 }), { admin: true, used_bytes: 10, limit_bytes: 20 });
    assert.deepEqual(normalizeUsage({ used: 1, limit: 2 }), { admin: true, used_bytes: 1, limit_bytes: 2 });
    assert.deepEqual(normalizeUsage({ used_gb: 1, limit_gb: 50 }), { admin: true, used_bytes: 1024 ** 3, limit_bytes: 50 * 1024 ** 3 });
    assert.deepEqual(normalizeUsage({}), { admin: true, used_bytes: null, limit_bytes: null });
});

test('list calls OTS with the caller certificate, video only, and marks rows for the administrator', async () => {
    const { control, seen } = fake((s) => {
        if (s.url.endsWith('/usage')) return json({ used_bytes: 5, limit_bytes: 50 });
        return json([ROW, { ...ROW, id: 8, account: 'bravo' }, { id: 9, kind: 'weird' }]);
    });
    // Decision 25 XI 2026: CloudTAK lists video only, whatever kind the browser asks for.
    const list = await control.list('administrator', AUTH, { kind: 'voice', page: 2 });
    assert.equal(list.enabled, true);
    assert.equal(list.admin, true);
    assert.equal(list.page, 2);
    assert.deepEqual(list.items.map((r) => [r.id, r.can_manage]), [['7', true], ['8', true]]);

    const listCall = seen.find((s) => !s.url.endsWith('/usage'))!;
    assert.equal(listCall.url, 'https://public-ots:8443/api/taklab/recordings?kind=video&page=2');
    assert.deepEqual(listCall.auth, AUTH);
    assert.equal(listCall.headers.Authorization, undefined, 'no CloudTAK token goes to OTS');
});

test('a regular account: usage 403 = not admin, only own rows manageable, admin answer cached', async () => {
    let usageCalls = 0;
    const { control } = fake((s) => {
        if (s.url.endsWith('/usage')) {
            usageCalls++;
            return json({ message: 'nope' }, 403);
        }
        return json({ items: [ROW, { ...ROW, id: 8, account: 'bravo' }] });
    });
    const list = await control.list('alfa', AUTH, {});
    assert.equal(list.admin, false);
    assert.deepEqual(list.items.map((r) => r.can_manage), [true, false]);
    await control.list('alfa', AUTH, {});
    assert.equal(usageCalls, 1);
    assert.deepEqual(await control.usage('alfa', AUTH), { admin: false, used_bytes: null, limit_bytes: null });
});

test('list on an OTS without the register = disabled, not an error', async () => {
    const { control } = fake(() => new Response('<html>404</html>', { status: 404 }));
    const list = await control.list('alfa', AUTH, {});
    assert.deepEqual(list, { enabled: false, admin: false, page: 1, total_pages: null, items: [] });
});

test('get returns the track; voice and scan are not shown; rename sends a trimmed name; delete', async () => {
    const { control, seen } = fake((s) => {
        if (s.url.endsWith('/usage')) return json({}, 403);
        if (s.method === 'PATCH' || s.method === 'DELETE') return new Response(null, { status: 204 });
        if (s.url.endsWith('/8')) return json({ ...ROW, id: 8, kind: 'scan', has_text: true, text: 'Rozkaz nr 1' });
        if (s.url.endsWith('/9')) return json({ ...ROW, id: 9, kind: 'voice' });
        return json({ ...ROW, track: [[51, 17, 0]] });
    });
    const rec = await control.get('alfa', AUTH, '7');
    assert.equal(rec.kind, 'video');
    assert.deepEqual(rec.track, [[51, 17, 0]]);
    for (const id of ['8', '9']) {
        await assert.rejects(control.get('alfa', AUTH, id), (err: { status: number }) => err.status === 404, id);
    }

    await control.rename('alfa', AUTH, '7', '  Odprawa  ');
    const patch = seen.find((s) => s.method === 'PATCH')!;
    assert.equal(patch.url, 'https://public-ots:8443/api/taklab/recordings/7');
    assert.equal(patch.body, JSON.stringify({ name: 'Odprawa' }));
    await assert.rejects(control.rename('alfa', AUTH, '7', '   '), (err: { status: number }) => err.status === 400);

    await control.remove(AUTH, '7');
    assert.equal(seen.filter((s) => s.method === 'DELETE')[0].url, 'https://public-ots:8443/api/taklab/recordings/7');
});

test('OTS errors map to Polish errors without passing the OTS text', async () => {
    for (const [status, expected] of [[401, 403], [403, 403], [404, 404], [400, 400], [500, 502]] as const) {
        const { control } = fake((s) => (s.url.endsWith('/usage') ? json({}, 403) : json({ message: 'konto bravo' }, status)));
        await assert.rejects(control.get('alfa', AUTH, '7'), (err: { status: number; safe?: string; message: string }) => {
            assert.equal(err.status, expected);
            assert.doesNotMatch(String(err.safe ?? err.message), /bravo/);
            return true;
        });
    }
    const control = new RecordingsControl(() => 'https://x');
    control.transport = async () => {
        throw new Error('ECONNREFUSED');
    };
    await assert.rejects(control.remove(AUTH, '7'), (err: { status: number }) => err.status === 502);
    const off = new RecordingsControl(() => null);
    await assert.rejects(off.remove(AUTH, '7'), (err: { status: number }) => err.status === 404);
});

class FakeRes extends Writable {
    statusCode = 200;
    headers: Record<string, string> = {};
    chunks: Buffer[] = [];
    headersSent = false;
    status(code: number) {
        this.statusCode = code;
        return this;
    }
    setHeader(name: string, value: string) {
        this.headers[name.toLowerCase()] = value;
    }
    _write(chunk: Buffer, _enc: string, done: () => void) {
        this.headersSent = true;
        this.chunks.push(chunk);
        done();
    }
}

test('file passes Range to OTS and 206 with Content-Range back, inline unless download', async () => {
    const { control, seen } = fake((s) => new Response('0123', {
        status: s.headers.Range ? 206 : 200,
        headers: {
            'content-type': 'video/mp4',
            'content-length': '4',
            'content-range': 'bytes 0-3/1000',
            'content-disposition': 'attachment; filename="patrol.mp4"',
            'set-cookie': 'session=ots',
        },
    }));

    const res = new FakeRes();
    await control.file(AUTH, '7', 'bytes=0-3', res as unknown as ExpressResponse, false);
    assert.equal(seen[0].url, 'https://public-ots:8443/api/taklab/recordings/7/file');
    assert.equal(seen[0].headers.Range, 'bytes=0-3');
    assert.equal(res.statusCode, 206);
    assert.equal(res.headers['content-range'], 'bytes 0-3/1000');
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.equal(res.headers['content-disposition'], 'inline');
    assert.equal(res.headers['set-cookie'], undefined);
    assert.equal(Buffer.concat(res.chunks).toString(), '0123');

    const down = new FakeRes();
    await control.file(AUTH, '7', 'bytes=0-3; drop table', down as unknown as ExpressResponse, true);
    assert.equal(seen[1].headers.Range, undefined, 'malformed Range is not forwarded');
    assert.equal(down.headers['content-disposition'], 'attachment; filename="patrol.mp4"');
});

test('archiveQuery: chosen ids, or all video with the list filters, nothing else', () => {
    assert.equal(archiveQuery({ ids: 'a-1, b_2,,' }), '?ids=a-1,b_2');
    assert.equal(archiveQuery({ ids: 'a', all: true, kind: 'video' }), '?ids=a', 'ids win over all');
    assert.equal(archiveQuery({ all: true }), '?kind=video&all=1');
    assert.equal(
        archiveQuery({ all: true, kind: 'voice', account: ' alfa ', from: '2026-11-24T10:00:00Z' }),
        '?kind=video&account=alfa&from=2026-11-24T10%3A00%3A00.000Z&all=1',
    );
    for (const bad of [{}, { ids: '../usage' }, { ids: Array.from({ length: 101 }, (_, n) => `r${n}`).join(',') }, { all: true, from: 'jutro' }]) {
        assert.throws(() => archiveQuery(bad), (err: { status: number }) => err.status === 400, JSON.stringify(bad).slice(0, 40));
    }
});

test('archive streams the OTS ZIP with a safe file name and maps 403 to the admin message', async () => {
    const { control, seen } = fake(() => new Response('PK\x03\x04zip', {
        status: 200,
        headers: {
            'content-type': 'application/zip',
            'content-disposition': 'attachment; filename="nagrania-20261124-190000.zip"',
            'set-cookie': 'session=ots',
        },
    }));
    const res = new FakeRes();
    await control.archive(AUTH, { ids: 'a,b' }, res as unknown as ExpressResponse);
    assert.equal(seen[0].url, 'https://public-ots:8443/api/taklab/recordings/archive?ids=a,b');
    assert.equal(seen[0].auth, AUTH);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/zip');
    assert.equal(res.headers['content-disposition'], 'attachment; filename="nagrania-20261124-190000.zip"');
    assert.equal(res.headers['set-cookie'], undefined);
    assert.equal(Buffer.concat(res.chunks).toString(), 'PK\x03\x04zip');

    const odd = fake(() => new Response('PK', { status: 200, headers: { 'content-disposition': 'attachment; filename="../x.zip"' } }));
    const oddRes = new FakeRes();
    await odd.control.archive(AUTH, { all: true }, oddRes as unknown as ExpressResponse);
    assert.equal(oddRes.headers['content-disposition'], 'attachment; filename="nagrania.zip"');

    const refused = fake(() => json({ error: 'konto bravo' }, 403));
    await assert.rejects(refused.control.archive(AUTH, { all: true }, new FakeRes() as unknown as ExpressResponse), (err: { status: number; safe?: string; message: string }) => {
        assert.equal(err.status, 403);
        assert.match(String(err.safe ?? err.message), /tylko dla administratora/);
        return true;
    });
});

test('file 416 and 404 become errors before any byte is sent', async () => {
    const { control } = fake(() => new Response('', { status: 416 }));
    const res = new FakeRes();
    await assert.rejects(control.file(AUTH, '7', 'bytes=9999-', res as unknown as ExpressResponse, false), (err: { status: number }) => err.status === 416);
    assert.equal(res.chunks.length, 0);
});

function cotFrom(detail: string, type = 'b-i-v') {
    return CoTParser.from_xml(`<event version="2.0" uid="rec-7" type="${type}" how="h-g-i-g-o" time="2026-11-24T10:00:00Z" start="2026-11-24T10:00:00Z" stale="2027-11-24T10:00:00Z"><point lat="51.1" lon="17.0" hae="0" ce="9999999" le="9999999"/><detail>${detail}</detail></event>`);
}

test('CoT: __taklab_recording goes to metadata, link stays in links', async () => {
    const cot = cotFrom('<contact callsign="Wideo WOLF"/><__taklab_recording id="7" kind="video"/><link uid="rec:7" relation="r-u" type="taklab-recording"/>');
    assert.deepEqual(readRecordingRef(cot), { id: '7', kind: 'video' });
    const feat = await CoTParser.to_geojson(cot);
    applyRecordingRef(cot, feat as unknown as { properties: Record<string, unknown> });
    const props = feat.properties as unknown as { metadata: Record<string, unknown>; links: Array<Record<string, string>> };
    assert.deepEqual(props.metadata.taklab_recording, { id: '7', kind: 'video' });
    assert.ok(props.links.some((l) => l.uid === 'rec:7' && l.type === 'taklab-recording'));
});

test('CoT: bad or missing recording element changes nothing', async () => {
    for (const detail of ['', '<__taklab_recording id="../x"/>', '<__taklab_recording kind="video"/>']) {
        const cot = cotFrom(detail);
        assert.equal(readRecordingRef(cot), null);
        const feat = await CoTParser.to_geojson(cot);
        const before = JSON.stringify(feat.properties);
        applyRecordingRef(cot, feat as unknown as { properties: Record<string, unknown> });
        assert.equal(JSON.stringify(feat.properties), before);
    }
    assert.deepEqual(readRecordingRef(cotFrom('<__taklab_recording id="9" kind="photo"/>')), { id: '9' });
});

