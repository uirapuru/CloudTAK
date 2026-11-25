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

// Every field of the report service's public(order), each one set.
const ORDER = {
    id: ID,
    status: 'failed',
    error: 'Model nie wstał w ciągu 4 minut.',
    created: '2026-11-25T08:00:01Z',
    finished: '2026-11-25T08:04:09Z',
    owner: 'admin@example.com',
    format: 'docx',
    title: 'Natarcie na Kijewo',
    start: '2026-11-26T05:00:00Z',
    has_location: true,
    weather_ok: false,
    terrain_ok: true,
    phase: 'images',
    attachments: 3,
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

test('AI: start the fake report service', async () => {
    await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
    process.env.REPORT_TOKEN = 'shared-report-token';
});

test('AI: without a session every route answers 401 and calls nothing', async () => {
    process.env.REPORT_URL = `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
    for (const [method, path] of [
        ['GET', '/api/ai/model'],
        ['POST', '/api/ai/model/start'],
        ['POST', '/api/ai/model/stop'],
        ['GET', '/api/ai/orders'],
        ['POST', '/api/ai/orders'],
        ['GET', `/api/ai/orders/${ID}`],
        ['GET', `/api/ai/orders/${ID}.pdf`],
        ['GET', `/api/ai/orders/${ID}.docx`],
        ['DELETE', `/api/ai/orders/${ID}`],
    ]) {
        const res = await fetch(new URL(path, flight.base), { method });
        assert.equal(res.status, 401, `${method} ${path}`);
    }
    assert.equal(seen.length, 0);
});

test('AI: without REPORT_URL the feature is off', async () => {
    delete process.env.REPORT_URL;
    const res = await flight.fetch('/api/ai/model', { method: 'GET', auth: { bearer: flight.token.admin } }, false);
    assert.equal(res.status, 404);
    assert.equal(res.body.message, 'Chat AI nie jest włączony');
    process.env.REPORT_URL = `http://127.0.0.1:${(service.address() as AddressInfo).port}/`;
});

test('AI: model state goes to the service with its token and the session account', async () => {
    reply = (_s, res) => json(res, 200, { state: 'ready', pinned: true, reason: null, internal: 'x' });
    const res = await flight.fetch('/api/ai/model', {
        method: 'GET',
        auth: { bearer: flight.token.admin },
        headers: { 'X-Report-User': 'administrator', 'X-Report-Token': 'from-browser' },
    }, true);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { state: 'ready', pinned: true, reason: null });

    const s = last();
    assert.equal(s.method, 'GET');
    assert.equal(s.url, '/api/v1/ai/model');
    assert.equal(s.headers['x-report-token'], 'shared-report-token');
    assert.equal(s.headers['x-report-user'], 'admin@example.com', 'account from the session, never from the browser');
    assert.equal(s.headers.authorization, undefined, 'the CloudTAK token stays in CloudTAK');
});

test('AI: start and stop the model', async () => {
    reply = (s, res) => json(res, 200, s.url.endsWith('/start')
        ? { result: 'refused', reason: 'Miesięczny pułap kosztów maszyny modelu jest wyczerpany.' }
        : { result: 'already_stopped' });

    const start = await flight.fetch('/api/ai/model/start', {
        method: 'POST',
        auth: { bearer: flight.token.admin },
        headers: { 'X-Report-User': 'administrator' },
    }, true);
    assert.deepEqual(start.body, { result: 'refused', reason: 'Miesięczny pułap kosztów maszyny modelu jest wyczerpany.' });
    assert.equal(last().method, 'POST');
    assert.equal(last().url, '/api/v1/ai/model/start');
    assert.equal(last().headers['x-report-user'], 'admin@example.com');

    const stop = await flight.fetch('/api/ai/model/stop', { method: 'POST', auth: { bearer: flight.token.admin } }, true);
    assert.deepEqual(stop.body, { result: 'already_stopped' });
    assert.equal(last().method, 'POST');
    assert.equal(last().url, '/api/v1/ai/model/stop');
});

