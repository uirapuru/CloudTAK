import test from 'node:test';
import assert from 'node:assert';
import Flight from './flight.js';

const flight = new Flight();

flight.init({ takserver: true });
flight.takeoff();
flight.user();
flight.user({ username: 'user', admin: false });

type Favorite = { key: string; created: string };

async function list(token: string): Promise<string[]> {
    const res = await flight.fetch('/api/profile/overlay/favorite', {
        method: 'GET',
        auth: { bearer: token },
    }, true);

    assert.equal(res.body.total, res.body.items.length);
    return (res.body.items as Favorite[]).map(favorite => favorite.key);
}

test('GET: api/profile/overlay/favorite - empty', async () => {
    try {
        assert.deepEqual(await list(flight.token.admin), []);
    } catch (err) {
        assert.ifError(err);
    }
});

test('PUT: api/profile/overlay/favorite - stores a key once', async () => {
    try {
        for (const key of ['live:adsb', 'overlay:12', 'live:adsb']) {
            const res = await flight.fetch('/api/profile/overlay/favorite', {
                method: 'PUT',
                auth: { bearer: flight.token.admin },
                body: { key },
            }, true);

            assert.equal(res.body.key, key);
            assert.ok(res.body.created);
        }

        // Oldest first - the order the user starred them in
        assert.deepEqual(await list(flight.token.admin), ['live:adsb', 'overlay:12']);
    } catch (err) {
        assert.ifError(err);
    }
});

test('PUT: api/profile/overlay/favorite - rejects keys without a mode', async () => {
    try {
        for (const key of ['', 'adsb', ':adsb', 'live:', `live:${'x'.repeat(300)}`]) {
            const res = await flight.fetch('/api/profile/overlay/favorite', {
                method: 'PUT',
                auth: { bearer: flight.token.admin },
                body: { key },
            }, false);

            assert.equal(res.status, 400, `key "${key.slice(0, 20)}" should be rejected`);
        }
    } catch (err) {
        assert.ifError(err);
    }
});

test('GET: api/profile/overlay/favorite - favorites are per user', async () => {
    try {
        assert.deepEqual(await list(flight.token.user), []);

        await flight.fetch('/api/profile/overlay/favorite', {
            method: 'PUT',
            auth: { bearer: flight.token.user },
            body: { key: 'ion:google-3d' },
        }, true);

        assert.deepEqual(await list(flight.token.user), ['ion:google-3d']);
        assert.deepEqual(await list(flight.token.admin), ['live:adsb', 'overlay:12']);
    } catch (err) {
        assert.ifError(err);
    }
});

test('DELETE: api/profile/overlay/favorite - removes only the own key, missing keys are fine', async () => {
    try {
        const res = await flight.fetch('/api/profile/overlay/favorite?key=live%3Aadsb', {
            method: 'DELETE',
            auth: { bearer: flight.token.admin },
        }, true);

        assert.equal(res.body.status, 200);

        const again = await flight.fetch('/api/profile/overlay/favorite?key=live%3Aadsb', {
            method: 'DELETE',
            auth: { bearer: flight.token.admin },
        }, true);

        assert.equal(again.body.status, 200);

        // Another user deleting the same key does not touch admin's favorites
        await flight.fetch('/api/profile/overlay/favorite?key=overlay%3A12', {
            method: 'DELETE',
            auth: { bearer: flight.token.user },
        }, true);

        assert.deepEqual(await list(flight.token.admin), ['overlay:12']);
    } catch (err) {
        assert.ifError(err);
    }
});

test('GET: api/profile/overlay/favorite - requires a user', async () => {
    try {
        const res = await flight.fetch('/api/profile/overlay/favorite', {
            method: 'GET',
        }, false);

        assert.equal(res.status, 401);
    } catch (err) {
        assert.ifError(err);
    }
});

flight.landing();
