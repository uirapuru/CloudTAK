import test from 'node:test';
import assert from 'node:assert';
import { OtsAccountsControl, USERNAME_PATTERN } from '../stateless/lib/control/ots-accounts.js';

const OTS = 'http://ots.test:8081';

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

type OtsUser = { username: string; active?: boolean; roles: Array<{ name: string }>; [key: string]: unknown };

function user(username: string, roles: string[] = ['user'], extra: Record<string, unknown> = {}): OtsUser {
    return { username, active: true, roles: roles.map(name => ({ name, description: name })), ...extra };
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Fake OTS: login, paginated /api/users and /api/atak_qr_string. `handlers`
 * override single routes ("METHOD /path") for a test.
 */
function fakeOts(users: OtsUser[], handlers: Record<string, (call: Call, n: number) => Response | undefined> = {}) {
    const calls: Call[] = [];
    const counts: Record<string, number> = {};
    let session = 0;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method || 'GET';
        const call: Call = {
            method,
            url: String(input),
            headers: (init?.headers || {}) as Record<string, string>,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
        };
        calls.push(call);
        const key = `${method} ${url.pathname}`;
        counts[key] = (counts[key] || 0) + 1;
        const override = handlers[key]?.(call, counts[key]);
        if (override) return override;

        if (key === 'POST /api/login') {
            session++;
            return json({ meta: { code: 200 }, response: { user: { authentication_token: `SESSION${session}` } } });
        }
        if (!call.headers['Authentication-Token']?.startsWith('SESSION')) return json({}, 401);
        if (key === 'GET /api/users') {
            const page = Number(url.searchParams.get('page') || 1);
            const perPage = Number(url.searchParams.get('per_page') || 10);
            const pages = Math.max(1, Math.ceil(users.length / perPage));
            if (page > pages) return json({}, 404);
            return json({
                results: users.slice((page - 1) * perPage, page * perPage),
                total_pages: pages,
                current_page: page,
                per_page: perPage,
                total: users.length,
            });
        }
        return json({ success: false }, 404);
    }) as typeof fetch;
    return { fetch: fetchImpl, calls, counts };
}

function setEnv(env: Record<string, string | undefined>) {
    for (const key of ['OTS_ADMIN_PASSWORD', 'OTS_ACCOUNTS_HOST', 'OTS_ACCOUNTS_COT_PORT', 'OTS_ACCOUNTS_RTSP_PORT']) {
        if (env[key] === undefined) delete process.env[key];
        else process.env[key] = env[key];
    }
}

const FULL_ENV = {
    OTS_ADMIN_PASSWORD: 'adminpass',
    OTS_ACCOUNTS_HOST: 'e.taklab.eu',
    OTS_ACCOUNTS_COT_PORT: '30002',
    OTS_ACCOUNTS_RTSP_PORT: '30006',
};

const ADMIN = user('administrator', ['administrator'], { token: 'ADMIN-AUTH-TOKEN' });

function control(ots: ReturnType<typeof fakeOts>): OtsAccountsControl {
    const c = new OtsAccountsControl(OTS);
    c.fetch = ots.fetch;
    return c;
}

const status = (code: number) => (err: { status: number }) => err.status === code;

test('atakUri and icuUri encode values and keep host:port', () => {
    assert.equal(
        OtsAccountsControl.atakUri('e.taklab.eu', 30002, 'jan.k_1', 'a+b/c='),
        'tak://com.atakmap.app/enroll?host=e.taklab.eu:30002&username=jan.k_1&token=a%2Bb%2Fc%3D',
    );
    assert.equal(
        OtsAccountsControl.icuUri('e.taklab.eu', 30006, 'jan.k_1', 'a+b/c='),
        'opentakicu://import?protocol=rtsp&address=e.taklab.eu&port=30006&path=jan.k_1&username=jan.k_1&password=a%2Bb%2Fc%3D',
    );
});

test('without OTS_ADMIN_PASSWORD status is disabled and nothing is called', async () => {
    setEnv({ ...FULL_ENV, OTS_ADMIN_PASSWORD: undefined });
    const ots = fakeOts([ADMIN]);
    const c = control(ots);
    const s = await c.status('administrator');
    assert.equal(s.enabled, false);
    assert.equal(s.administrator, false);
    assert.equal(s.atak, false);
    assert.equal(s.icu, false);
    assert.ok(s.reason && s.reason.length > 0);
    await assert.rejects(c.list('administrator'), status(404));
    assert.equal(ots.calls.length, 0);
});

