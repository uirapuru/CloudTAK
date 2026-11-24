// Wysokość punktu: atrapa usługi terenu przez http.createServer, bez Postgresa.
import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { taklabElevation, resolveElevation, formatElevation } from '../stateless/lib/taklab-elevation.js';

type Mode = 'ok' | 'null' | 'error422' | 'badjson' | 'hang';

let mode: Mode = 'ok';
const requests: Array<{ method: string; url: string; body: unknown }> = [];

const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
        requests.push({ method: String(req.method), url: String(req.url), body: raw ? JSON.parse(raw) : null });
        if (mode === 'hang') return;
        const send = (status: number, text: string) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json');
            res.end(text);
        };
        if (mode === 'ok') return send(200, JSON.stringify({ elevations: [239.0] }));
        if (mode === 'null') return send(200, JSON.stringify({ elevations: [null] }));
        if (mode === 'error422') return send(422, JSON.stringify({ detail: 'zle' }));
        send(200, '<html>bramka</html>');
    });
});

let url = '';
test.before(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.after(() => { server.close(); server.closeAllConnections(); });
test.beforeEach(() => { requests.length = 0; mode = 'ok'; });

test('taklabElevation posts the point and returns metres', async () => {
    assert.strictEqual(await taklabElevation(url + '/', 17.03, 51.11), 239);
    assert.deepStrictEqual(requests[0], { method: 'POST', url: '/elevation', body: { points: [[17.03, 51.11]] } });
});

test('taklabElevation returns null when the service has no data', async () => {
    mode = 'null';
    assert.strictEqual(await taklabElevation(url, 0, 0), null);
});

test('taklabElevation throws on non-2xx and bad JSON', async () => {
    mode = 'error422';
    await assert.rejects(taklabElevation(url, 0, 0));
    mode = 'badjson';
    await assert.rejects(taklabElevation(url, 0, 0));
});

test('taklabElevation times out', async () => {
    mode = 'hang';
    await assert.rejects(taklabElevation(url, 0, 0, 200));
});

test('elevation comes from taklab terrain when configured', async () => {
    assert.strictEqual(await resolveElevation(url, 17, 51, 100), 239);
    assert.strictEqual(formatElevation(239, 'meter'), '239.00 m');
});

test('no terrain url: client value is true metres, not divided by 1.5', async () => {
    assert.strictEqual(await resolveElevation('', 17, 51, 100), 100);
    assert.strictEqual(formatElevation(100, 'meter'), '100.00 m');
    assert.strictEqual(formatElevation(100, 'feet'), '328.08 ft');
    assert.strictEqual(formatElevation(100, 'FEET'), '328.08 ft');
});

test('service says no data: null, not the client value', async () => {
    mode = 'null';
    assert.strictEqual(await resolveElevation(url, 17, 51, 100), null);
});

test('service error or timeout falls back to client value', async () => {
    mode = 'error422';
    assert.strictEqual(await resolveElevation(url, 17, 51, 100), 100);
    mode = 'hang';
    assert.strictEqual(await resolveElevation(url, 17, 51, 100, 200), 100);
});

test('nothing at all gives null', async () => {
    assert.strictEqual(await resolveElevation('', 17, 51, undefined), null);
    assert.strictEqual(formatElevation(null, 'meter'), null);
});
