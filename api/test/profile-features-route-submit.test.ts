import test from 'node:test';
import assert from 'node:assert';
import { CoTParser } from '@tak-ps/node-cot';
import type CoT from '@tak-ps/node-cot';
import Flight from './flight.js';

const flight = new Flight();

flight.init({ takserver: true });
flight.takeoff();
flight.user();

const time = new Date('2025-03-04T22:54:15.447Z').toISOString();
const coords = [[17.03, 51.11, 0], [17.05, 51.1, 0], [17.07, 51.09, 0]];
const plan = {
    version: 1, mode: 'foot', mode_name: 'Pieszo',
    waypoints: [[17.03, 51.11], [17.07, 51.09]],
    legs: [{ start: 0, end: 2, distance_m: 3000, duration_s: 2000 }],
};

const sent: CoT[][] = [];

test('podmiana wysyłki', () => {
    flight.config!.hub.submitCots = async (opts) => {
        sent.push(opts.cots as CoT[]);
    };
});

function route(id = 'route-1') {
    return {
        id, type: 'Feature', path: '/',
        properties: { type: 'b-m-r', how: 'm-g', time, start: time, stale: time, callsign: 'Trasa', archived: true, center: [17.05, 51.1], metadata: { taklab_route: plan } },
        geometry: { type: 'LineString', coordinates: coords },
    };
}

function put(body: object, query = '') {
    return flight.fetch(`/api/profile/feature${query}`, {
        method: 'PUT', auth: { bearer: flight.token.admin }, body,
    }, true);
}

function xml(cot: CoT): string {
    return CoTParser.to_xml(cot);
}

test('PUT submit trasy z planem: jeden CoT z __taklab_route i bez adresata (do wszystkich)', async () => {
    sent.length = 0;
    await put(route(), '?submit=true');
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].length, 1);
    const text = xml(sent[0][0]);
    assert.match(text, /<__taklab_route /);
    assert.doesNotMatch(text, /<marti/);
    assert.doesNotMatch(text, /<dest /);
});

test('PUT bez submit: nic nie wysłane', async () => {
    sent.length = 0;
    await put(route('route-2'));
    assert.strictEqual(sent.length, 0);
});

test('PUT submit znacznika a-f-G: bez planu i bez adresata', async () => {
    sent.length = 0;
    await put({
        id: 'marker-1', type: 'Feature', path: '/',
        properties: { type: 'a-f-G', how: 'm-g', time, start: time, stale: time, callsign: 'Znacznik', archived: true, center: [17.05, 51.1], metadata: { taklab_route: plan } },
        geometry: { type: 'Point', coordinates: [17.03, 51.11, 0] },
    }, '?submit=true');
    assert.strictEqual(sent.length, 1);
    const text = xml(sent[0][0]);
    assert.doesNotMatch(text, /__taklab_route/);
    assert.doesNotMatch(text, /ANDROID-1/);
});

test('PUT submit bez archiwizacji też dopisuje plan, bez adresata', async () => {
    sent.length = 0;
    await put(route('route-3'), '?submit=true&archive=false');
    assert.strictEqual(sent.length, 1);
    const text = xml(sent[0][0]);
    assert.match(text, /<__taklab_route /);
    assert.doesNotMatch(text, /<marti/);
    assert.doesNotMatch(text, /<dest /);
});

test('DELETE submit trasy: t-x-d-d z link jako pierwszym dzieckiem detail', async () => {
    sent.length = 0;
    await flight.fetch('/api/profile/feature/route-1?submit=true', {
        method: 'DELETE', auth: { bearer: flight.token.admin },
    }, true);
    assert.strictEqual(sent.length, 1);
    const text = xml(sent[0][0]);
    assert.match(text, /type="t-x-d-d"/);
    assert.match(text, /<detail><link [^>]*\/>/);
    const link = text.match(/<detail><link ([^>]*)\/>/)![1];
    assert.match(link, /uid="route-1"/);
    assert.match(link, /relation="p-p"/);
    assert.match(link, /type="b-m-r"/);
    assert.match(text, /<__forcedelete\/>/);
    // do wszystkich: bez adresata
    assert.doesNotMatch(text, /<marti/);
    assert.doesNotMatch(text, /<dest /);
    // zdarzenie usuwające ma własny uid, nie uid trasy
    assert.doesNotMatch(text, /<event [^>]*uid="route-1"/);
});

