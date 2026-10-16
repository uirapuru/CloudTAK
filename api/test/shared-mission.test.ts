import test from 'node:test';
import assert from 'node:assert';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GenerateUpsert } from '@openaddresses/batch-generic';
import Flight from './flight.js';

// taklab: misja wspólna środowiska (`taklab::shared_mission`) - każdy użytkownik
// jest na nią zapisany przy logowaniu, a misja jest aktywna od pierwszego zapisu

const flight = new Flight();

const MISSION_NAME = 'Mapa test';
const MISSION_GUID = '4b8f6d2e-1c3a-4e5f-9a7b-0d1e2f3a4b5c';

flight.init({ takserver: true });
flight.takeoff();
flight.user();
flight.server('admin@example.com', 'password123');

let subscribeCalls = 0;

function mockSharedMission(): void {
    flight.tak.mockMarti.push(async (request: IncomingMessage, response: ServerResponse) => {
        if (!request.method || !request.url) return false;

        const url = new URL(request.url, 'http://localhost');
        const pathname = decodeURIComponent(url.pathname);

        if (request.method === 'GET' && pathname === `/Marti/api/missions/${MISSION_NAME}`) {
            response.setHeader('Content-Type', 'application/json');
            response.write(JSON.stringify({
                version: '3',
                type: 'Mission',
                data: [{
                    name: MISSION_NAME,
                    guid: MISSION_GUID,
                    description: '',
                    groups: ['__ANON__'],
                }],
            }));
            response.end();
            return true;
        } else if (request.method === 'PUT' && pathname === `/Marti/api/missions/guid/${MISSION_GUID}/subscription`) {
            subscribeCalls++;
            assert.equal(url.searchParams.get('uid'), 'ANDROID-CloudTAK-admin@example.com');

            response.setHeader('Content-Type', 'application/json');
            response.write(JSON.stringify({
                version: '3',
                type: 'com.bbn.marti.sync.model.MissionSubscription',
                data: {
                    token: 'shared-mission-token',
                    clientUid: 'ANDROID-CloudTAK-admin@example.com',
                    username: 'admin',
                    createTime: '2026-10-16T00:00:00Z',
                    role: { type: 'MISSION_SUBSCRIBER', permissions: [] },
                },
            }));
            response.end();
            return true;
        }

        return false;
    });
}

async function setSharedMission(value: string): Promise<void> {
    await flight.config!.models.Setting.generate({
        key: 'taklab::shared_mission',
        value,
    }, { upsert: GenerateUpsert.UPDATE });
}

async function login(): Promise<void> {
    const res = await flight.fetch('/api/login', {
        method: 'POST',
        body: { username: 'admin@example.com', password: 'password123' },
    }, false);

    assert.equal(res.status, 200, `Login failed: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.token);
}

async function missionOverlays() {
    const list = await flight.config!.models.ProfileOverlay.list({ limit: 100 });
    return list.items.filter(overlay => overlay.mode === 'mission');
}

test('Login - shared mission setting empty -> nothing happens', async () => {
    flight.tak.reset();
    flight.tak.martiRequests.length = 0;

    await login();

    assert.equal((await missionOverlays()).length, 0);
    assert.ok(!flight.tak.martiRequests.some(req => req.includes('/Marti/api/missions')), 'no mission requests');
});

test('Login - subscription fails -> login succeeds, no overlay', async () => {
    flight.tak.reset();
    await setSharedMission(MISSION_NAME);

    // Bez atrapy misji Mock TAK Server odpowiada 500
    await login();

    assert.equal((await missionOverlays()).length, 0);
});

test('Login - first login with shared mission -> subscribed and active', async () => {
    flight.tak.reset();
    mockSharedMission();

    await login();

    const overlays = await missionOverlays();
    assert.equal(overlays.length, 1);
    assert.equal(overlays[0].mode_id, MISSION_GUID);
    assert.equal(overlays[0].name, MISSION_NAME);
    assert.equal(overlays[0].url, `/mission/${MISSION_GUID}`);
    assert.equal(overlays[0].username, 'admin@example.com');
    assert.equal(overlays[0].token, 'shared-mission-token');
    assert.equal(overlays[0].active, true);
    assert.equal(subscribeCalls, 1);
});

test('Login - user deactivated the shared mission -> next login keeps it inactive', async () => {
    const [overlay] = await missionOverlays();

    const patch = await flight.fetch(`/api/profile/overlay/${overlay.id}`, {
        method: 'PATCH',
        auth: { bearer: flight.token.admin },
        body: { active: false },
    }, false);
    assert.equal(patch.status, 200, `PATCH failed: ${JSON.stringify(patch.body)}`);

    await login();

    const overlays = await missionOverlays();
    assert.equal(overlays.length, 1);
    assert.equal(overlays[0].active, false);
    assert.equal(subscribeCalls, 1, 'no second subscription');

    flight.tak.reset();
});

flight.landing();
