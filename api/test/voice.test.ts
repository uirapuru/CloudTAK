import test from 'node:test';
import assert from 'node:assert';
import { VoiceControl } from '../stateless/lib/control/voice.js';

test('VoiceControl.query keeps only known filters and encodes them', () => {
    assert.equal(VoiceControl.query({}), '');
    assert.equal(
        VoiceControl.query({ channel: 'Pluton 1', since: 10, until: 20, ids: '1,2' }),
        '?channel=Pluton+1&since=10&until=20&ids=1%2C2',
    );
    assert.equal(
        VoiceControl.query({ channel: '', limit: 50, ...{ token: 'secret' } as object }),
        '?limit=50',
    );
});

test('VoiceControl without VOICE_URL reports disabled and calls nothing', async () => {
    delete process.env.VOICE_URL;
    process.env.VOICE_HISTORY_USERS = 'a@b';
    const control = new VoiceControl();
    let calls = 0;
    control.fetch = (async () => {
        calls++;
        return new Response('{}');
    }) as typeof fetch;
    assert.deepEqual(await control.status('a@b'), { enabled: false });
    await assert.rejects(control.recordings('a@b', {}), (err: { status: number }) => err.status === 404);
    assert.equal(calls, 0);
});

test('VoiceControl sends the shared token and the caller, never the browser token', async () => {
    process.env.VOICE_URL = 'http://voice.test:8080/';
    process.env.VOICE_TOKEN = 'shared';
    const control = new VoiceControl();
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    control.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        seen.push({ url: String(input), headers: init?.headers as Record<string, string> });
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as typeof fetch;

    process.env.VOICE_HISTORY_USERS = 'alfa@example.com';
    await control.recordings('alfa@example.com', { channel: 'A', limit: 10 });
    assert.equal(seen[0].url, 'http://voice.test:8080/api/v1/recordings?channel=A&limit=10');
    assert.deepEqual(seen[0].headers, { 'X-Voice-Token': 'shared', 'X-Voice-User': 'alfa@example.com' });
});

test('VoiceControl maps service errors', async () => {
    process.env.VOICE_URL = 'http://voice.test:8080';
    process.env.VOICE_HISTORY_USERS = 'a@b';
    const control = new VoiceControl();
    control.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;
    await assert.rejects(control.recordings('a@b', {}), (err: { status: number }) => err.status === 502);
    control.fetch = (async () => {
        throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    await assert.rejects(control.status('a@b'), (err: { status: number }) => err.status === 502);
});

test('history only for VOICE_HISTORY_USERS, status says so, nothing reaches the service otherwise', async () => {
    process.env.VOICE_URL = 'http://voice.test:8080';
    process.env.VOICE_HISTORY_USERS = ' Administrator , szef ';
    const control = new VoiceControl();
    const urls: string[] = [];
    control.fetch = (async (input: string | URL | Request) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ items: [], channels: [] }), { status: 200 });
    }) as typeof fetch;

    assert.equal(control.canSeeHistory('administrator'), true);
    assert.equal(control.canSeeHistory('SZEF'), true);
    assert.equal(control.canSeeHistory('operator'), false);
    await assert.rejects(control.recordings('operator', {}), (err: { status: number }) => err.status === 403);
    assert.deepEqual(urls, []);

    assert.equal((await control.status('operator')).history, false);
    assert.equal((await control.status('administrator')).history, true);

    delete process.env.VOICE_HISTORY_USERS;
    assert.equal(control.canSeeHistory('administrator'), false);
});

test('deleteRecordings: history accounts only, DELETE with ids, nothing sent otherwise', async () => {
    process.env.VOICE_URL = 'http://voice.test:8080';
    process.env.VOICE_HISTORY_USERS = 'administrator';
    const control = new VoiceControl();
    const calls: Array<{ url: string; method?: string }> = [];
    control.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), method: init?.method });
        return new Response(JSON.stringify({ deleted: 2 }), { status: 200 });
    }) as typeof fetch;

    await assert.rejects(control.deleteRecordings('operator', '1,2'), (err: { status: number }) => err.status === 403);
    await assert.rejects(control.deleteRecordings('administrator', '1;drop'), (err: { status: number }) => err.status === 400);
    assert.deepEqual(calls, []);

    assert.deepEqual(await control.deleteRecordings('administrator', '1,2'), { deleted: 2 });
    assert.deepEqual(calls, [{ url: 'http://voice.test:8080/api/v1/recordings?ids=1%2C2', method: 'DELETE' }]);
});