test('logs in with include_auth_token and sends Authentication-Token', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([ADMIN]);
    await control(ots).list('administrator');
    assert.equal(ots.calls[0].method, 'POST');
    assert.equal(ots.calls[0].url, `${OTS}/api/login?include_auth_token`);
    assert.deepEqual(ots.calls[0].body, { username: 'administrator', password: 'adminpass' });
    for (const call of ots.calls.slice(1)) {
        assert.equal(call.headers['Authentication-Token'], 'SESSION1');
    }
});

test('list walks all pages and stops on total_pages', async () => {
    setEnv(FULL_ENV);
    const users = [ADMIN, ...Array.from({ length: 199 }, (_, i) => user(`user${i}`))];
    const ots = fakeOts(users);
    const list = await control(ots).list('administrator');
    assert.equal(list.length, 200);
    assert.equal(ots.counts['GET /api/users'], 2);
});

test('list strips tokens and other fields', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([user('administrator', ['administrator'], { token: 'SECRET-TOKEN', email: 'a@b', euds: [{ uid: 'x' }] })]);
    const list = await control(ots).list('administrator');
    assert.deepEqual(list, [{ username: 'administrator', roles: ['administrator'], active: true }]);
    assert.ok(!JSON.stringify(list).includes('SECRET-TOKEN'));
});

test('caller without administrator role gets 403', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([ADMIN, user('jan')]);
    await assert.rejects(control(ots).list('jan'), status(403));
});

test('caller unknown to OTS gets 403', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([ADMIN]);
    await assert.rejects(control(ots).list('obcy'), status(403));
});

test('caller check is case-insensitive on username', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([ADMIN]);
    const list = await control(ots).list('Administrator');
    assert.equal(list.length, 1);
});

test('status reports administrator and code availability', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([ADMIN, user('jan')]);
    const c = control(ots);
    assert.deepEqual(await c.status('administrator'), { enabled: true, administrator: true, atak: true, icu: true });
    assert.deepEqual(await c.status('jan'), { enabled: true, administrator: false, atak: true, icu: true });
});

test('expired session triggers exactly one re-login', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([ADMIN], {
        'GET /api/users': (call, n) => (n === 1 ? json({}, 401) : undefined),
    });
    const list = await control(ots).list('administrator');
    assert.equal(list.length, 1);
    assert.equal(ots.counts['POST /api/login'], 2);
    assert.equal(ots.calls.at(-1)?.headers['Authentication-Token'], 'SESSION2');
});

test('session is reused between requests', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([ADMIN]);
    const c = control(ots);
    await c.list('administrator');
    await c.list('administrator');
    assert.equal(ots.counts['POST /api/login'], 1);
});

test('persistent 401 after re-login gives 503, not a login loop', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([ADMIN], { 'GET /api/users': () => json({}, 401) });
    await assert.rejects(control(ots).list('administrator'), status(503));
    assert.equal(ots.counts['POST /api/login'], 2);
});

test('wrong admin password gives 503, not 500', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([ADMIN], { 'POST /api/login': () => json({ meta: { code: 400 } }, 400) });
    await assert.rejects(control(ots).list('administrator'), status(503));
    assert.equal(ots.counts['POST /api/login'], 1);
});

test('unreachable OTS gives 502', async () => {
    setEnv(FULL_ENV);
    const c = new OtsAccountsControl(OTS);
    c.fetch = (async () => {
        throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    await assert.rejects(c.list('administrator'), status(502));
});

const QR = (token: string, host = 'ots.test') => `tak://com.atakmap.app/enroll?host=${host}&username=jan&token=${token}`;

test('qr uses existing token without POST', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([ADMIN, user('jan')], {
        'GET /api/atak_qr_string': (call) => {
            assert.equal(new URL(call.url).searchParams.get('username'), 'jan');
            return json({ success: true, qr_string: QR('TOK') });
        },
    });
    const qr = await control(ots).qr('administrator', 'jan', 'atak');
    assert.deepEqual(qr, { type: 'atak', uri: OtsAccountsControl.atakUri('e.taklab.eu', 30002, 'jan', 'TOK') });
    assert.equal(ots.counts['POST /api/atak_qr_string'] || 0, 0);
});

test('qr ignores host and port returned by OTS', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([ADMIN, user('jan')], {
        'GET /api/atak_qr_string': () => json({ success: true, qr_string: QR('TOK', 'inny.host:8089') }),
    });
    const qr = await control(ots).qr('administrator', 'jan', 'atak');
    assert.equal(qr.uri, OtsAccountsControl.atakUri('e.taklab.eu', 30002, 'jan', 'TOK'));
});

