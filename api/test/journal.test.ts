import test from 'node:test';
import assert from 'node:assert';
import { Writable } from 'node:stream';
import type { Response as ExpressResponse } from 'express';
import { Ajv } from 'ajv';
import {
    JournalControl,
    JournalEntrySchema,
    JournalListSchema,
    normalizeEntry,
    normalizeList,
    normalizeAccounts,
    normalizeEstimate,
    otsQuery,
} from '../stateless/lib/control/journal.js';
import type { OtsTransport } from '../stateless/lib/control/recordings.js';

const AUTH = { cert: 'CERT-administrator', key: 'KEY-administrator' };

type Seen = { url: string; method: string; headers: Record<string, string>; auth: typeof AUTH; signal: AbortSignal };

function fake(routes: (s: Seen) => Response): { control: JournalControl; seen: Seen[] } {
    const seen: Seen[] = [];
    const control = new JournalControl(() => 'https://public-ots:8443/');
    const transport: OtsTransport = async (url, init, auth) => {
        const s = { url, method: init.method, headers: init.headers, auth, signal: init.signal };
        seen.push(s);
        return routes(s);
    };
    control.transport = transport;
    return { control, seen };
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// The Entry example of the OTS contract, every field set.
const ENTRY = {
    id: 1, at: '2026-11-24T18:01:02.123Z', kind: 'chat',
    account: 'niebiescy2', callsign: 'ALFA-1', device_uid: 'ANDROID-1',
    object_uid: 'GeoChat.ANDROID-1.BRAVO-2.x', object_type: 'b-t-f', title: 'Wiadomość prywatna do BRAVO-2',
    text: 'treść\ndruga linia', private: true,
    recipients: [{ callsign: 'BRAVO-2', uid: 'ANDROID-2', account: 'czerwoni1' }],
    chatroom: 'BRAVO-2', lat: 52.1, lon: 21.0, mission: null,
    file: { source: 'data_package', ref: 'abc123', filename: 'zdjecie.jpg', size: 123, mime: 'image/jpeg', available: true },
};

test('otsQuery: contract keys only, checked values, dates as ISO UTC, positions always explicit', () => {
    assert.equal(otsQuery({}), '?positions=0');
    assert.equal(
        otsQuery({
            since: '2026-11-24T10:00:00+01:00', until: '2026-11-24T12:00:00Z',
            account: ' niebiescy2, czerwoni1 ,', kind: 'chat,file_send', q: '  rozkaz ',
            positions: true, page: 3, per_page: 500,
        }),
        '?since=2026-11-24T09%3A00%3A00.000Z&until=2026-11-24T12%3A00%3A00.000Z'
        + '&account=niebiescy2%2Cczerwoni1&kind=chat%2Cfile_send&q=rozkaz&positions=1&page=3&per_page=200',
    );
    assert.equal(otsQuery({ page: 2, per_page: 50, kind: 'chat' }, false), '?kind=chat&positions=0');
    assert.throws(() => otsQuery({ since: 'wczoraj' }), (err: { status: number }) => err.status === 400);
    assert.throws(() => otsQuery({ kind: 'chat,drop' }), (err: { status: number }) => err.status === 400);
});

test('normalizeEntry keeps every contract field and drops broken values', () => {
    assert.deepEqual(normalizeEntry(ENTRY), ENTRY);

    const bare = normalizeEntry({ id: '2', at: '2026-11-24T18:00:00Z', kind: 'position', lat: 95, lon: '17.1', file: { available: true } });
    assert.deepEqual(bare, {
        id: 2, at: '2026-11-24T18:00:00Z', kind: 'position',
        account: null, callsign: null, device_uid: null, object_uid: null, object_type: null,
        title: '', text: null, private: false, recipients: [], chatroom: null,
        lat: null, lon: 17.1, mission: null, file: null,
    });

    const unavailable = normalizeEntry({ ...ENTRY, file: { filename: 'film.mp4', size: '4096' } });
    assert.deepEqual(unavailable?.file, { source: '', ref: '', filename: 'film.mp4', size: 4096, mime: null, available: false });
    assert.deepEqual(normalizeEntry({ ...ENTRY, recipients: [null, {}, { callsign: 'X' }] })?.recipients, [{ callsign: 'X', uid: null, account: null }]);

    for (const bad of [null, 'x', { ...ENTRY, id: 'a' }, { ...ENTRY, id: 1.5 }, { ...ENTRY, at: '' }, { ...ENTRY, kind: null }]) {
        assert.equal(normalizeEntry(bad), null);
    }
});

test('response schemas survive batch-schema (removeAdditional all) with every Entry field', () => {
    // Same AJV options as @openaddresses/batch-schema: fields the schema does not name are cut.
    const ajv = new Ajv({ strict: false, allErrors: true, useDefaults: true, removeAdditional: 'all', coerceTypes: true, discriminator: true });
    const validate = ajv.compile(JournalListSchema);
    const body = structuredClone({ items: [ENTRY, normalizeEntry({ id: 3, at: '2026-11-24T18:00:00Z', kind: 'disconnect' })], total: 2, page: 1, per_page: 50 });
    assert.ok(validate(body), JSON.stringify(validate.errors));
    assert.deepEqual(body.items[0], ENTRY, 'recipients, file and private reach the browser');
    assert.equal(body.items[1]?.file, null);

    const one = ajv.compile(JournalEntrySchema);
    const extra = structuredClone({ ...ENTRY, secret: 'x' });
    assert.ok(one(extra));
    assert.equal((extra as Record<string, unknown>).secret, undefined);
});

test('list, accounts and estimate envelopes', () => {
    assert.deepEqual(normalizeList({ items: [ENTRY, { id: 'x' }], total: 31, page: 2, per_page: 10 }, {}), { items: [ENTRY], total: 31, page: 2, per_page: 10 });
    assert.deepEqual(normalizeList({}, { page: 4, per_page: 50 }), { items: [], total: 0, page: 4, per_page: 50 });
    assert.deepEqual(normalizeAccounts({ accounts: [{ account: 'alfa', callsigns: ['WOLF', null, 7] }, { callsigns: [] }, 'x'] }), [{ account: 'alfa', callsigns: ['WOLF', '7'] }]);
    assert.deepEqual(normalizeAccounts(null), []);
    assert.deepEqual(normalizeEstimate({ entries: 120, files: 4, bytes: 5.5e9, missing: 1 }), { entries: 120, files: 4, bytes: 5.5e9, missing: 1 });
    assert.deepEqual(normalizeEstimate({ entries: -1 }), { entries: 0, files: 0, bytes: 0, missing: 0 });
});

test('list goes to OTS with the caller certificate, filters and no CloudTAK token', async () => {
    const { control, seen } = fake(() => json({ items: [ENTRY], total: 1, page: 1, per_page: 50 }));
    const list = await control.list(AUTH, { since: '2026-11-24T00:00:00Z', kind: 'chat', per_page: 50 });
    assert.deepEqual(list.items, [ENTRY]);
    assert.equal(seen[0].url, 'https://public-ots:8443/api/taklab/journal?since=2026-11-24T00%3A00%3A00.000Z&kind=chat&positions=0&per_page=50');
    assert.equal(seen[0].method, 'GET');
    assert.deepEqual(seen[0].auth, AUTH);
    assert.equal(seen[0].headers.Authorization, undefined);
});

test('access: admin true only from OTS; 401, 403 and 404 hide the menu', async () => {
    for (const [status, body, expected] of [
        [200, { admin: true }, true],
        [200, { admin: 'yes' }, false],
        [200, {}, false],
        [401, {}, false],
        [403, {}, false],
        [404, {}, false],
    ] as const) {
        const { control, seen } = fake(() => json(body, status));
        assert.deepEqual(await control.access(AUTH), { admin: expected }, `${status} ${JSON.stringify(body)}`);
        assert.equal(seen[0].url, 'https://public-ots:8443/api/taklab/journal/access');
    }
    const { control } = fake(() => json({}, 500));
    await assert.rejects(control.access(AUTH), (err: { status: number }) => err.status === 502);
});

test('accounts and estimate use their own OTS routes; estimate carries the filters without paging', async () => {
    const { control, seen } = fake((s) => (s.url.includes('/accounts')
        ? json({ accounts: [{ account: 'alfa', callsigns: ['WOLF'] }] })
        : json({ entries: 10, files: 2, bytes: 2048, missing: 1 })));
    assert.deepEqual(await control.accounts(AUTH), { accounts: [{ account: 'alfa', callsigns: ['WOLF'] }] });
    assert.deepEqual(await control.estimate(AUTH, { account: 'alfa', positions: true, page: 3 }), { entries: 10, files: 2, bytes: 2048, missing: 1 });
    assert.equal(seen[0].url, 'https://public-ots:8443/api/taklab/journal/accounts');
    assert.equal(seen[1].url, 'https://public-ots:8443/api/taklab/journal/export/estimate?account=alfa&positions=1');
});

test('OTS errors become Polish errors without the OTS text', async () => {
    for (const [status, expected] of [[401, 403], [403, 403], [404, 404], [413, 413], [400, 400], [422, 400], [500, 502]] as const) {
        const { control } = fake(() => json({ message: 'konto bravo' }, status));
        await assert.rejects(control.list(AUTH, {}), (err: { status: number; safe?: string; message: string }) => {
            assert.equal(err.status, expected);
            assert.doesNotMatch(String(err.safe ?? err.message), /bravo/);
            return true;
        });
    }
    const down = new JournalControl(() => 'https://x');
    down.transport = async () => {
        throw new Error('ECONNREFUSED');
    };
    await assert.rejects(down.list(AUTH, {}), (err: { status: number }) => err.status === 502);
    const off = new JournalControl(() => null);
    await assert.rejects(off.access(AUTH), (err: { status: number }) => err.status === 404);
});

class FakeRes extends Writable {
    statusCode = 200;
    headers: Record<string, string> = {};
    chunks: Buffer[] = [];
    headersSent = false;
    destroyedWith: Error | null = null;
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
        // A slow browser: each chunk is taken a moment later.
        setTimeout(done, 1);
    }
    _destroy(err: Error | null, cb: (err?: Error | null) => void) {
        this.destroyedWith = err;
        cb();
    }
}

