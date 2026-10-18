import test, { mock } from 'node:test';
import assert from 'node:assert';
import Err from '@openaddresses/batch-error';
import {
    scheduleSharedMissionRetries,
    hasSharedMissionRetry,
    cancelSharedMissionRetries,
    isInvalidUid,
    SHARED_MISSION_RETRY_MS,
} from '../stateless/lib/user/shared-mission.js';

// taklab: ponowienia zapisu na misję wspólną po 400 „Invalid UID”, na sztucznym zegarze

const invalidUid = () => new Err(400, null, '{"success": false, "error": "Invalid UID"}');

/** Przesuwa sztuczny zegar i oddaje sterowanie, żeby asynchroniczna próba się skończyła */
async function tick(ms: number): Promise<void> {
    mock.timers.tick(ms);
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
}

test.beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] });
});

test.afterEach(() => {
    cancelSharedMissionRetries();
    mock.timers.reset();
});

test('isInvalidUid: tylko 400 z „Invalid UID”', () => {
    assert.strictEqual(isInvalidUid(invalidUid()), true);
    assert.strictEqual(isInvalidUid(new Err(400, null, 'connect ECONNREFUSED')), false);
    assert.strictEqual(isInvalidUid(new Err(500, null, 'Invalid UID')), false);
    assert.strictEqual(isInvalidUid(new Error('Invalid UID')), false);
    assert.strictEqual(isInvalidUid(undefined), false);
});

test('ponowienia po 10 s, 30 s i 90 s; sukces kończy serię', async () => {
    assert.deepStrictEqual(SHARED_MISSION_RETRY_MS, [10_000, 30_000, 90_000]);

    let calls = 0;
    const attempt = async () => {
        calls++;
        if (calls < 3) throw invalidUid();
    };

    assert.strictEqual(scheduleSharedMissionRetries('a@example.com', attempt), true);

    await tick(9_999);
    assert.strictEqual(calls, 0);
    await tick(1);
    assert.strictEqual(calls, 1);

    await tick(29_999);
    assert.strictEqual(calls, 1);
    await tick(1);
    assert.strictEqual(calls, 2);

    await tick(90_000);
    assert.strictEqual(calls, 3);
    assert.strictEqual(hasSharedMissionRetry('a@example.com'), false, 'success ends the series');

    await tick(1_000_000);
    assert.strictEqual(calls, 3);
});

test('najwyżej 3 próby, potem koniec serii', async () => {
    const warn = mock.method(console, 'warn', () => undefined);
    let calls = 0;

    scheduleSharedMissionRetries('b@example.com', async () => {
        calls++;
        throw invalidUid();
    });

    await tick(10_000);
    await tick(30_000);
    await tick(90_000);
    await tick(1_000_000);

    assert.strictEqual(calls, 3);
    assert.strictEqual(hasSharedMissionRetry('b@example.com'), false);
    warn.mock.restore();
});

test('jedna seria na użytkownika', async () => {
    let calls = 0;
    const attempt = async () => {
        calls++;
    };

    assert.strictEqual(scheduleSharedMissionRetries('c@example.com', attempt), true);
    assert.strictEqual(scheduleSharedMissionRetries('c@example.com', attempt), false);
    assert.strictEqual(scheduleSharedMissionRetries('d@example.com', attempt), true);

    await tick(10_000);
    assert.strictEqual(calls, 2, 'one attempt per user');
});

test('inny błąd kończy serię bez kolejnych prób', async () => {
    const warn = mock.method(console, 'warn', () => undefined);
    let calls = 0;

    scheduleSharedMissionRetries('e@example.com', async () => {
        calls++;
        throw new Err(500, null, 'Status Code: 500');
    });

    await tick(10_000);
    await tick(1_000_000);

    assert.strictEqual(calls, 1);
    assert.strictEqual(hasSharedMissionRetry('e@example.com'), false);
    warn.mock.restore();
});