test('qr creates token when none exists', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([ADMIN, user('jan')], {
        'GET /api/atak_qr_string': () => json({ success: false }, 404),
        'POST /api/atak_qr_string': (call) => {
            assert.deepEqual(call.body, { username: 'jan' });
            return json({ success: true, qr_string: QR('NEW') });
        },
    });
    const qr = await control(ots).qr('administrator', 'jan', 'icu');
    assert.deepEqual(qr, { type: 'icu', uri: OtsAccountsControl.icuUri('e.taklab.eu', 30006, 'jan', 'NEW') });
    assert.equal(ots.counts['POST /api/atak_qr_string'], 1);
});

test('qr type unavailable gives 409', async () => {
    setEnv({ ...FULL_ENV, OTS_ACCOUNTS_RTSP_PORT: undefined });
    const ots = fakeOts([ADMIN, user('jan')], {
        'GET /api/atak_qr_string': () => json({ success: true, qr_string: QR('TOK') }),
    });
    const c = control(ots);
    await assert.rejects(c.qr('administrator', 'jan', 'icu'), status(409));
    assert.equal((await c.qr('administrator', 'jan', 'atak')).type, 'atak');
    assert.equal((await c.status('administrator')).icu, false);
});

test('qr without host disables both codes', async () => {
    setEnv({ ...FULL_ENV, OTS_ACCOUNTS_HOST: undefined });
    const ots = fakeOts([ADMIN, user('jan')]);
    const c = control(ots);
    const s = await c.status('administrator');
    assert.equal(s.atak, false);
    assert.equal(s.icu, false);
    await assert.rejects(c.qr('administrator', 'jan', 'atak'), status(409));
});

test('qr for unknown account gives 404', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([ADMIN]);
    await assert.rejects(control(ots).qr('administrator', 'nikt', 'atak'), status(404));
    assert.equal(ots.counts['GET /api/atak_qr_string'] || 0, 0);
});

test('qr requires administrator role', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([ADMIN, user('jan')]);
    await assert.rejects(control(ots).qr('jan', 'jan', 'atak'), status(403));
    assert.equal(ots.counts['GET /api/atak_qr_string'] || 0, 0);
});

test('username pattern accepts what OTS UsernameValidator accepts', () => {
    const re = new RegExp(USERNAME_PATTERN, 'u');
    for (const name of ['jan', 'jan.k_1', 'michał', 'Żołnierz2']) assert.ok(re.test(name), name);
    for (const name of ['', 'a b', 'a/b', 'a-b', 'x'.repeat(65)]) assert.ok(!re.test(name), name);
});

test('qr for a non-ASCII account name is encoded', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([ADMIN, user('michał')], {
        'GET /api/atak_qr_string': (call) => {
            assert.equal(new URL(call.url).searchParams.get('username'), 'michał');
            return json({ success: true, qr_string: 'tak://com.atakmap.app/enroll?host=x&username=michał&token=TOK' });
        },
    });
    const qr = await control(ots).qr('administrator', 'michał', 'atak');
    assert.equal(qr.uri, 'tak://com.atakmap.app/enroll?host=e.taklab.eu:30002&username=micha%C5%82&token=TOK');
});

for (const [name, token] of [
    ['disabled', { disabled: true }],
    ['expired', { exp: 1000 }],
    ['used up', { max: 3, total_uses: 3 }],
] as const) {
    test(`qr refuses a ${name} enrollment token with 409 and does not POST`, async () => {
        setEnv(FULL_ENV);
        const ots = fakeOts([ADMIN, user('jan')], {
            'GET /api/atak_qr_string': () => json({ success: true, qr_string: QR('TOK'), ...token }),
        });
        await assert.rejects(control(ots).qr('administrator', 'jan', 'atak'), status(409));
        assert.equal(ots.counts['POST /api/atak_qr_string'] || 0, 0);
    });
}

test('qr accepts a token with future expiry and uses left', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([ADMIN, user('jan')], {
        'GET /api/atak_qr_string': () => json({
            success: true, qr_string: QR('TOK'), disabled: null, exp: Math.floor(Date.now() / 1000) + 3600, max: 3, total_uses: 2,
        }),
    });
    assert.equal((await control(ots).qr('administrator', 'jan', 'atak')).type, 'atak');
});

test('caller match prefers the exact username over a case-insensitive one', async () => {
    setEnv(FULL_ENV);
    const ots = fakeOts([user('Jan', ['administrator']), user('jan')]);
    const c = control(ots);
    await assert.rejects(c.list('jan'), status(403));
    assert.equal((await c.list('Jan')).length, 2);
    // Ambiguous without an exact match: refuse.
    await assert.rejects(c.list('JAN'), status(403));
});