test('PDF passes Content-Type and Content-Disposition from OTS, drops cookies', async () => {
    const { control, seen } = fake(() => new Response('%PDF-1.7', {
        headers: {
            'content-type': 'application/pdf',
            'content-length': '8',
            'content-disposition': 'attachment; filename="dziennik-public-20261124.pdf"',
            'set-cookie': 'session=ots',
        },
    }));
    const res = new FakeRes();
    await control.export(AUTH, 'pdf', { since: '2026-11-24T00:00:00Z', page: 2, per_page: 10 }, res as unknown as ExpressResponse);
    assert.equal(seen[0].url, 'https://public-ots:8443/api/taklab/journal/export.pdf?since=2026-11-24T00%3A00%3A00.000Z&positions=0');
    assert.equal(seen[0].headers.Accept, 'application/pdf');
    assert.deepEqual(seen[0].auth, AUTH);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.equal(res.headers['content-length'], '8');
    assert.equal(res.headers['content-disposition'], 'attachment; filename="dziennik-public-20261124.pdf"');
    assert.equal(res.headers['set-cookie'], undefined);
    assert.equal(res.headers['x-accel-buffering'], 'no');
    assert.equal(Buffer.concat(res.chunks).toString(), '%PDF-1.7');
});

test('ZIP streams chunk by chunk at the browser pace without collecting the file', async () => {
    const CHUNK = 64 * 1024;
    const CHUNKS = 200; // 12.5 MB
    let pulled = 0;
    let maxAhead = 0;
    let res: FakeRes | null = null;
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (pulled >= CHUNKS) {
                controller.close();
                return;
            }
            pulled++;
            maxAhead = Math.max(maxAhead, pulled - (res?.chunks.length ?? 0));
            controller.enqueue(new Uint8Array(CHUNK).fill(pulled % 256));
        },
    }, { highWaterMark: 1 });
    const { control, seen } = fake(() => new Response(body, { headers: { 'content-type': 'application/zip' } }));
    res = new FakeRes({ highWaterMark: CHUNK });
    await control.export(AUTH, 'zip', { kind: 'recording_video', positions: true }, res as unknown as ExpressResponse);

    assert.equal(seen[0].url, 'https://public-ots:8443/api/taklab/journal/export.zip?kind=recording_video&positions=1');
    assert.equal(res.headers['content-type'], 'application/zip');
    assert.equal(res.headers['content-disposition'], 'attachment; filename="dziennik.zip"', 'default name when OTS sends none');
    assert.equal(res.chunks.reduce((n, c) => n + c.length, 0), CHUNK * CHUNKS);
    assert.ok(maxAhead < 40, `the proxy read at most a few chunks ahead of the browser (${maxAhead})`);
});

