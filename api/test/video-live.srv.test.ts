import test from 'node:test';
import assert from 'node:assert';
import Flight from './flight.js';
import { liveVideoControl } from '../stateless/lib/control/live-video.js';
import type { OtsTransport } from '../stateless/lib/control/recordings.js';

const flight = new Flight();

flight.init({ takserver: true });
flight.takeoff();
flight.user();

const STREAM = {
    path: 'operator',
    username: 'operator',
    started_at: '2026-11-25T14:58:10Z',
    tech: {
        source: 'rtspsSession',
        transport: 'TCP',
        readers: 0,
        bytes_received: 12345678,
        bitrate_kbps: 2100.5,
        packets_lost: 0,
        jitter_ms: 3.1,
        video: { codec: 'H264', width: 1280, height: 720, profile: 'High', level: '4.0', fps: 30 },
        audio: { codec: 'MPEG-4 Audio', sample_rate: 44100, channels: 1 },
    },
};

type Seen = { url: string; cert: string };
const seen: Seen[] = [];
let reply: () => Response = () => new Response(null, { status: 500 });

test('Live video: fake OTS', () => {
    process.env.LIVE_VIDEO_OTS_URL = 'https://public-ots:8443';
    const transport: OtsTransport = async (url, _init, auth) => {
        seen.push({ url, cert: auth.cert });
        return reply();
    };
    liveVideoControl.transport = transport;
});

test('GET: /api/video/live without a session is 401 and asks nothing', async () => {
    const res = await fetch(new URL('/api/video/live', flight.base));
    assert.equal(res.status, 401);
    assert.equal(seen.length, 0);
});

test('GET: /api/video/live passes every contract field, zeros and nulls included', async () => {
    reply = () => new Response(JSON.stringify({
        generated_at: '2026-11-25T15:00:00Z',
        streams: [
            { ...STREAM, remote_addr: '10.0.0.7' },
            { path: 'bravo', username: 'bravo', started_at: null, tech: null },
            { path: 'charlie', username: 'charlie', started_at: '2026-11-25T14:59:00Z', tech: { ...STREAM.tech, transport: null, video: null, audio: null } },
        ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    const res = await flight.fetch('/api/video/live', { method: 'GET', auth: { bearer: flight.token.admin } }, true);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
        supported: true,
        generated_at: '2026-11-25T15:00:00Z',
        streams: [
            STREAM,
            { path: 'bravo', username: 'bravo', started_at: null, tech: null },
            { path: 'charlie', username: 'charlie', started_at: '2026-11-25T14:59:00Z', tech: { ...STREAM.tech, transport: null, video: null, audio: null } },
        ],
    });

    assert.equal(seen.at(-1)?.url, 'https://public-ots:8443/api/taklab/video/live');
    assert.match(seen.at(-1)?.cert || '', /BEGIN CERTIFICATE/, 'the user certificate goes to OTS');
});

test('GET: /api/video/live on an OTS without the route = supported false', async () => {
    reply = () => new Response('not found', { status: 404 });
    const res = await flight.fetch('/api/video/live', { method: 'GET', auth: { bearer: flight.token.admin } }, true);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { supported: false, streams: [] });
});

test('GET: /api/video/live maps an OTS failure to 502', async () => {
    reply = () => new Response('boom', { status: 500 });
    const res = await flight.fetch('/api/video/live', { method: 'GET', auth: { bearer: flight.token.admin } }, false);
    assert.equal(res.status, 502);
    delete process.env.LIVE_VIDEO_OTS_URL;
});

flight.landing();
