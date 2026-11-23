import test from 'node:test';
import assert from 'node:assert';
import Flight from './flight.js';

const flight = new Flight();

flight.init({ takserver: true });
flight.takeoff();
flight.user();

// Without a login every valid request ends at the auth check (401); an
// account name the route schema rejects ends at validation (400).
test('GET: api/ots/accounts/:username/qr accepts OTS usernames with Polish letters', async () => {
    const res = await flight.fetch('/api/ots/accounts/' + encodeURIComponent('michał') + '/qr?type=atak', { method: 'GET' }, false);
    assert.equal(res.status, 401, JSON.stringify(res.body));
});

test('GET: api/ots/accounts/:username/qr rejects names OTS cannot have', async () => {
    // v14 checks the route's security before the schema, so the name check needs a login
    const res = await flight.fetch('/api/ots/accounts/' + encodeURIComponent('a b') + '/qr?type=atak', {
        method: 'GET',
        auth: { bearer: flight.token.admin },
    }, false);
    assert.equal(res.status, 400, JSON.stringify(res.body));
});

test('GET: api/marti/datasync-qr needs a login', async () => {
    const res = await flight.fetch('/api/marti/datasync-qr?name=x', { method: 'GET' }, false);
    assert.equal(res.status, 401, JSON.stringify(res.body));
});

flight.landing();