test('AI: POST order sends contract fields only, with the session account', async () => {
    reply = (_s, res) => json(res, 202, { id: ID, status: 'queued' });
    const res = await flight.fetch('/api/ai/orders', {
        method: 'POST',
        auth: { bearer: flight.token.admin },
        headers: { 'X-Report-User': 'administrator' },
        body: {
            text: 'Przeciwnik: pluton w Kijewie. Zadanie: opanować skrzyżowanie.',
            format: 'docx',
            title: 'Natarcie na Kijewo',
            start: '2026-11-26T06:00:00+01:00',
            route: [[17.03, 51.10], [17.05, 51.12]],
            owner: 'administrator',
        },
    }, true);

    assert.equal(res.status, 202);
    assert.deepEqual(res.body, { id: ID, status: 'queued' });

    const s = last();
    assert.equal(s.method, 'POST');
    assert.equal(s.url, '/api/v1/orders');
    assert.equal(s.headers['x-report-user'], 'admin@example.com');
    assert.equal(s.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(s.body), {
        text: 'Przeciwnik: pluton w Kijewie. Zadanie: opanować skrzyżowanie.',
        format: 'docx',
        title: 'Natarcie na Kijewo',
        start: '2026-11-26T06:00:00+01:00',
        route: [[17.03, 51.10], [17.05, 51.12]],
    });

    reply = (_s, res) => json(res, 202, { id: ID, status: 'queued' });
    await flight.fetch('/api/ai/orders', {
        method: 'POST',
        auth: { bearer: flight.token.admin },
        body: { text: 'Dane.', format: 'pdf', location: [17.03, 51.1] },
    }, true);
    assert.deepEqual(JSON.parse(last().body), { text: 'Dane.', format: 'pdf', location: [17.03, 51.1] });
});

test('AI: POST order rejects bad bodies before the service', async () => {
    const before = seen.length;
    for (const body of [
        { text: '', format: 'pdf' },
        { text: 'x'.repeat(20001), format: 'pdf' },
        { text: 'Dane.', format: 'txt' },
        { text: 'Dane.', format: 'pdf', title: 'x'.repeat(121) },
        { text: 'Dane.', format: 'pdf', location: [200, 51] },
        { text: 'Dane.', format: 'pdf', route: [[17, 51]] },
        { text: 'Dane.', format: 'pdf', location: [17, 51], route: [[17, 51], [17.1, 51.1]] },
    ]) {
        const res = await flight.fetch('/api/ai/orders', {
            method: 'POST',
            auth: { bearer: flight.token.admin },
            body,
        }, false);
        assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    }
    assert.equal(seen.length, before);
});

function orderForm(files: Array<[string, string]>, order: unknown = { text: 'Dane z załączników.', format: 'pdf' }): FormData {
    const form = new FormData();
    form.append('order', JSON.stringify(order));
    for (const [name, content] of files) form.append('files', new Blob([content], { type: 'text/plain' }), name);
    return form;
}

test('AI: POST order with attachments streams the multipart body to the service', async () => {
    reply = (_s, res) => json(res, 202, { id: ID, status: 'queued', attachments: 2 });
    const res = await fetch(new URL('/api/ai/orders', flight.base), {
        method: 'POST',
        headers: { authorization: `Bearer ${flight.token.admin}`, 'X-Report-User': 'administrator' },
        body: orderForm([['meldunek.txt', 'Most 205, godzina 0430'], ['mapa.kml', '<kml/>']]),
    });
    assert.equal(res.status, 202);
    const created = await res.json() as { id: string; status: string };
    assert.equal(created.id, ID);
    assert.equal(created.status, 'queued');

    const s = last();
    assert.equal(s.method, 'POST');
    assert.equal(s.url, '/api/v1/orders');
    assert.equal(s.headers['x-report-user'], 'admin@example.com', 'account from the session, never from the browser');
    assert.equal(s.headers['x-report-token'], 'shared-report-token');
    assert.equal(s.headers.authorization, undefined);
    assert.match(String(s.headers['content-type']), /^multipart\/form-data; boundary=/);
    assert.ok(s.body.includes('name="order"'));
    assert.ok(s.body.includes('"text":"Dane z załączników."'));
    assert.ok(s.body.includes('filename="meldunek.txt"'));
    assert.ok(s.body.includes('Most 205, godzina 0430'));
    assert.ok(s.body.includes('filename="mapa.kml"'));
});

