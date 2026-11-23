import Err from '@openaddresses/batch-error';

const TIMEOUT_MS = 15_000;
/** OTS paginates /api/users (default 10, a page past the end is a 404). */
const PER_PAGE = 100;
/** Hard stop against a misbehaving server: 100 pages of 100 accounts. */
const MAX_PAGES = 100;
const ADMIN_USERNAME = 'administrator';
const ADMIN_ROLE = 'administrator';

export type OtsAccount = {
    username: string;
    roles: string[];
    active: boolean;
};

export type OtsAccountsStatus = {
    enabled: boolean;
    administrator: boolean;
    atak: boolean;
    icu: boolean;
    reason?: string;
};

export type OtsQrType = 'atak' | 'icu';

type OtsUser = {
    username?: unknown;
    active?: unknown;
    roles?: unknown;
};

type Settings = {
    password: string;
    host: string | null;
    cotPort: number | null;
    rtspPort: number | null;
};

function port(value: string | undefined): number | null {
    const n = Number((value || '').trim());
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

function roleNames(roles: unknown): string[] {
    if (!Array.isArray(roles)) return [];
    return roles
        .map(r => (r && typeof r === 'object' ? (r as { name?: unknown }).name : r))
        .filter((r): r is string => typeof r === 'string');
}

/**
 * Read-only view of the OTS accounts for OTS administrators, with ATAK
 * enrollment and OpenTAK ICU QR codes.
 *
 * CloudTAK keeps only a certificate of the logged-in user, and the OTS
 * /api/user* routes need a Flask-Security session with the administrator
 * role. So the server logs in as the OTS `administrator` account
 * (OTS_ADMIN_PASSWORD from the environment secret) and checks the caller's
 * role itself on every request. Neither the admin password, the OTS session
 * token nor the `token` field of /api/users ever leaves this class; the
 * enrollment token of an account leaves only inside the QR string.
 */
export class OtsAccountsControl {
    fetch: typeof fetch = globalThis.fetch;

    private otsUrl: string;
    private session: string | null = null;

    constructor(otsUrl: string) {
        this.otsUrl = otsUrl.replace(/\/+$/, '');
    }

    static atakUri(host: string, cotPort: number, username: string, token: string): string {
        return `tak://com.atakmap.app/enroll?host=${encodeURIComponent(host)}:${cotPort}`
            + `&username=${encodeURIComponent(username)}&token=${encodeURIComponent(token)}`;
    }

    static icuUri(host: string, rtspPort: number, username: string, token: string): string {
        const name = encodeURIComponent(username);
        return `opentakicu://import?protocol=rtsp&address=${encodeURIComponent(host)}&port=${rtspPort}`
            + `&path=${name}&username=${name}&password=${encodeURIComponent(token)}`;
    }

    private settings(): Settings | null {
        const password = process.env.OTS_ADMIN_PASSWORD || '';
        if (!password) return null;
        const host = (process.env.OTS_ACCOUNTS_HOST || '').trim() || null;
        return {
            password,
            host,
            cotPort: port(process.env.OTS_ACCOUNTS_COT_PORT),
            rtspPort: port(process.env.OTS_ACCOUNTS_RTSP_PORT),
        };
    }

    private requireSettings(): Settings {
        const settings = this.settings();
        if (!settings) throw new Err(404, null, 'Lista kont serwera nie jest włączona w tym środowisku');
        return settings;
    }

    private static available(settings: Settings, type: OtsQrType): boolean {
        if (!settings.host) return false;
        return type === 'atak' ? settings.cotPort !== null : settings.rtspPort !== null;
    }

    private async send(path: string, init: RequestInit): Promise<Response> {
        try {
            return await this.fetch(`${this.otsUrl}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
        } catch (err) {
            throw new Err(502, err instanceof Error ? err : new Error(String(err)), 'Serwer OTS nie odpowiada');
        }
    }

    private async login(settings: Settings): Promise<string> {
        const res = await this.send('/api/login?include_auth_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ username: ADMIN_USERNAME, password: settings.password }),
        });
        let token: unknown;
        if (res.ok) {
            const body = await res.json().catch(() => ({})) as { response?: { user?: { authentication_token?: unknown } } };
            token = body.response?.user?.authentication_token;
        }
        if (typeof token !== 'string' || !token) {
            throw new Err(503, null, 'CloudTAK nie może zalogować się do OTS jako administrator. Sprawdź hasło administratora w sekrecie środowiska');
        }
        this.session = token;
        return token;
    }

    /** One request with the admin session; an expired session gets exactly one re-login. */
    private async request(settings: Settings, path: string, init: RequestInit = {}): Promise<Response> {
        for (let attempt = 0; attempt < 2; attempt++) {
            const session = this.session || await this.login(settings);
            const res = await this.send(path, {
                ...init,
                headers: {
                    'Accept': 'application/json',
                    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
                    'Authentication-Token': session,
                },
            });
            if (res.status !== 401 && res.status !== 403) return res;
            this.session = null;
        }
        throw new Err(503, null, 'OTS odrzuca sesję administratora');
    }

    private async users(settings: Settings): Promise<OtsAccount[]> {
        const accounts: OtsAccount[] = [];
        for (let page = 1; page <= MAX_PAGES; page++) {
            const res = await this.request(settings, `/api/users?page=${page}&per_page=${PER_PAGE}`);
            // A page past the end is a 404; the first page never is.
            if (res.status === 404 && page > 1) break;
            if (!res.ok) throw new Err(502, null, `OTS odpowiedział ${res.status} na listę kont`);
            const body = await res.json() as { results?: OtsUser[]; total_pages?: unknown };
            for (const u of body.results || []) {
                if (typeof u.username !== 'string') continue;
                accounts.push({
                    username: u.username,
                    roles: roleNames(u.roles),
                    active: u.active !== false,
                });
            }
            const pages = Number(body.total_pages);
            if (!Number.isFinite(pages) || page >= pages) break;
        }
        return accounts;
    }

    private static isAdministrator(accounts: OtsAccount[], caller: string): boolean {
        const name = caller.trim().toLowerCase();
        const account = accounts.find(a => a.username.toLowerCase() === name);
        return !!account && account.active && account.roles.includes(ADMIN_ROLE);
    }

    private async authorized(settings: Settings, caller: string): Promise<OtsAccount[]> {
        const accounts = await this.users(settings);
        if (!OtsAccountsControl.isAdministrator(accounts, caller)) {
            throw new Err(403, null, 'Lista kont serwera jest dostępna tylko dla administratora OTS');
        }
        return accounts;
    }

    async status(caller: string): Promise<OtsAccountsStatus> {
        const settings = this.settings();
        if (!settings) {
            return { enabled: false, administrator: false, atak: false, icu: false, reason: 'Brak hasła administratora OTS w konfiguracji CloudTAK' };
        }
        const accounts = await this.users(settings);
        return {
            enabled: true,
            administrator: OtsAccountsControl.isAdministrator(accounts, caller),
            atak: OtsAccountsControl.available(settings, 'atak'),
            icu: OtsAccountsControl.available(settings, 'icu'),
        };
    }

    async list(caller: string): Promise<OtsAccount[]> {
        return await this.authorized(this.requireSettings(), caller);
    }

    async qr(caller: string, username: string, type: OtsQrType): Promise<{ type: OtsQrType; uri: string }> {
        const settings = this.requireSettings();
        const accounts = await this.authorized(settings, caller);
        const account = accounts.find(a => a.username === username);
        if (!account) throw new Err(404, null, `Nie ma konta ${username}`);
        if (!OtsAccountsControl.available(settings, type)) {
            throw new Err(409, null, type === 'atak'
                ? 'Kod ATAK wymaga dostępu po nazwie serwera'
                : 'Środowisko nie ma wideo');
        }

        const token = await this.enrollmentToken(settings, account.username);
        const host = settings.host as string;
        const uri = type === 'atak'
            ? OtsAccountsControl.atakUri(host, settings.cotPort as number, account.username, token)
            : OtsAccountsControl.icuUri(host, settings.rtspPort as number, account.username, token);
        return { type, uri };
    }

    /**
     * Existing token first: POST /api/atak_qr_string resets `disabled` of
     * the account's token, so it is called only when the account has none.
     * Only `token` is taken from the OTS string; OTS 1.8.3 puts its in-pod
     * streaming port into `host`, which is not the port the phone reaches.
     */
    private async enrollmentToken(settings: Settings, username: string): Promise<string> {
        let res = await this.request(settings, `/api/atak_qr_string?username=${encodeURIComponent(username)}`);
        if (res.status === 404) {
            res = await this.request(settings, '/api/atak_qr_string', {
                method: 'POST',
                body: JSON.stringify({ username }),
            });
        }
        if (!res.ok) throw new Err(502, null, `OTS odpowiedział ${res.status} na token rejestracji`);
        const body = await res.json() as { qr_string?: unknown };
        let token: string | null = null;
        if (typeof body.qr_string === 'string') {
            try {
                token = new URL(body.qr_string).searchParams.get('token');
            } catch {
                token = null;
            }
        }
        if (!token) throw new Err(502, null, 'OTS nie podał tokenu rejestracji');
        return token;
    }
}

const controls = new Map<string, OtsAccountsControl>();

/** One control (and one admin session) per OTS address; the address can change via PATCH /api/server. */
export function otsAccountsControl(otsUrl: string): OtsAccountsControl {
    let control = controls.get(otsUrl);
    if (!control) {
        control = new OtsAccountsControl(otsUrl);
        controls.set(otsUrl, control);
    }
    return control;
}
