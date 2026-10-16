import test from 'node:test';
import assert from 'node:assert';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GenerateUpsert } from '@openaddresses/batch-generic';
import { and, eq, like } from 'drizzle-orm';
import Flight from './flight.js';
import { ProfileOverlay, ProfileSetting } from '../common/schema.js';
import ProfileOverlayControl, { SHARED_MISSION_OPTOUT } from '../common/control/profile-overlay.js';
import {
    SHARED_MISSION_RETRY_MS,
    cancelSharedMissionRetries,
    hasSharedMissionRetry,
} from '../stateless/lib/user/shared-mission.js';

// taklab: misja wspólna środowiska (`taklab::shared_mission`) - użytkownik jest na nią
// zapisany przy logowaniu i przy ładowaniu mapy, aż sam ją wyłączy albo usunie.
// Każdy test zaczyna od czystego stanu (fresh()).

const flight = new Flight();

const USERNAME = 'admin@example.com';
const MISSION_NAME = 'Mapa test';
const MISSION_GUID = '4b8f6d2e-1c3a-4e5f-9a7b-0d1e2f3a4b5c';
const OTHER_GUID = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

flight.init({ takserver: true });
flight.takeoff();
flight.user();
flight.server(USERNAME, 'password123');

let subscribed: Array<string> = [];
// Liczba odpowiedzi 400 "Invalid UID" na subskrypcję, zanim OTS zna urządzenie
let invalidUid = 0;
// Zdarzenia sync wysłane do klientów użytkownika
let notified: Array<{ event: unknown; exclude?: string }> = [];

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

/** Czysty stan: bez nakładek i ustawień misji wspólnej, atrapa OTS gotowa, ustawienie wpisane */
async function fresh(opts: { setting?: string } = {}): Promise<void> {
    cancelSharedMissionRetries();
    await flight.config!.pg.delete(ProfileOverlay).where(eq(ProfileOverlay.username, USERNAME));
    await flight.config!.pg.delete(ProfileSetting).where(and(
        eq(ProfileSetting.username, USERNAME),
        like(ProfileSetting.key, 'taklab::shared_mission::%'),
    ));
    await setSharedMission(opts.setting ?? MISSION_NAME);

    flight.tak.reset();
    mockSharedMission();
    flight.tak.martiRequests.length = 0;

    subscribed = [];
    invalidUid = 0;
    notified = [];
    flight.config!.hub.wsNotify = async (username: string, event: unknown, exclude?: string) => {
        notified.push({ event, exclude });
    };
}

