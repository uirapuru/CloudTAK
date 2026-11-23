import test from 'node:test';
import assert from 'node:assert';
import type { AddressInfo } from 'node:net';
import * as ws from 'ws';
import type WebSocket from 'ws';
import { isVoiceUpgrade } from '../common/voice-path.js';
import { openRelay } from '../stateless/lib/control/voice-ws.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wsModule = ws as any;
const WebSocketServer = wsModule.WebSocketServer ?? wsModule.default.WebSocketServer;
const WebSocketClient = wsModule.WebSocket ?? wsModule.default;

test('isVoiceUpgrade matches only the voice path', () => {
    assert.equal(isVoiceUpgrade('/api/voice/ws?token=x'), true);
    assert.equal(isVoiceUpgrade('/api/voice/ws'), true);
    assert.equal(isVoiceUpgrade('/api?format=geojson&token=x'), false);
    assert.equal(isVoiceUpgrade('/api/voice/ws/../x'), false);
    assert.equal(isVoiceUpgrade(undefined), false);
});

test('openRelay passes text and binary both ways with the shared token', async () => {
    const seenHeaders: string[] = [];
    const upstream = new WebSocketServer({ port: 0 });
    upstream.on('connection', (sock: WebSocket, req: { headers: Record<string, string> }) => {
        seenHeaders.push(req.headers['x-voice-token']);
        sock.send(JSON.stringify({ type: 'hello' }));
        sock.on('message', (data: WebSocket.RawData, binary: boolean) => sock.send(data, { binary }));
    });
    const upPort = (upstream.address() as AddressInfo).port;

    const front = new WebSocketServer({ port: 0 });
    front.on('connection', (sock: WebSocket) => openRelay(sock, `ws://127.0.0.1:${upPort}/api/v1/ws`, 'shared'));
    const frontPort = (front.address() as AddressInfo).port;

    const browser: WebSocket = new WebSocketClient(`ws://127.0.0.1:${frontPort}`);
    const received: Array<{ binary: boolean; text: string }> = [];
    const done = new Promise<void>((resolve) => {
        browser.on('message', (data: WebSocket.RawData, binary: boolean) => {
            received.push({ binary, text: binary ? String((data as Buffer).length) : (data as Buffer).toString() });
            if (received.length === 3) resolve();
        });
    });
    // Sent before the relay reached the service: must not be lost.
    browser.on('open', () => {
        browser.send(JSON.stringify({ type: 'listen', channel: 'A' }));
        browser.send(Buffer.alloc(1920), { binary: true });
    });
    await done;

    assert.deepEqual(seenHeaders, ['shared']);
    assert.deepEqual(received, [
        { binary: false, text: '{"type":"hello"}' },
        { binary: false, text: '{"type":"listen","channel":"A"}' },
        { binary: true, text: '1920' },
    ]);

    const closed = new Promise<void>(resolve => browser.on('close', () => resolve()));
    for (const c of upstream.clients) (c as WebSocket).close();
    await closed;
    browser.terminate();
    front.close();
    upstream.close();
});
