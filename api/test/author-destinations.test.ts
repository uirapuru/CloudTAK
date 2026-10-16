import test from 'node:test';
import assert from 'node:assert';
import { authorDestinations, defaultFetchEndpoints, deps } from '../common/author-destinations.js';
import { profileUid } from '../common/control/takserver.js';
import type Config from '../common/config.js';

const config = {} as Config;
const me = 'jan';

test('urządzenia autora bez połączenia CloudTAK', async () => {
    const uids = await authorDestinations(config, me, async () => [
        { uid: 'ANDROID-1', username: 'jan' },
        { uid: profileUid('jan'), username: 'jan' },
        { uid: 'ANDROID-2', username: 'ola' },
        { uid: 'ANDROID-3', username: 'jan' },
    ]);
    assert.deepStrictEqual(uids, ['ANDROID-1', 'ANDROID-3']);
});

test('brak urządzeń = sam uid połączenia CloudTAK', async () => {
    assert.deepStrictEqual(await authorDestinations(config, me, async () => []), [profileUid('jan')]);
});

test('błąd clientEndPoints = sam uid połączenia CloudTAK', async () => {
    const failing = async () => {
        throw new Error('500');
    };
    assert.deepStrictEqual(await authorDestinations(config, me, failing), [profileUid('jan')]);
});

test('deps.fetchEndpoints podmienia domyślne pobieranie, argument ma pierwszeństwo', async () => {
    const original = deps.fetchEndpoints;
    deps.fetchEndpoints = async () => [{ uid: 'DEP-1', username: 'jan' }];
    try {
        assert.deepStrictEqual(await authorDestinations(config, me), ['DEP-1']);
        assert.deepStrictEqual(await authorDestinations(config, me, async () => [{ uid: 'ARG-1', username: 'jan' }]), ['ARG-1']);
    } finally {
        deps.fetchEndpoints = original;
    }
});

function stubApi(status: number, payload: unknown) {
    let drained = false;
    const api = {
        url: new URL('https://tak.example.com:8443'),
        // dokładny kształt z APIAuthCertificate.fetch(raw): status + text + json, bez `ok`
        fetch: async () => ({
            status,
            text: async () => {
                drained = true;
                return JSON.stringify(payload);
            },
            json: async () => payload,
        }),
    };
    return { api, drained: () => drained };
}

test('defaultFetchEndpoints czyta data[] z odpowiedzi w kształcie APIAuthCertificate', async () => {
    const { api } = stubApi(200, { data: [
        { callsign: 'A', uid: 'ANDROID-1', username: 'jan', lastEventTime: 1, lastStatus: 'Connected' },
        { callsign: 'B', uid: 'ANDROID-2', username: 'ola' },
    ] });
    const endpoints = await defaultFetchEndpoints('jan', config, async () => api);
    assert.deepStrictEqual(endpoints, [
        { uid: 'ANDROID-1', username: 'jan' },
        { uid: 'ANDROID-2', username: 'ola' },
    ]);
});

test('defaultFetchEndpoints: status 500 kończy się błędem i zużywa ciało', async () => {
    const stub = stubApi(500, { error: 'x' });
    await assert.rejects(defaultFetchEndpoints('jan', config, async () => stub.api), /status 500/);
    assert.strictEqual(stub.drained(), true);
});

test('defaultFetchEndpoints: wiszący TAK po limicie czasu daje sam uid połączenia CloudTAK', async () => {
    let signal: AbortSignal | undefined;
    const hanging = {
        url: new URL('https://tak.example.com:8443'),
        fetch: (_url: URL, opts: object) => {
            signal = (opts as { signal?: AbortSignal }).signal;
            return new Promise<never>(() => undefined);
        },
    };
    const started = Date.now();
    const uids = await authorDestinations(config, me, u => defaultFetchEndpoints(u, config, async () => hanging, 50));
    assert.deepStrictEqual(uids, [profileUid('jan')]);
    assert.ok(Date.now() - started < 2000);
    // sygnał trafia do klienta TAK, żeby undici zerwało żądanie
    assert.ok(signal instanceof AbortSignal);
});