/** Zapytania o misje do OTS od ostatniego fresh() */
function missionRequests(): Array<string> {
    return flight.tak.martiRequests.filter(req => req.includes('/Marti/api/missions'));
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

async function patchActive(id: number, active: boolean): Promise<void> {
    const res = await flight.fetch(`/api/profile/overlay/${id}`, {
        method: 'PATCH',
        auth: { bearer: flight.token.admin },
        body: { active },
    }, false);
    assert.equal(res.status, 200, `PATCH failed: ${JSON.stringify(res.body)}`);
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

/** Stan „użytkownik już zapisany”: nakładka misji wspólnej po pierwszym logowaniu */
async function subscribedUser() {
    await login();
    const overlay = await sharedOverlay();
    assert.ok(overlay, 'subscribed on login');
    flight.tak.martiRequests.length = 0;
    return overlay;
}

test('Shared mission setting empty -> nothing happens, no OTS calls', async () => {
    await fresh({ setting: '' });

    await login();
    await loadMap();

    assert.equal((await missionOverlays()).length, 0);
    assert.deepEqual(missionRequests(), []);
});

test('Subscription fails (500) -> login succeeds, no overlay, no retry scheduled', async () => {
    await fresh();
    flight.tak.reset(); // bez atrapy misji Mock TAK Server odpowiada 500

    await login();

    assert.equal((await missionOverlays()).length, 0);
    assert.equal(hasSharedMissionRetry(USERNAME), false);
});

test('First login -> subscribed and active', async () => {
    await fresh();

    await login();

    const overlay = await sharedOverlay();
    assert.ok(overlay);
    assert.equal(overlay.name, MISSION_NAME);
    assert.equal(overlay.url, `/mission/${MISSION_GUID}`);
    assert.equal(overlay.token, `token-${MISSION_GUID}`);
    assert.equal(overlay.active, true);
    assert.deepEqual(subscribed, [MISSION_GUID]);
});

test('Another active mission -> shared mission subscribed but inactive', async () => {
    await fresh();

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
});

test('Existing shared overlay -> zero OTS calls on login and map load', async () => {
    await fresh();
    await subscribedUser();

    await login();
    await loadMap();

    assert.deepEqual(missionRequests(), [], 'no Mission.get, no access check');
    assert.equal(subscribed.length, 1);
});

test('400 Invalid UID at login -> retry scheduled; map load subscribes, same response', async () => {
    await fresh();
    invalidUid = 1;

    await login();
    assert.equal((await missionOverlays()).length, 0, 'first login could not subscribe');
    assert.equal(hasSharedMissionRetry(USERNAME), true, 'retry scheduled');

    const res = await loadMap();

    const overlay = await sharedOverlay();
    assert.ok(overlay, 'map load created the shared mission overlay');
    assert.equal(overlay.active, true);
    assert.ok(res.body.items.some((item: { mode_id: string }) => item.mode_id === MISSION_GUID), 'returned in the same response');
});

test('400 Invalid UID -> in-process retry creates the overlay and notifies open clients', async () => {
    await fresh();
    invalidUid = 2; // logowanie i pierwsze ponowienie

    const delays = [...SHARED_MISSION_RETRY_MS];
    SHARED_MISSION_RETRY_MS.splice(0, delays.length, 20, 20, 20);

    try {
        await login();
        assert.equal((await missionOverlays()).length, 0);

        for (let i = 0; i < 100 && !(await sharedOverlay()); i++) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }

        const overlay = await sharedOverlay();
        assert.ok(overlay, 'retry created the overlay');
        assert.equal(hasSharedMissionRetry(USERNAME), false, 'series ended');

        assert.deepEqual(notified, [{
            event: { type: 'sync', data: { type: 'overlay', action: 'create', id: overlay.id } },
            exclude: undefined,
        }]);
    } finally {
        SHARED_MISSION_RETRY_MS.splice(0, SHARED_MISSION_RETRY_MS.length, ...delays);
    }
});

test('Map load - prune keeps the shared mission when access fails', async () => {
    await fresh();
    await subscribedUser();

    const res = await loadMap();

    assert.equal(res.body.removed.length, 0);
    assert.ok(await sharedOverlay(), 'row kept');
    assert.deepEqual(missionRequests(), [], 'no access check for the shared mission');
});

test('Deactivating the active shared mission -> opt-out, next login keeps it inactive', async () => {
    await fresh();
    const overlay = await subscribedUser();

    await patchActive(overlay.id, false);
    assert.equal(await optOut(), MISSION_GUID);

    await login();
    await loadMap();

    assert.equal((await sharedOverlay())?.active, false);
    assert.equal(subscribed.length, 1, 'no second subscription');
});

test('PATCH active=false on an already inactive shared mission -> no opt-out', async () => {
    await fresh();

    await new ProfileOverlayControl(flight.config!).upsert(USERNAME, {
        name: 'Other Mission',
        mode: 'mission',
        mode_id: OTHER_GUID,
        type: 'geojson',
        url: `/mission/${OTHER_GUID}`,
        active: true,
    });

    const overlay = await subscribedUser();
    assert.equal(overlay.active, false);

    await patchActive(overlay.id, false);
    assert.ok(!await optOut(), 'no opt-out without a true -> false transition');
});

test('PATCH active=true clears the opt-out', async () => {
    await fresh();
    const overlay = await subscribedUser();

    await patchActive(overlay.id, false);
    assert.equal(await optOut(), MISSION_GUID);

    await patchActive(overlay.id, true);
    assert.ok(!await optOut(), 'opt-out cleared');
});

test('Deleting the shared mission -> opt-out, not re-created', async () => {
    await fresh();
    const overlay = await subscribedUser();

    const del = await flight.fetch(`/api/profile/overlay?id=${overlay.id}`, {
        method: 'DELETE',
        auth: { bearer: flight.token.admin },
    }, false);
    assert.equal(del.status, 200, `DELETE failed: ${JSON.stringify(del.body)}`);
    assert.equal(await optOut(), MISSION_GUID);
    assert.ok(flight.tak.martiRequests.some(req => req.startsWith(`DELETE /Marti/api/missions/guid/${MISSION_GUID}/subscription`)), 'unsubscribed');

    await login();
    await loadMap();

    assert.equal(await sharedOverlay(), undefined);
    assert.equal(subscribed.length, 1, 'no second subscription');
});

test('cleanup', async () => {
    cancelSharedMissionRetries();
    flight.tak.reset();
});

flight.landing();
