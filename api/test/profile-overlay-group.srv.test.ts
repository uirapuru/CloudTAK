import test from 'node:test';
import assert from 'node:assert';
import Flight from './flight.js';

const flight = new Flight();

flight.init({ takserver: true });
flight.takeoff();
flight.user();
flight.user({ username: 'user', admin: false });

let groupA: number;
let groupB: number;
let overlay: number;

test('GET: api/profile/overlay/group - empty', async () => {
    try {
        const res = await flight.fetch('/api/profile/overlay/group', {
            method: 'GET',
            auth: { bearer: flight.token.admin },
        }, true);

        assert.deepEqual(res.body, { total: 0, items: [] });
    } catch (err) {
        assert.ifError(err);
    }
});

test('POST: api/profile/overlay/group - trims name and lists a new group first', async () => {
    try {
        const a = await flight.fetch('/api/profile/overlay/group', {
            method: 'POST',
            auth: { bearer: flight.token.admin },
            body: { name: '  Roads  ' },
        }, true);

        assert.equal(a.body.name, 'Roads');
        assert.equal(a.body.pos, 0);
        assert.equal(a.body.collapsed, false);
        assert.equal(a.body.username, 'admin@example.com');
        groupA = a.body.id;

        const b = await flight.fetch('/api/profile/overlay/group', {
            method: 'POST',
            auth: { bearer: flight.token.admin },
            body: { name: 'Rivers' },
        }, true);

        // the newest group is listed first
        assert.equal(b.body.pos, -1);
        groupB = b.body.id;

        const list = await flight.fetch('/api/profile/overlay/group', {
            method: 'GET',
            auth: { bearer: flight.token.admin },
        }, true);

        assert.deepEqual(list.body.items.map((group: { id: number }) => group.id), [groupB, groupA]);
    } catch (err) {
        assert.ifError(err);
    }
});

test('POST: api/profile/overlay/group - rejects blank and too long names', async () => {
    try {
        for (const name of ['   ', 'x'.repeat(65)]) {
            const res = await flight.fetch('/api/profile/overlay/group', {
                method: 'POST',
                auth: { bearer: flight.token.admin },
                body: { name },
            }, false);

            assert.equal(res.status, 400, `name "${name}" should be rejected`);
        }
    } catch (err) {
        assert.ifError(err);
    }
});

test('PATCH: api/profile/overlay/group/:group - rename and collapse', async () => {
    try {
        const res = await flight.fetch(`/api/profile/overlay/group/${groupA}`, {
            method: 'PATCH',
            auth: { bearer: flight.token.admin },
            body: { name: 'Main Roads', collapsed: true },
        }, true);

        assert.equal(res.body.name, 'Main Roads');
        assert.equal(res.body.collapsed, true);
    } catch (err) {
        assert.ifError(err);
    }
});

test('Overlay Groups of another user are not listed and cannot be changed', async () => {
    try {
        const list = await flight.fetch('/api/profile/overlay/group', {
            method: 'GET',
            auth: { bearer: flight.token.user },
        }, true);

        assert.deepEqual(list.body, { total: 0, items: [] });

        const patch = await flight.fetch(`/api/profile/overlay/group/${groupA}`, {
            method: 'PATCH',
            auth: { bearer: flight.token.user },
            body: { name: 'Taken' },
        }, false);

        assert.equal(patch.status, 403);

        const del = await flight.fetch(`/api/profile/overlay/group/${groupA}`, {
            method: 'DELETE',
            auth: { bearer: flight.token.user },
        }, false);

        assert.equal(del.status, 403);

        const own = await flight.fetch('/api/profile/overlay/group', {
            method: 'GET',
            auth: { bearer: flight.token.admin },
        }, true);

        assert.equal(own.body.items.find((group: { id: number }) => group.id === groupA).name, 'Main Roads');
    } catch (err) {
        assert.ifError(err);
    }
});

test('PATCH: api/profile/overlay/:overlay - group_id', async () => {
    try {
        const post = await flight.fetch('/api/profile/overlay', {
            method: 'POST',
            auth: { bearer: flight.token.admin },
            body: {
                name: 'Grouped Overlay',
                mode: 'profile',
                url: '/profile/admin@example.com/grouped.pmtiles',
            },
        }, true);

        assert.equal(post.body.group_id, null);
        overlay = post.body.id;

        const moved = await flight.fetch(`/api/profile/overlay/${overlay}`, {
            method: 'PATCH',
            auth: { bearer: flight.token.admin },
            body: { group_id: groupA, pos: 4 },
        }, true);

        assert.equal(moved.body.group_id, groupA);
        assert.equal(moved.body.pos, 4);

        // A PATCH without group_id leaves the membership alone
        const hidden = await flight.fetch(`/api/profile/overlay/${overlay}`, {
            method: 'PATCH',
            auth: { bearer: flight.token.admin },
            body: { visible: false },
        }, true);

        assert.equal(hidden.body.group_id, groupA);
    } catch (err) {
        assert.ifError(err);
    }
});

test('PATCH: api/profile/overlay/:overlay - group_id of another user or missing -> 400', async () => {
    try {
        const other = await flight.fetch('/api/profile/overlay/group', {
            method: 'POST',
            auth: { bearer: flight.token.user },
            body: { name: 'Foreign' },
        }, true);

        for (const group_id of [other.body.id, 999999]) {
            const res = await flight.fetch(`/api/profile/overlay/${overlay}`, {
                method: 'PATCH',
                auth: { bearer: flight.token.admin },
                body: { group_id },
            }, false);

            assert.equal(res.status, 400);
        }

        const res = await flight.fetch(`/api/profile/overlay/${overlay}`, {
            method: 'GET',
            auth: { bearer: flight.token.admin },
        }, true);

        assert.equal(res.body.group_id, groupA);
    } catch (err) {
        assert.ifError(err);
    }
});

test('DELETE: api/profile/overlay/group/:group - overlays stay, ungrouped', async () => {
    try {
        const del = await flight.fetch(`/api/profile/overlay/group/${groupA}`, {
            method: 'DELETE',
            auth: { bearer: flight.token.admin },
        }, true);

        assert.equal(del.body.status, 200);

        const res = await flight.fetch(`/api/profile/overlay/${overlay}`, {
            method: 'GET',
            auth: { bearer: flight.token.admin },
        }, true);

        assert.equal(res.body.group_id, null);
        assert.equal(res.body.name, 'Grouped Overlay');

        const list = await flight.fetch('/api/profile/overlay/group', {
            method: 'GET',
            auth: { bearer: flight.token.admin },
        }, true);

        assert.deepEqual(list.body.items.map((g: { id: number }) => g.id), [groupB]);

        const again = await flight.fetch(`/api/profile/overlay/group/${groupA}`, {
            method: 'DELETE',
            auth: { bearer: flight.token.admin },
        }, false);

        assert.equal(again.status, 404);
    } catch (err) {
        assert.ifError(err);
    }
});

flight.landing();
