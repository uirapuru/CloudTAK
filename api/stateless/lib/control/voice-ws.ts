import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import * as ws from 'ws';
import type WebSocket from 'ws';
import type ConfigStateless from '../../config.js';
import ProfileControl from './profile.js';
import { tokenParser, AuthUser } from '../../../common/auth.js';
import { isVoiceUpgrade } from '../../../common/voice-path.js';
import { voiceControl } from './voice.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wsModule = ws as any;
const WebSocketServer = wsModule.WebSocketServer ?? wsModule.default.WebSocketServer;
const WebSocketClient = wsModule.WebSocket ?? wsModule.default;

/** 0,5 s of 48 kHz 16-bit mono is the largest microphone frame the service accepts. */
const MAX_PAYLOAD = 64 * 1024;
/** Callsign of a profile that has not been set up yet (CloudTAK default). */
export const DEFAULT_CALLSIGN = 'CloudTAK User';

/** Messages sent by the browser before the service socket opened. */
const MAX_PENDING = 100;

function reject(socket: Duplex, status: string): void {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
}

/**
 * Relay one browser socket to the voice service of the environment. The
 * service gets the shared token and the caller's callsign; the browser token
 * never leaves CloudTAK.
 */
export function openRelay(client: WebSocket, url: string, token: string): WebSocket {
    const upstream: WebSocket = new WebSocketClient(url, { headers: { 'X-Voice-Token': token } });
    const pending: Array<{ data: WebSocket.RawData; binary: boolean }> = [];

    client.on('message', (data: WebSocket.RawData, binary: boolean) => {
        if (upstream.readyState === WebSocketClient.OPEN) {
            upstream.send(data, { binary });
        } else if (upstream.readyState === WebSocketClient.CONNECTING && pending.length < MAX_PENDING) {
            pending.push({ data, binary });
        }
    });
    upstream.on('open', () => {
        for (const msg of pending.splice(0)) upstream.send(msg.data, { binary: msg.binary });
    });
    upstream.on('message', (data: WebSocket.RawData, binary: boolean) => {
        if (client.readyState === WebSocketClient.OPEN) client.send(data, { binary });
    });

    const closeBoth = (code: number, reason: string) => {
        if (client.readyState === WebSocketClient.OPEN || client.readyState === WebSocketClient.CONNECTING) client.close(code, reason);
        if (upstream.readyState === WebSocketClient.OPEN || upstream.readyState === WebSocketClient.CONNECTING) upstream.terminate();
    };
    client.on('close', () => closeBoth(1000, ''));
    client.on('error', () => closeBoth(1011, ''));
    upstream.on('close', () => closeBoth(1011, 'Rejestr głosu zamknął połączenie'));
    upstream.on('error', () => closeBoth(1011, 'Rejestr głosu nie odpowiada'));
    return upstream;
}

export function attachVoiceWebsocket(srv: Server, config: ConfigStateless): void {
    const profiles = new ProfileControl(config);
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

    srv.on('upgrade', async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (!isVoiceUpgrade(request.url)) return;
        socket.on('error', () => socket.destroy());

        let user: AuthUser;
        try {
            const params = new URLSearchParams((request.url || '').replace(/.*\?/, ''));
            const token = params.get('token');
            if (!token) throw new Error('Token Parameter Required');
            const auth = await tokenParser(config, token, config.SigningSecret);
            if (!(auth instanceof AuthUser)) throw new Error('Voice requires a user token');
            user = auth;
        } catch {
            return reject(socket, '401 Unauthorized');
        }

        const base = voiceControl.baseUrl();
        if (!base) return reject(socket, '404 Not Found');

        let callsign = user.email;
        try {
            const profile = await profiles.from(user.email);
            // A fresh profile carries the placeholder callsign until the user
            // fills it in; everyone would then share one Mumble name.
            if (profile.tak_callsign && profile.tak_callsign !== DEFAULT_CALLSIGN) callsign = profile.tak_callsign;
        } catch {
            // Without a profile the e-mail is the name; the service makes it Mumble-safe.
        }

        const url = base.replace(/^http/, 'ws') + '/api/v1/ws?' + new URLSearchParams({ user: callsign, email: user.email }).toString();
        wss.handleUpgrade(request, socket, head, (client: WebSocket) => {
            openRelay(client, url, process.env.VOICE_TOKEN || '');
        });
    });
}