test('closing the browser cancels the OTS read', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            controller.enqueue(new Uint8Array(1024));
        },
        cancel() {
            cancelled = true;
        },
    });
    const { control } = fake(() => new Response(body, { headers: { 'content-type': 'application/zip' } }));
    const res = new FakeRes();
    const done = control.export(AUTH, 'zip', {}, res as unknown as ExpressResponse);
    await new Promise((r) => setTimeout(r, 20));
    res.destroy();
    await done;
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(cancelled);
});

test('PDF over the limit is a 413 before any byte; an OTS stream broken mid-way breaks the download', async () => {
    const { control } = fake(() => json({ message: 'too many' }, 413));
    const res = new FakeRes();
    await assert.rejects(control.export(AUTH, 'pdf', {}, res as unknown as ExpressResponse), (err: { status: number }) => err.status === 413);
    assert.equal(res.chunks.length, 0);

    let sent = 0;
    const broken = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (sent++ < 3) controller.enqueue(new Uint8Array(16));
            else controller.error(new Error('OTS pod restarted'));
        },
    });
    const { control: c2 } = fake(() => new Response(broken, { headers: { 'content-type': 'application/zip' } }));
    const res2 = new FakeRes();
    await c2.export(AUTH, 'zip', {}, res2 as unknown as ExpressResponse);
    assert.ok(res2.destroyedWith, 'connection cut, the browser does not keep a short ZIP as complete');
});
