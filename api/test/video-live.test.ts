import test from 'node:test';
import assert from 'node:assert';
import { CoTParser } from '@tak-ps/node-cot';
import { LiveVideoControl, normalizeLiveList, normalizeStream } from '../stateless/lib/control/live-video.js';
import type { OtsTransport } from '../stateless/lib/control/recordings.js';
import { readLiveVideoRef, applyLiveVideoRef } from '../common/taklab-video-cot.js';

const AUTH = { cert: 'CERT-alfa', key: 'KEY-alfa' };

/** The example from the contract in docs/superpowers/specs/2026-11-25-live-video-design.md (taklab). */
const CONTRACT = {
    generated_at: '2026-11-25T15:00:00Z',
    streams: [{
        path: 'operator',
        username: 'operator',
        started_at: '2026-11-25T14:58:10Z',
        tech: {
            source: 'rtspsSession',
            transport: 'TCP',
            readers: 2,
            bytes_received: 12345678,
            bitrate_kbps: 2100.5,
            packets_lost: 0,
            jitter_ms: 3.1,
            video: { codec: 'H264', width: 1280, height: 720, profile: 'High', level: '4.0', fps: 30 },
            audio: { codec: 'MPEG-4 Audio', sample_rate: 44100, channels: 1 },
        },
    }],
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fake(reply: () => Response | Promise<Response>) {
    const seen: Array<{ url: string; method: string; headers: Record<string, string>; auth: typeof AUTH }> = [];
    const control = new LiveVideoControl(() => 'https://public-ots:8443/');
    const transport: OtsTransport = async (url, init, auth) => {
        seen.push({ url, method: init.method, headers: init.headers, auth });
        return await reply();
    };
    control.transport = transport;
    return { control, seen };
}

test('list asks OTS with the caller certificate and keeps the contract', async () => {
    const { control, seen } = fake(() => json(CONTRACT));
    const list = await control.list(AUTH);
    assert.deepEqual(list, { supported: true, ...CONTRACT });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, 'https://public-ots:8443/api/taklab/video/live');
    assert.equal(seen[0].method, 'GET');
    assert.deepEqual(seen[0].auth, AUTH);
    assert.equal(seen[0].headers.Authorization, undefined, 'no CloudTAK token goes to OTS');
});

test('OTS without the live route = not supported, not an error', async () => {
    const { control } = fake(() => new Response('<html>404</html>', { status: 404 }));
    assert.deepEqual(await control.list(AUTH), { supported: false, streams: [] });
});

test('OTS errors become Polish errors; an unreachable OTS is 502', async () => {
    for (const [status, expected] of [[401, 403], [403, 403], [500, 502], [503, 502]] as const) {
        const { control } = fake(() => json({ message: 'konto bravo' }, status));
        await assert.rejects(control.list(AUTH), (err: { status: number; message: string }) => {
            return err.status === expected && !err.message.includes('bravo');
        }, String(status));
    }

    const { control } = fake(() => { throw new Error('ECONNREFUSED'); });
    await assert.rejects(control.list(AUTH), (err: { status: number }) => err.status === 502);

    const broken = fake(() => new Response('nie json', { status: 200 }));
    await assert.rejects(broken.control.list(AUTH), (err: { status: number }) => err.status === 502);

    const none = new LiveVideoControl(() => null);
    await assert.rejects(none.list(AUTH), (err: { status: number }) => err.status === 404);
});

test('normalize: tech null stays null, unknown fields and broken rows are dropped', () => {
    const list = normalizeLiveList({
        generated_at: '2026-11-25T15:00:00Z',
        streams: [
            { path: 'alfa', username: 'alfa', started_at: null, tech: null, remote_addr: '10.0.0.7' },
            { path: 'bravo', username: 'bravo', started_at: '2026-11-25T14:00:00Z', tech: { source: 'rtmpConn', readers: '3', bitrate_kbps: 'x', video: null, audio: { codec: 'Opus' }, remote_addr: '10.0.0.8' } },
            { path: '', username: 'nikt' },
            { path: 'alfa', username: 'duplikat' },
            'zle',
        ],
    });
    assert.equal(list.supported, true);
    assert.deepEqual(list.streams.map((s) => s.path), ['alfa', 'bravo']);
    assert.deepEqual(list.streams[0], { path: 'alfa', username: 'alfa', started_at: null, tech: null });
    assert.deepEqual(list.streams[1].tech, {
        source: 'rtmpConn', transport: null, readers: 3, bytes_received: null, bitrate_kbps: null,
        packets_lost: null, jitter_ms: null, video: null, audio: { codec: 'Opus', sample_rate: null, channels: null },
    });
    assert.ok(!JSON.stringify(list).includes('10.0.0'), 'no sender addresses');

    assert.deepEqual(normalizeLiveList(null), { supported: true, generated_at: null, streams: [] });
    assert.equal(normalizeStream({ path: 'x' })?.username, '');
});

function cotFrom(detail: string) {
    return CoTParser.from_xml(`<event version="2.0" uid="ANDROID-1-taklab-video" type="b-m-p-s-p-loc" how="m-g" time="2026-11-25T15:00:00Z" start="2026-11-25T15:00:00Z" stale="2026-11-25T15:00:30Z"><point lat="51.1" lon="17.0" hae="0" ce="9999999" le="9999999"/><detail>${detail}</detail></event>`);
}

test('CoT: __taklab_video path goes to metadata, __video stays in properties.video', async () => {
    const cot = cotFrom('<contact callsign="WOLF – wideo"/><sensor azimuth="45" fov="60" vfov="40" range="200" elevation="-5"/><__video url="rtsp://public.taklab.eu:8554/operator"/><__taklab_video path="operator"/>');
    assert.deepEqual(readLiveVideoRef(cot), { path: 'operator' });
    const feat = await CoTParser.to_geojson(cot);
    applyLiveVideoRef(cot, feat as unknown as { properties: Record<string, unknown> });
    const props = feat.properties as unknown as { metadata: Record<string, unknown>; video: { url: string }; sensor: { azimuth: number } };
    assert.deepEqual(props.metadata.taklab_video, { path: 'operator' });
    assert.equal(props.video.url, 'rtsp://public.taklab.eu:8554/operator');
    assert.equal(props.sensor.azimuth, 45);
});

test('CoT: bad or missing live video element changes nothing', async () => {
    for (const detail of ['', '<__taklab_video path="../x"/>', '<__taklab_video/>', '<__taklab_video path="a b"/>']) {
        const cot = cotFrom(detail);
        assert.equal(readLiveVideoRef(cot), null, detail);
        const feat = await CoTParser.to_geojson(cot);
        const before = JSON.stringify(feat.properties);
        applyLiveVideoRef(cot, feat as unknown as { properties: Record<string, unknown> });
        assert.equal(JSON.stringify(feat.properties), before, detail);
    }
});
