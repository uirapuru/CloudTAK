import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Flight from './flight.js';

const flight = new Flight();

flight.init({ takserver: true });
flight.takeoff();
flight.user();

const ID = '0123456789abcdef0123456789abcdef';

// Every field of the report service's public(job), each one set.
const JOB = {
    id: ID,
    scope: 'mission',
    mission: 'Ćwiczenie Wilk',
    since: '2026-11-23T08:00:00Z',
    until: '2026-11-24T08:00:00Z',
    status: 'failed',
    error: 'Złe hasło feedu.',
    created: '2026-11-24T08:00:01Z',
    finished: '2026-11-24T08:00:09Z',
    owner: 'admin@example.com',
};

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };

const seen: Seen[] = [];
let reply: (s: Seen, res: http.ServerResponse) => void = (_s, res) => {
    res.writeHead(500).end();
};

const service = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
        const s = { method: req.method || '', url: req.url || '', headers: req.headers, body };
        seen.push(s);
        reply(s, res);
    });
});

function json(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function last(): Seen {
    const s = seen.at(-1);
    assert.ok(s, 'the report service was called');
    return s;
}

test('Report: start the fake report service', async () => {
    await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
    process.env.REPORT_TOKEN = 'shared-report-token';
});

test('Report: without a session every route answers 401 and calls nothing', async () => {
    process.env.REPORT_URL = `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
    for (const [method, path] of [
        ['GET', '/api/report'],
        ['POST', '/api/report'],
        ['GET', `/api/report/${ID}`],
        ['GET', `/api/report/${ID}.pdf`],
        ['GET', `/api/report/${ID}.txt`],
        ['DELETE', `/api/report/${ID}`],
    ]) {
        const res = await fetch(new URL(path, flight.base), { method });
        assert.equal(res.status, 401, `${method} ${path}`);
    }
    assert.equal(seen.length, 0);
});

test('Report: without REPORT_URL the feature is off', async () => {
    delete process.env.REPORT_URL;
    const res = await flight.fetch('/api/report', { method: 'GET', auth: { bearer: flight.token.admin } }, false);
    assert.equal(res.status, 404);
    assert.equal(res.body.message, 'Raport misji nie jest włączony');
    process.env.REPORT_URL = `http://127.0.0.1:${(service.address() as AddressInfo).port}/`;
});

test('Report: POST sends contract fields with the service token and the session account', async () => {
    reply = (_s, res) => json(res, 202, { id: ID, status: 'queued' });
    const res = await flight.fetch('/api/report', {
        method: 'POST',
        auth: { bearer: flight.token.admin },
        headers: { 'X-Report-User': 'administrator', 'X-Report-Token': 'from-browser' },
        body: {
            scope: 'mission',
            mission: 'Ćwiczenie Wilk',
            mission_password: 'tajne',
            since: '2026-11-23T08:00:00+01:00',
            until: '2026-11-24T08:00:00+01:00',
            basemap: 'polska50k',
            owner: 'administrator',
        },
    }, true);

    assert.equal(res.status, 202);
    assert.deepEqual(res.body, { id: ID, status: 'queued' });

    const s = last();
    assert.equal(s.method, 'POST');
    assert.equal(s.url, '/api/v1/reports');
    assert.equal(s.headers['x-report-token'], 'shared-report-token');
    assert.equal(s.headers['x-report-user'], 'admin@example.com', 'account from the session, never from the browser');
    assert.equal(s.headers.authorization, undefined, 'the CloudTAK token stays in CloudTAK');
    assert.deepEqual(JSON.parse(s.body), {
        scope: 'mission',
        mission: 'Ćwiczenie Wilk',
        mission_password: 'tajne',
        since: '2026-11-23T08:00:00+01:00',
        until: '2026-11-24T08:00:00+01:00',
        basemap: 'polska50k',
    });
});

test('Report: POST rejects an unknown scope before the service', async () => {
    const before = seen.length;
    const res = await flight.fetch('/api/report', {
        method: 'POST',
        auth: { bearer: flight.token.admin },
        body: { scope: 'everything', since: '2026-11-23T08:00:00Z', until: '2026-11-24T08:00:00Z' },
    }, false);
    assert.equal(res.status, 400);
    assert.equal(seen.length, before);
});

test('Report: list and one report keep every job field', async () => {
    reply = (s, res) => (s.url === '/api/v1/reports'
        ? json(res, 200, { items: [{ ...JOB, basemap: 'osm' }, { ...JOB, id: 'f'.repeat(32), scope: 'environment', mission: null, status: 'queued', error: null, finished: null }] })
        : json(res, 200, { ...JOB, basemap: 'osm' }));

    const list = await flight.fetch('/api/report', { method: 'GET', auth: { bearer: flight.token.admin } }, true);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.items[0], JOB);
    assert.deepEqual(list.body.items[1], { ...JOB, id: 'f'.repeat(32), scope: 'environment', mission: null, status: 'queued', error: null, finished: null });
    assert.equal(last().headers['x-report-user'], 'admin@example.com');

    const one = await flight.fetch(`/api/report/${ID}`, { method: 'GET', auth: { bearer: flight.token.admin } }, true);
    assert.deepEqual(one.body, JOB);
    assert.equal(last().url, `/api/v1/reports/${ID}`);
});