test('DELETE bez submit: nic nie wysłane', async () => {
    sent.length = 0;
    await flight.fetch('/api/profile/feature/route-2', {
        method: 'DELETE', auth: { bearer: flight.token.admin },
    }, true);
    assert.strictEqual(sent.length, 0);
});

test('DELETE submit znacznika: nic nie wysłane', async () => {
    sent.length = 0;
    await flight.fetch('/api/profile/feature/marker-1?submit=true', {
        method: 'DELETE', auth: { bearer: flight.token.admin },
    }, true);
    assert.strictEqual(sent.length, 0);
});

test('DELETE submit nieistniejącej cechy: 404 jak dotąd i bez wysyłki', async () => {
    sent.length = 0;
    const res = await flight.fetch('/api/profile/feature/nie-ma?submit=true', {
        method: 'DELETE', auth: { bearer: flight.token.admin },
    }, false);
    assert.strictEqual(res.status, 404);
    assert.strictEqual(sent.length, 0);
});

test('DELETE submit trasy: błąd wysyłki nie psuje odpowiedzi po usunięciu w bazie', async () => {
    await put(route('route-4'));
    const submit = flight.config!.hub.submitCots;
    flight.config!.hub.submitCots = async () => {
        throw new Error('hub down');
    };
    try {
        const res = await flight.fetch('/api/profile/feature/route-4?submit=true', {
            method: 'DELETE', auth: { bearer: flight.token.admin },
        }, true);
        assert.strictEqual(res.status, 200);
    } finally {
        flight.config!.hub.submitCots = submit;
    }
});

test('PUT submit trasy z archiwizacją: błąd wysyłki nie psuje odpowiedzi, cecha zapisana, zdarzenie wysłane', async () => {
    const submit = flight.config!.hub.submitCots;
    const notify = flight.config!.hub.wsNotify;
    const events: unknown[] = [];
    flight.config!.hub.submitCots = async () => {
        throw new Error('Profile auth certificate not configured');
    };
    flight.config!.hub.wsNotify = async (_username, event) => {
        events.push(event);
    };
    try {
        const res = await put(route('route-5'), '?submit=true');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.id, 'route-5');
        assert.deepStrictEqual(res.body.properties.metadata.taklab_route.waypoints, plan.waypoints);

        const saved = await flight.fetch('/api/profile/feature/route-5', {
            method: 'GET', auth: { bearer: flight.token.admin },
        }, true);
        assert.strictEqual(saved.body.id, 'route-5');

        assert.ok(events.some((e) => {
            const data = (e as { data: { type: string; action: string; id: string } }).data;
            return data.type === 'feature' && data.action === 'update' && data.id === 'route-5';
        }));
    } finally {
        flight.config!.hub.submitCots = submit;
        flight.config!.hub.wsNotify = notify;
    }
});

test('PUT submit bez archiwizacji: błąd wysyłki nadal zwraca błąd', async () => {
    const submit = flight.config!.hub.submitCots;
    flight.config!.hub.submitCots = async () => {
        throw new Error('hub down');
    };
    try {
        const res = await flight.fetch('/api/profile/feature?submit=true&archive=false', {
            method: 'PUT', auth: { bearer: flight.token.admin }, body: route('route-6'),
        }, false);
        assert.notStrictEqual(res.status, 200);
    } finally {
        flight.config!.hub.submitCots = submit;
    }
});

flight.landing();
