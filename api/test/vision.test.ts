import test from 'node:test';
import assert from 'node:assert';
import {
    VisionControl,
    normalizeAnalysis,
    normalizeFaces,
    normalizeNotice,
    normalizeSources,
    choiceBody,
    safeNumber,
} from '../stateless/lib/control/vision.js';
import type { OtsTransport } from '../stateless/lib/control/recordings.js';

const AUTH = { cert: 'CERT-admin', key: 'KEY-admin' };

type Seen = { url: string; method: string; body?: string };

function fake(routes: (s: Seen) => Response): { control: VisionControl; seen: Seen[] } {
    const seen: Seen[] = [];
    const control = new VisionControl(() => 'https://public-ots:8443/');
    const transport: OtsTransport = async (url, init) => {
        const s = { url, method: init.method, body: init.body };
        seen.push(s);
        return routes(s);
    };
    control.transport = transport;
    return { control, seen };
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const ANALYSIS = {
    id: 12, source: 'recording', label: 'patrol-3', account: 'ola', created_by: 'administrator',
    created_at: '2026-11-26 14:10:00', started_at: null, finished_at: null, state: 'queued',
    percent: null, elapsed_s: null, persons: 0, error: null,
};

test('normalizeAnalysis keeps the contract and refuses rows without id or source', () => {
    assert.deepEqual(normalizeAnalysis(ANALYSIS), ANALYSIS);
    assert.equal(normalizeAnalysis({ ...ANALYSIS, id: 'x' }), null);
    assert.equal(normalizeAnalysis({ ...ANALYSIS, source: 'file' }), null);
    assert.equal(normalizeAnalysis({ ...ANALYSIS, state: 'weird' })?.state, 'error');
    assert.equal(normalizeAnalysis({ ...ANALYSIS, persons: undefined })?.persons, 0);
});

test('normalizeFaces moves thumbnails to the CloudTAK proxy and drops foreign addresses', () => {
    const faces = normalizeFaces({ items: [
        { id: 3, label: 'Osoba 3', count: 5, thumb_url: '/api/taklab/vision/analyses/12/persons/3/thumb.jpg',
            moments: [{ moment: '00:41', at: '2026-11-26 14:10:41', sighting_id: 99 }, { moment: 'x' }] },
        { id: 4, label: 'Osoba 4', count: 1, thumb_url: 'https://evil.example/x.jpg', moments: [] },
        { label: 'bez id' },
    ] });
    assert.equal(faces.length, 2);
    assert.equal(faces[0].thumb_url, '/api/vision/analyses/12/persons/3/thumb.jpg');
    assert.deepEqual(faces[0].moments, [{ moment: '00:41', at: '2026-11-26 14:10:41', sighting_id: 99 }]);
    assert.equal(faces[1].thumb_url, '');
});

test('normalizeSources skips entries without path or id', () => {
    const s = normalizeSources({
        live: [{ path: 'live/jan', account: 'jan', ready_time: '2026-11-26T15:02:00Z', auto: true, analysis: null }, { account: 'x' }],
        recordings: [{ id: 'abc', name: 'patrol-3', account: 'ola', started_at: '2026-11-26T13:10:00Z', duration_s: 760 }, {}],
    });
    assert.deepEqual(s.live, [{ path: 'live/jan', account: 'jan', ready_time: '2026-11-26T15:02:00Z', analysis: null }]);
    assert.equal(s.recordings.length, 1);
    assert.equal(s.recordings[0].duration_s, 760);
});

test('choiceBody accepts one live path or one recording id', () => {
    assert.deepEqual(choiceBody({ source: 'live', path: ' live/jan ' }), { source: 'live', path: 'live/jan' });
    assert.deepEqual(choiceBody({ source: 'recording', recording_id: 'a-1_B' }), { source: 'recording', recording_id: 'a-1_B' });
    for (const bad of [{}, { source: 'live', path: '' }, { source: 'recording', recording_id: '../x' }, { source: 'file' }]) {
        assert.throws(() => choiceBody(bad), (err: { status: number }) => err.status === 400);
    }
});

test('safeNumber refuses anything but digits', () => {
    assert.equal(safeNumber(12), '12');
    for (const bad of ['1/stop', '-1', '', '1'.repeat(10), 'a']) {
        assert.throws(() => safeNumber(bad), (err: { status: number }) => err.status === 400, bad);
    }
});

test('status: enabled only when OTS says so; refusals and errors read as disabled', async () => {
    assert.deepEqual(await fake(() => json({ enabled: true })).control.status(AUTH), { enabled: true });
    assert.deepEqual(await fake(() => json({ enabled: false })).control.status(AUTH), { enabled: false });
    assert.deepEqual(await fake(() => json({ error: 'x' }, 403)).control.status(AUTH), { enabled: false });
    assert.deepEqual(await fake(() => json({}, 404)).control.status(AUTH), { enabled: false });
    const broken = fake(() => { throw new Error('ECONNREFUSED'); });
    assert.deepEqual(await broken.control.status(AUTH), { enabled: false });
});

test('start sends only the choice to OTS and returns the analysis', async () => {
    const { control, seen } = fake(() => json(ANALYSIS, 201));
    const a = await control.start(AUTH, { source: 'recording', recording_id: 'abc' });
    assert.equal(a.id, 12);
    assert.equal(seen[0].url, 'https://public-ots:8443/api/taklab/vision/analyses');
    assert.equal(seen[0].method, 'POST');
    assert.deepEqual(JSON.parse(seen[0].body || '{}'), { source: 'recording', recording_id: 'abc' });
});

test('errors: refusal is a fixed message, queue and stream messages from OTS pass through', async () => {
    await assert.rejects(fake(() => json({ error: 'Analiza wideo jest dostępna tylko dla administratora.' }, 403)).control.list(AUTH),
        (err: { status: number; safe: string }) => err.status === 403 && /administratora/.test(err.safe));
    await assert.rejects(fake(() => json({ error: 'Za dużo analiz naraz.' }, 429)).control.start(AUTH, { source: 'live', path: 'a' }),
        (err: { status: number; safe: string }) => err.status === 429 && err.safe === 'Za dużo analiz naraz.');
    await assert.rejects(fake(() => json({ error: 'Usługa analizy wideo nie odpowiada.' }, 503)).control.sources(AUTH),
        (err: { status: number }) => err.status === 503);
    await assert.rejects(fake(() => new Response('boom', { status: 500 })).control.get(AUTH, 1),
        (err: { status: number }) => err.status === 502);
});

test('stop and faces call the analysis paths', async () => {
    const { control, seen } = fake((s) => s.url.endsWith('/faces') ? json({ items: [] }) : json({ ...ANALYSIS, state: 'stopped' }));
    assert.equal((await control.stop(AUTH, 12)).state, 'stopped');
    assert.deepEqual(await control.faces(AUTH, '12'), []);
    assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), [
        'POST https://public-ots:8443/api/taklab/vision/analyses/12/stop',
        'GET https://public-ots:8443/api/taklab/vision/analyses/12/faces',
    ]);
});

