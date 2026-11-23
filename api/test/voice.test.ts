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

    await control.recordings('alfa@example.com', { channel: 'A', limit: 10 });
    assert.equal(seen[0].url, 'http://voice.test:8080/api/v1/recordings?channel=A&limit=10');
    assert.deepEqual(seen[0].headers, { 'X-Voice-Token': 'shared', 'X-Voice-User': 'alfa@example.com' });
});

test('VoiceControl maps service errors', async () => {
    process.env.VOICE_URL = 'http://voice.test:8080';
    const control = new VoiceControl();
    control.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;
    await assert.rejects(control.recordings('a@b', {}), (err: { status: number }) => err.status === 502);
    control.fetch = (async () => {
        throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    await assert.rejects(control.status('a@b'), (err: { status: number }) => err.status === 502);
});