test('AI: multipart order without a session or over the size limit never reaches the service', async () => {
    const before = seen.length;
    const anonymous = await fetch(new URL('/api/ai/orders', flight.base), { method: 'POST', body: orderForm([['a.txt', 'x']]) });
    assert.equal(anonymous.status, 401);

    const declared = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const url = new URL('/api/ai/orders', flight.base);
        // A fresh connection each: a request with an unread body must not leave its socket for the next test.
        const req = http.request(url, {
            method: 'POST',
            agent: false,
            headers: {
                authorization: `Bearer ${flight.token.admin}`,
                'content-type': 'multipart/form-data; boundary=xyz',
                'content-length': String(52 * 1024 * 1024 + 1),
            },
        }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                req.destroy();
                resolve({ status: res.statusCode || 0, body });
            });
        });
        req.on('error', reject);
        req.end('--xyz--\r\n');
    });
    assert.equal(declared.status, 413);
    assert.equal(JSON.parse(declared.body).message, 'Pliki razem mogą mieć najwyżej 50 MB.');
    assert.equal(seen.length, before);
});

test('AI: a streamed multipart body above the limit is cut off with 413', async () => {
    reply = (_s, res) => json(res, 202, { id: ID, status: 'queued' });
    const chunk = Buffer.alloc(1024 * 1024, 120);
    const status = await new Promise<number>((resolve, reject) => {
        const url = new URL('/api/ai/orders', flight.base);
        // A fresh connection each: a request with an unread body must not leave its socket for the next test.
        const req = http.request(url, {
            method: 'POST',
            agent: false,
            headers: {
                authorization: `Bearer ${flight.token.admin}`,
                // No content-length: Node sends the body chunked, so only the byte count can stop it.
                'content-type': 'multipart/form-data; boundary=xyz',
            },
        }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => req.destroy());
            res.on('end', () => resolve(res.statusCode === 413 && JSON.parse(body).message === 'Pliki razem mogą mieć najwyżej 50 MB.' ? 413 : res.statusCode || 0));
        });
        req.on('error', () => resolve(-1));
        let sent = 0;
        const write = () => {
            while (sent < 60) {
                sent++;
                if (!req.write(chunk)) {
                    req.once('drain', write);
                    return;
                }
            }
            req.end();
        };
        write();
        setTimeout(() => reject(new Error('no answer')), 60_000).unref();
    });
    // 413 from CloudTAK; -1 when the server hangs up before the client finished writing.
    assert.ok([413, -1].includes(status), String(status));
});

test('AI: 413 from the service passes with its Polish message', async () => {
    reply = (_s, res) => json(res, 413, { detail: 'too_many_attachments', error: 'Do rozkazu możesz dołączyć najwyżej 10 plików.' });
    const res = await fetch(new URL('/api/ai/orders', flight.base), {
        method: 'POST',
        headers: { authorization: `Bearer ${flight.token.admin}` },
        body: orderForm([['a.txt', 'x']]),
    });
    assert.equal(res.status, 413);
    assert.equal((await res.json() as { message: string }).message, 'Do rozkazu możesz dołączyć najwyżej 10 plików.');
});

test('AI: other content types are refused before the service', async () => {
    const before = seen.length;
    const res = await fetch(new URL('/api/ai/orders', flight.base), {
        method: 'POST',
        headers: { authorization: `Bearer ${flight.token.admin}`, 'content-type': 'text/plain' },
        body: 'Dane.',
    });
    assert.equal(res.status, 400);
    assert.equal(seen.length, before);
});

