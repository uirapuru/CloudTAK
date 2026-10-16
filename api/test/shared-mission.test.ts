import test from 'node:test';
import assert from 'node:assert';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GenerateUpsert } from '@openaddresses/batch-generic';
import { and, eq } from 'drizzle-orm';
import Flight from './flight.js';
import { ProfileSetting } from '../common/schema.js';
import ProfileOverlayControl, { SHARED_MISSION_OPTOUT } from '../common/control/profile-overlay.js';

// taklab: misja wspólna środowiska (`taklab::shared_mission`) - użytkownik jest na nią
// zapisany przy logowaniu i przy ładowaniu mapy, aż sam ją wyłączy albo usunie

const flight = new Flight();

const USERNAME = 'admin@example.com';
const MISSION_NAME = 'Mapa test';
const MISSION_GUID = '4b8f6d2e-1c3a-4e5f-9a7b-0d1e2f3a4b5c';
const OTHER_GUID = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

flight.init({ takserver: true });
flight.takeoff();
flight.user();
flight.server(USERNAME, 'password123');

const subscribed: Array<string> = [];
// Liczba odpowiedzi 400 "Invalid UID" na subskrypcję, zanim OTS zna urządzenie
let invalidUid = 0;

function mockSharedMission(): void {
    flight.tak.mockMarti.push(async (request: IncomingMessage, response: ServerResponse) => {
        if (!request.method || !request.url) return false;

        const url = new URL(request.url, 'http://localhost');
        const pathname = decodeURIComponent(url.pathname);
        const sub = pathname.match(/^\/Marti\/api\/missions\/guid\/([^/]+)\/subscription$/);

        if (request.method === 'GET' && pathname === `/Marti/api/missions/${MISSION_NAME}`) {
            response.setHeader('Content-Type', 'application/json');
            response.write(JSON.stringify({
                version: '3',
                type: 'Mission',
                data: [{ name: MISSION_NAME, guid: MISSION_GUID, description: '', groups: ['__ANON__'] }],
            }));
            response.end();
            return true;
        } else if (request.method === 'GET' && pathname.startsWith('/Marti/api/missions/guid/')) {
            // Mission.access w prune - brak dostępu (tak samo wygląda błąd sieci)
            response.setHeader('Content-Type', 'application/json');
            response.write(JSON.stringify({ version: '3', type: 'Mission', data: [] }));
            response.end();
            return true;
        } else if (request.method === 'PUT' && sub) {
            assert.equal(url.searchParams.get('uid'), `ANDROID-CloudTAK-${USERNAME}`);

            if (invalidUid > 0) {
                invalidUid--;
                response.statusCode = 400;
                response.setHeader('Content-Type', 'application/json');
                response.write(JSON.stringify({ success: false, error: 'Invalid UID' }));
                response.end();
                return true;
            }

            subscribed.push(sub[1]);
            response.setHeader('Content-Type', 'application/json');
            response.write(JSON.stringify({
                version: '3',
                type: 'com.bbn.marti.sync.model.MissionSubscription',
                data: {
                    token: `token-${sub[1]}`,
                    clientUid: `ANDROID-CloudTAK-${USERNAME}`,
                    username: 'admin',
                    createTime: '2026-10-16T00:00:00Z',
                    role: { type: 'MISSION_SUBSCRIBER', permissions: [] },
                },
            }));
            response.end();
            return true;
        } else if (request.method === 'DELETE' && sub) {
            response.setHeader('Content-Type', 'application/json');
            response.write(JSON.stringify({ version: '3', type: 'MissionSubscription', data: {} }));
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
        body: { username: USERNAME, password: 'password123' },
    }, false);

    assert.equal(res.status, 200, `Login failed: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.token);
}

async function loadMap() {
    return await flight.fetch('/api/profile/overlay', {
        method: 'GET',
        auth: { bearer: flight.token.admin },
    }, true);
}

async function missionOverlays() {
    const list = await flight.config!.models.ProfileOverlay.list({ limit: 100 });
    return list.items.filter(overlay => overlay.mode === 'mission');
}

async function sharedOverlay() {
    return (await missionOverlays()).find(overlay => overlay.mode_id === MISSION_GUID);
}

async function optOut(): Promise<unknown> {
    return (await flight.config!.models.ProfileConfig.from(USERNAME))[SHARED_MISSION_OPTOUT];
}

async function clearOptOut(): Promise<void> {
    await flight.config!.pg.delete(ProfileSetting).where(and(
        eq(ProfileSetting.username, USERNAME),
        eq(ProfileSetting.key, SHARED_MISSION_OPTOUT),
    ));
}

test('Login - shared mission setting empty -> nothing happens', async () => {
    flight.tak.reset();
    flight.tak.martiRequests.length = 0;

    await login();
    await loadMap();

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

test('Login - OTS does not know the device yet (400 Invalid UID) -> map load subscribes, active', async () => {
    flight.tak.reset();
    mockSharedMission();
    invalidUid = 1;

    await login();
    assert.equal((await missionOverlays()).length, 0, 'first login could not subscribe');

    const res = await loadMap();

    const overlay = await sharedOverlay();
    assert.ok(overlay, 'map load created the shared mission overlay');
    assert.equal(overlay.name, MISSION_NAME);
    assert.equal(overlay.url, `/mission/${MISSION_GUID}`);
    assert.equal(overlay.token, `token-${MISSION_GUID}`);
    assert.equal(overlay.active, true);
    assert.deepEqual(subscribed, [MISSION_GUID]);

    assert.ok(res.body.items.some((item: { mode_id: string }) => item.mode_id === MISSION_GUID), 'returned in the same response');
});

test('Map load - prune keeps the shared mission when access fails', async () => {
    // Atrapa odpowiada na sprawdzenie dostępu pustą listą (brak dostępu)
    const res = await loadMap();

    assert.equal(res.body.removed.length, 0);
    assert.ok(await sharedOverlay(), 'row kept');
    assert.ok(!flight.tak.martiRequests.some(req => req.startsWith(`GET /Marti/api/missions/guid/${MISSION_GUID}`)), 'no access check for the shared mission');
});

test('Login - user deactivated the shared mission -> stays inactive', async () => {
    const overlay = await sharedOverlay();
    assert.ok(overlay);

    const patch = await flight.fetch(`/api/profile/overlay/${overlay.id}`, {
        method: 'PATCH',
        auth: { bearer: flight.token.admin },
        body: { active: false },
    }, false);
    assert.equal(patch.status, 200, `PATCH failed: ${JSON.stringify(patch.body)}`);
    assert.equal(await optOut(), MISSION_GUID);

    await login();
    await loadMap();

    assert.equal((await sharedOverlay())?.active, false);
    assert.equal(subscribed.length, 1, 'no second subscription');
});

test('Login - user deleted the shared mission -> not re-created', async () => {
    await clearOptOut();

    const overlay = await sharedOverlay();
    assert.ok(overlay);

    const del = await flight.fetch(`/api/profile/overlay?id=${overlay.id}`, {
        method: 'DELETE',
        auth: { bearer: flight.token.admin },
    }, false);
    assert.equal(del.status, 200, `DELETE failed: ${JSON.stringify(del.body)}`);
    assert.equal(await optOut(), MISSION_GUID);

    await login();
    await loadMap();

    assert.equal(await sharedOverlay(), undefined);
    assert.equal(subscribed.length, 1, 'no second subscription');
});

test('Login - user has another active mission -> shared mission subscribed but inactive', async () => {
    await clearOptOut();

    const other = await new ProfileOverlayControl(flight.config!).upsert(USERNAME, {
        name: 'Other Mission',
        mode: 'mission',
        mode_id: OTHER_GUID,
        type: 'geojson',
        url: `/mission/${OTHER_GUID}`,
        active: true,
    });

    await login();

    const shared = await sharedOverlay();
    assert.ok(shared, 'subscribed');
    assert.equal(shared.active, false);
    assert.equal((await flight.config!.models.ProfileOverlay.from(other.overlay.id)).active, true, 'active mission not switched');
    assert.deepEqual(subscribed, [MISSION_GUID, OTHER_GUID, MISSION_GUID]);

    flight.tak.reset();
});

flight.landing();