test('Report: files download with the token in the address, which never reaches the service', async () => {
    reply = (s, res) => {
        const pdf = s.url.endsWith('.pdf');
        res.writeHead(200, {
            'content-type': pdf ? 'application/pdf' : 'text/plain; charset=utf-8',
            'content-disposition': `attachment; filename=raport-test.${pdf ? 'pdf' : 'txt'}`,
            'x-internal': 'secret',
        }).end(pdf ? '%PDF-1.7 raport' : 'Raport misji');
    };

    const pdf = await fetch(new URL(`/api/report/${ID}.pdf?token=${flight.token.admin}`, flight.base));
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(pdf.headers.get('content-disposition'), 'attachment; filename=raport-test.pdf');
    assert.equal(pdf.headers.get('x-internal'), null);
    assert.equal(await pdf.text(), '%PDF-1.7 raport');
    assert.equal(last().url, `/api/v1/reports/${ID}.pdf`);
    assert.equal(last().headers['x-report-user'], 'admin@example.com');

    const txt = await fetch(new URL(`/api/report/${ID}.txt?token=${flight.token.admin}`, flight.base));
    assert.equal(txt.status, 200);
    assert.equal(await txt.text(), 'Raport misji');
    assert.equal(last().url, `/api/v1/reports/${ID}.txt`);
});

test('Report: DELETE goes to the service', async () => {
    reply = (_s, res) => json(res, 200, { deleted: true });
    const res = await flight.fetch(`/api/report/${ID}`, { method: 'DELETE', auth: { bearer: flight.token.admin } }, true);
    assert.deepEqual(res.body, { deleted: true });
    assert.equal(last().method, 'DELETE');
    assert.equal(last().url, `/api/v1/reports/${ID}`);
});

test('Report: a malformed id never reaches the service', async () => {
    const before = seen.length;
    for (const path of ['/api/report/..%2Fhealthz', '/api/report/abc.pdf', '/api/report/ABC']) {
        const res = await fetch(new URL(`${path}?token=${flight.token.admin}`, flight.base), {
            headers: { authorization: `Bearer ${flight.token.admin}` },
        });
        assert.ok([400, 404].includes(res.status), `${path}: ${res.status}`);
    }
    assert.equal(seen.length, before);
});

test('Report: service errors keep their status and Polish message; others become 502', async () => {
    for (const [status, error] of [
        [400, 'Przedział może mieć najwyżej 7 dni.'],
        [404, 'Nie ma takiego raportu.'],
        [409, 'Raport nie jest jeszcze gotowy.'],
        [429, 'Masz już 3 raporty w kolejce. Poczekaj, aż któryś się skończy.'],
        [503, 'Usługa chwilowo niedostępna.'],
    ] as const) {
        reply = (_s, res) => json(res, status, { detail: 'code', error });
        const res = await flight.fetch(`/api/report/${ID}`, { method: 'GET', auth: { bearer: flight.token.admin } }, false);
        assert.equal(res.status, status);
        assert.equal(res.body.message, error);
    }

    reply = (_s, res) => json(res, 400, { detail: 'invalid_user', error: null });
    const fallback = await flight.fetch('/api/report', { method: 'GET', auth: { bearer: flight.token.admin } }, false);
    assert.equal(fallback.status, 400);
    assert.equal(fallback.body.message, 'Nieprawidłowe zamówienie raportu.');

    for (const status of [401, 500]) {
        reply = (_s, res) => json(res, status, { detail: 'x', error: 'wewnętrzny' });
        const res = await flight.fetch('/api/report', { method: 'GET', auth: { bearer: flight.token.admin } }, false);
        assert.equal(res.status, 502);
    }
});

test('Report: stop the fake report service', async () => {
    delete process.env.REPORT_URL;
    delete process.env.REPORT_TOKEN;
    await new Promise<void>((resolve) => service.close(() => resolve()));
});

flight.landing();