test('AI: list and one order keep every field', async () => {
    reply = (s, res) => (s.url === '/api/v1/orders'
        ? json(res, 200, { items: [{ ...ORDER, text: 'tajne dane' }, { ...ORDER, id: 'f'.repeat(32), status: 'queued', error: null, finished: null, title: null, weather_ok: null, terrain_ok: null }] })
        : json(res, 200, { ...ORDER, text: 'tajne dane' }));

    const list = await flight.fetch('/api/ai/orders', { method: 'GET', auth: { bearer: flight.token.admin } }, true);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.items[0], ORDER);
    assert.deepEqual(list.body.items[1], { ...ORDER, id: 'f'.repeat(32), status: 'queued', error: null, finished: null, title: null, weather_ok: null, terrain_ok: null });
    assert.equal(last().headers['x-report-user'], 'admin@example.com');

    const one = await flight.fetch(`/api/ai/orders/${ID}`, { method: 'GET', auth: { bearer: flight.token.admin } }, true);
    assert.deepEqual(one.body, ORDER);
    assert.equal(last().url, `/api/v1/orders/${ID}`);
});

test('AI: files download with the token in the address, which never reaches the service', async () => {
    const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    reply = (s, res) => {
        const pdf = s.url.endsWith('.pdf');
        res.writeHead(200, {
            'content-type': pdf ? 'application/pdf' : DOCX,
            'content-disposition': `attachment; filename=rozkaz-test.${pdf ? 'pdf' : 'docx'}`,
            'x-internal': 'secret',
        }).end(pdf ? '%PDF-1.7 rozkaz' : 'PK rozkaz');
    };

    const pdf = await fetch(new URL(`/api/ai/orders/${ID}.pdf?token=${flight.token.admin}`, flight.base));
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(pdf.headers.get('content-disposition'), 'attachment; filename=rozkaz-test.pdf');
    assert.equal(pdf.headers.get('x-internal'), null);
    assert.equal(await pdf.text(), '%PDF-1.7 rozkaz');
    assert.equal(last().url, `/api/v1/orders/${ID}.pdf`);
    assert.equal(last().headers['x-report-user'], 'admin@example.com');

    const docx = await fetch(new URL(`/api/ai/orders/${ID}.docx?token=${flight.token.admin}`, flight.base));
    assert.equal(docx.status, 200);
    assert.equal(docx.headers.get('content-type'), DOCX);
    assert.equal(await docx.text(), 'PK rozkaz');
    assert.equal(last().url, `/api/v1/orders/${ID}.docx`);
});

test('AI: DELETE goes to the service', async () => {
    reply = (_s, res) => json(res, 200, { deleted: true });
    const res = await flight.fetch(`/api/ai/orders/${ID}`, { method: 'DELETE', auth: { bearer: flight.token.admin } }, true);
    assert.deepEqual(res.body, { deleted: true });
    assert.equal(last().method, 'DELETE');
    assert.equal(last().url, `/api/v1/orders/${ID}`);
});

test('AI: a malformed id never reaches the service', async () => {
    const before = seen.length;
    for (const path of ['/api/ai/orders/..%2Fhealthz', '/api/ai/orders/abc.pdf', '/api/ai/orders/abc.docx', '/api/ai/orders/ABC']) {
        const res = await fetch(new URL(`${path}?token=${flight.token.admin}`, flight.base), {
            headers: { authorization: `Bearer ${flight.token.admin}` },
        });
        assert.ok([400, 404].includes(res.status), `${path}: ${res.status}`);
    }
    assert.equal(seen.length, before);
});