test('no OTS address: analysis is reported as not enabled', async () => {
    const control = new VisionControl(() => null);
    assert.deepEqual(await control.status(AUTH), { enabled: false });
    await assert.rejects(control.list(AUTH), (err: { status: number }) => err.status === 404);
});

test('notice: only a known level with short text passes', () => {
    assert.deepEqual(normalizeNotice({ level: 'warning', text: 'Maszyna nie działa.' }), { level: 'warning', text: 'Maszyna nie działa.' });
    assert.deepEqual(normalizeNotice({ level: 'info', text: 'Uruchamia się.', extra: 1 }), { level: 'info', text: 'Uruchamia się.' });
    assert.equal(normalizeNotice(null), null);
    assert.equal(normalizeNotice({ level: 'error', text: 'x' }), null);
    assert.equal(normalizeNotice({ level: 'warning', text: ' ' }), null);
    assert.equal(normalizeNotice({ level: 'warning', text: 'x'.repeat(501) }), null);
});

test('list and get carry the GPU notice from OTS', async () => {
    const notice = { level: 'warning', text: 'Maszyna z kartą graficzną nie działa.' };
    const { control } = fake((s) => s.url.endsWith('/analyses')
        ? json({ analyses: [ANALYSIS, { id: 'bad' }], notice })
        : json({ ...ANALYSIS, notice }));
    assert.deepEqual(await control.list(AUTH), { analyses: [ANALYSIS], notice });
    assert.deepEqual(await control.get(AUTH, 12), { ...ANALYSIS, notice });
    const old = fake(() => json({ analyses: [ANALYSIS] }));
    assert.deepEqual(await old.control.list(AUTH), { analyses: [ANALYSIS], notice: null });
});
