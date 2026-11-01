import test from 'node:test';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import Flight from './flight.js';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';

// taklab: media-infra syncs its paths from GET /api/video/lease?ephemeral=false
// and deletes every path missing from the answer. Ephemeral proxy leases must
// stay on that list, otherwise their path disappears within 10 seconds.

const flight = new Flight();

flight.init({ takserver: true });
flight.takeoff();
flight.user();

const mediaToken = 'etl.' + jwt.sign({ access: 'lease', id: 'any', internal: true }, 'coe-wildland-fire');

let agent: MockAgent;
let originalDispatcher: ReturnType<typeof getGlobalDispatcher>;
let ephemeralId: number;

test('Mock Media Server Start', async () => {
    originalDispatcher = getGlobalDispatcher();
    agent = new MockAgent();
    agent.disableNetConnect();
    agent.enableNetConnect(new URL(flight.base).host);
    setGlobalDispatcher(agent);

    agent.get('http://media-server:9997').intercept({
        path: '/path',
        method: 'POST',
    }).reply(200, {}).persist();

    await flight.config!.models.Setting.generate({
        key: 'media::url',
        value: 'http://media-server',
    });
});

test('POST: api/video/lease - ephemeral RTSP proxy lease', async () => {
    const res = await flight.fetch('/api/video/lease', {
        method: 'POST',
        auth: { bearer: flight.token.admin },
        body: {
            name: 'Temporary Lease',
            ephemeral: true,
            duration: 3600,
            proxy: 'rtsp://example.com:8554/cam',
        },
    }, true);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ephemeral, true);
    ephemeralId = res.body.id;
});

test('GET: api/video/lease - Media Server token sees ephemeral leases', async () => {
    const res = await flight.fetch('/api/video/lease?impersonate=true&ephemeral=false&expired=false', {
        method: 'GET',
        auth: { bearer: mediaToken },
    }, true);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.items.map((l: { id: number }) => l.id), [ephemeralId]);
});

test('GET: api/video/lease - admin filter on ephemeral is unchanged', async () => {
    const res = await flight.fetch('/api/video/lease?impersonate=true&ephemeral=false', {
        method: 'GET',
        auth: { bearer: flight.token.admin },
    }, true);

    assert.equal(res.status, 200);
    assert.equal(res.body.total, 0);
});

test('Mock Media Server Stop', async () => {
    setGlobalDispatcher(originalDispatcher);
    await agent.close();
});

flight.landing();