test('AI: service errors keep their status and Polish message; others become 502', async () => {
    for (const [status, error] of [
        [400, 'Tekst rozkazu jest pusty.'],
        [403, 'Tylko administrator OTS może korzystać z Chat AI.'],
        [404, 'Nie ma takiego rozkazu.'],
        [409, 'Rozkaz nie jest jeszcze gotowy.'],
        [429, 'Masz już 2 rozkazy w kolejce.'],
        [503, 'Model AI nie jest skonfigurowany w tym środowisku.'],
    ] as const) {
        reply = (_s, res) => json(res, status, { detail: 'code', error });
        const res = await flight.fetch('/api/ai/model', { method: 'GET', auth: { bearer: flight.token.admin } }, false);
        assert.equal(res.status, status);
        assert.equal(res.body.message, error);
    }

    for (const [status, fallback] of [
        [400, 'Nieprawidłowe zamówienie rozkazu.'],
        [403, 'Chat AI jest dostępny tylko dla administratora.'],
        [404, 'Nie ma takiego rozkazu.'],
        [409, 'Rozkaz nie jest jeszcze gotowy.'],
        [429, 'Masz już 2 rozkazy w kolejce. Poczekaj, aż któryś się skończy.'],
        [503, 'Model AI jest chwilowo niedostępny.'],
    ] as const) {
        reply = (_s, res) => json(res, status, { detail: 'admin_only', error: null });
        const res = await flight.fetch('/api/ai/orders', { method: 'GET', auth: { bearer: flight.token.admin } }, false);
        assert.equal(res.status, status);
        assert.equal(res.body.message, fallback);
    }

    for (const status of [401, 500]) {
        reply = (_s, res) => json(res, status, { detail: 'x', error: 'wewnętrzny' });
        const res = await flight.fetch('/api/ai/orders', { method: 'GET', auth: { bearer: flight.token.admin } }, false);
        assert.equal(res.status, 502);
    }
});

test('AI: a browser leaving a download closes the request to the service', async () => {
    let closed!: () => void;
    const upstreamClosed = new Promise<void>((resolve) => { closed = resolve; });
    reply = (_s, res) => {
        res.on('close', () => closed());
        res.writeHead(200, { 'content-type': 'application/pdf' });
        // First part only; the rest never comes until someone hangs up.
        res.write('%PDF-1.7 ');
    };

    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { logged.push(args); };
    const abort = new AbortController();
    const pdf = await fetch(new URL(`/api/ai/orders/${ID}.pdf?token=${flight.token.admin}`, flight.base), { signal: abort.signal });
    assert.equal(pdf.status, 200);
    const reader = pdf.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), '%PDF-1.7 ');
    abort.abort();

    await Promise.race([
        upstreamClosed,
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('the service request stayed open')), 5_000)),
    ]).finally(() => { console.error = original; });
    assert.deepEqual(logged.filter((a) => String(a[0]).startsWith('Order download broken')), []);
});

test('AI: a service failure in the middle of a file breaks the download and is logged without secrets', async () => {
    reply = (_s, res) => {
        res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': '1000' });
        res.write('%PDF-1.7 początek');
        setTimeout(() => res.socket?.destroy(), 50);
    };

    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { logged.push(args); };
    try {
        const pdf = await fetch(new URL(`/api/ai/orders/${ID}.pdf?token=${flight.token.admin}`, flight.base));
        assert.equal(pdf.status, 200);
        const started = Date.now();
        await assert.rejects(pdf.text());
        assert.ok(Date.now() - started < 2_000, `the broken download took ${Date.now() - started} ms`);
        await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
        console.error = original;
    }
    const lines = logged.map((a) => a.map(String).join(' ')).filter((l) => l.startsWith('Order download broken'));
    assert.equal(lines.length, 1, JSON.stringify(logged));
    for (const secret of ['shared-report-token', flight.token.admin, '/api/v1/orders', '127.0.0.1']) {
        assert.ok(!lines[0].includes(secret), lines[0]);
    }
});

test('AI: without REPORT_TOKEN CloudTAK says the service is not configured and calls nothing', async () => {
    const before = seen.length;
    const token = process.env.REPORT_TOKEN;
    process.env.REPORT_TOKEN = '';
    try {
        const res = await flight.fetch('/api/ai/model', { method: 'GET', auth: { bearer: flight.token.admin } }, false);
        assert.equal(res.status, 502);
        assert.equal(res.body.message, 'Usługa raportów nie jest skonfigurowana.');
        assert.equal(seen.length, before);
    } finally {
        process.env.REPORT_TOKEN = token;
    }
});

test('AI: stop the fake report service', async () => {
    delete process.env.REPORT_URL;
    delete process.env.REPORT_TOKEN;
    await new Promise<void>((resolve) => service.close(() => resolve()));
});

flight.landing();
