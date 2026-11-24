import Err from '@openaddresses/batch-error';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';
import { Agent, fetch as undiciFetch } from 'undici';

const TIMEOUT_MS = 15_000;
/** A video file streams for as long as the player reads it. */
const FILE_TIMEOUT_MS = 6 * 60 * 60_000;
/** Usage tells the proxy whether the caller is an OTS administrator; asked at most once a minute per account. */
const ADMIN_CACHE_MS = 60_000;
const MAX_AGENTS = 64;

/** Headers of the file answer that reach the browser; Range support needs all of them. */
const PASSED_FILE_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

export const RECORDING_KINDS = ['video', 'voice', 'scan'] as const;
export type RecordingKind = typeof RECORDING_KINDS[number];

export type CertAuth = { cert: string; key: string };

/** One recording as the browser sees it; `can_manage` = rename and delete allowed. */
export type Recording = {
    id: string;
    kind: RecordingKind;
    account: string;
    callsign: string;
    uid: string;
    name: string;
    started_at: string;
    ended_at: string | null;
    duration_s: number | null;
    lat: number | null;
    lon: number | null;
    size_bytes: number | null;
    has_text: boolean;
    can_manage: boolean;
};

/** Track point as OTS stores it: [lat, lon, time]. */
export type TrackPoint = [number, number, number | string | null];

export type RecordingDetail = Recording & {
    track: TrackPoint[];
    text: string | null;
};

export type RecordingList = {
    enabled: boolean;
    admin: boolean;
    page: number;
    total_pages: number | null;
    items: Recording[];
};

export type RecordingUsage = {
    admin: boolean;
    used_bytes: number | null;
    limit_bytes: number | null;
};

export type RecordingQuery = {
    kind?: string;
    account?: string;
    from?: string;
    to?: string;
    page?: number;
};

/** Transport to OTS: one HTTPS request with the caller's client certificate. */
export type OtsTransport = (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
    auth: CertAuth,
) => Promise<Response>;

const agents = new Map<string, Agent>();

/**
 * Default transport: TLS with the user's certificate to the OTS Marti/TLS
 * proxy (server.api, https://<env>-ots:8443), the same identity CloudTAK
 * uses for every other OTS call on behalf of a user. Agents are kept per
 * certificate so video Range requests reuse the connection.
 */
export const certTransport: OtsTransport = async (url, init, auth) => {
    let agent = agents.get(auth.cert);
    if (!agent) {
        if (agents.size >= MAX_AGENTS) {
            const [oldest, old] = agents.entries().next().value as [string, Agent];
            agents.delete(oldest);
            old.close().catch(() => undefined);
        }
        // The pod-internal OTS certificate names <env>.taklab.eu, not <env>-ots: same as @tak-ps/node-tak.
        agent = new Agent({ connect: { cert: auth.cert, key: auth.key, rejectUnauthorized: false } });
        agents.set(auth.cert, agent);
    }
    return await undiciFetch(url, { ...init, dispatcher: agent }) as unknown as Response;
};

function str(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
}

function num(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/** OTS ids go into the URL path: digits, letters, dash and underscore only. */
export function safeId(id: string | number): string {
    const text = String(id);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(text)) throw new Err(400, null, 'Nieprawidłowy identyfikator nagrania');
    return encodeURIComponent(text);
}

/** Lower-cased account names; OTS usernames are case sensitive, but CloudTAK logins are not. */
function same(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function normalizeRecording(raw: unknown, user: string, admin: boolean): Recording | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const id = str(r.id);
    const kind = str(r.kind) as RecordingKind;
    if (!id || !RECORDING_KINDS.includes(kind)) return null;
    const account = str(r.account);

    // OTS may answer with its own flag; otherwise the decision from the design: author or administrator.
    const flag = typeof r.can_manage === 'boolean' ? r.can_manage
        : typeof r.can_delete === 'boolean' ? r.can_delete
            : undefined;

    return {
        id,
        kind,
        account,
        callsign: str(r.callsign),
        uid: str(r.uid),
        name: str(r.name),
        started_at: str(r.started_at),
        ended_at: r.ended_at ? str(r.ended_at) : null,
        duration_s: num(r.duration_s),
        lat: num(r.lat),
        lon: num(r.lon),
        size_bytes: num(r.size_bytes),
        has_text: Boolean(r.has_text),
        can_manage: flag ?? (admin || (account !== '' && same(account, user))),
    };
}

export function normalizeTrack(raw: unknown): TrackPoint[] {
    if (!Array.isArray(raw)) return [];
    const out: TrackPoint[] = [];
    for (const p of raw) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const lat = num(p[0]);
        const lon = num(p[1]);
        if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
        const t = p[2];
        out.push([lat, lon, typeof t === 'number' || typeof t === 'string' ? t : null]);
    }
    return out;
}

/** List answer: a bare array or an object with items/results/recordings, optionally paginated. */
export function listItems(body: unknown): { items: unknown[]; page: number | null; total_pages: number | null } {
    if (Array.isArray(body)) return { items: body, page: null, total_pages: null };
    if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        const items = [b.items, b.results, b.recordings].find(Array.isArray) as unknown[] | undefined;
        return { items: items || [], page: num(b.page), total_pages: num(b.total_pages ?? b.pages) };
    }
    return { items: [], page: null, total_pages: null };
}

export function normalizeUsage(body: unknown): RecordingUsage {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const gb = 1024 ** 3;
    const used = num(b.used_bytes ?? b.used ?? b.bytes_used) ?? (num(b.used_gb) !== null ? Number(b.used_gb) * gb : null);
    const limit = num(b.limit_bytes ?? b.limit ?? b.bytes_limit ?? b.quota_bytes) ?? (num(b.limit_gb) !== null ? Number(b.limit_gb) * gb : null);
    return { admin: true, used_bytes: used, limit_bytes: limit };
}

/** Browser filters to the OTS query: only the contract keys, kind checked, dates as ISO 8601 UTC. */
export function otsQuery(q: RecordingQuery): string {
    const params = new URLSearchParams();
    if (q.kind && RECORDING_KINDS.includes(q.kind as RecordingKind)) params.set('kind', q.kind);
    if (q.account && q.account.trim()) params.set('account', q.account.trim());
    for (const key of ['from', 'to'] as const) {
        const value = q[key];
        if (!value) continue;
        const ms = new Date(value).getTime();
        if (!Number.isFinite(ms)) throw new Err(400, null, `Nieprawidłowa data w polu ${key}`);
        params.set(key, new Date(ms).toISOString());
    }
    if (q.page !== undefined && q.page > 1) params.set('page', String(q.page));
    const text = params.toString();
    return text ? `?${text}` : '';
}

/**
 * Proxy to the recording register of the environment's OpenTAK Server
 * (/api/taklab/recordings, fork taklab). CloudTAK checks its own login and
 * calls OTS with the caller's client certificate, so OTS applies its group
 * rules to the real account; the browser never talks to OTS directly.
 */
export class RecordingsControl {
    transport: OtsTransport = certTransport;
    now: () => number = Date.now;
    private admins = new Map<string, { admin: boolean; at: number }>();

    constructor(private baseUrl: () => string | null) {}

    private base(): string {
        const base = (this.baseUrl() || '').trim().replace(/\/+$/, '');
        if (!base) throw new Err(404, null, 'Nagrania nie są dostępne w tym środowisku');
        return `${base}/api/taklab/recordings`;
    }

    private async request(path: string, auth: CertAuth, opts: {
        method?: string;
        body?: unknown;
        headers?: Record<string, string>;
        timeout?: number;
    } = {}): Promise<Response> {
        const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
        let body: string | undefined;
        if (opts.body !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(opts.body);
        }
        try {
            return await this.transport(`${this.base()}${path}`, {
                method: opts.method || 'GET',
                headers,
                body,
                signal: AbortSignal.timeout(opts.timeout ?? TIMEOUT_MS),
            }, auth);
        } catch (err) {
            if (err instanceof Err) throw err;
            throw new Err(502, err instanceof Error ? err : new Error(String(err)), 'Serwer TAK nie odpowiada');
        }
    }

    /** OTS status to a CloudTAK error with a Polish message; OTS text is not passed on (it may name other accounts). */
    static async check(res: Response): Promise<Response> {
        if (res.ok) return res;
        const status = res.status;
        await res.body?.cancel().catch(() => undefined);
        if (status === 401 || status === 403) throw new Err(403, null, 'Brak dostępu do tego nagrania');
        if (status === 404) throw new Err(404, null, 'Nie ma takiego nagrania');
        if (status === 400 || status === 422) throw new Err(400, null, 'Serwer TAK odrzucił żądanie');
        if (status === 416) throw new Err(416, null, 'Zakres poza plikiem');
        throw new Err(502, null, `Serwer TAK odpowiedział ${status}`);
    }

    async usage(user: string, auth: CertAuth): Promise<RecordingUsage> {
        const res = await this.request('/usage', auth);
        if (res.status === 401 || res.status === 403 || res.status === 404) {
            await res.body?.cancel().catch(() => undefined);
            this.admins.set(user, { admin: false, at: this.now() });
            return { admin: false, used_bytes: null, limit_bytes: null };
        }
        await RecordingsControl.check(res);
        this.admins.set(user, { admin: true, at: this.now() });
        return normalizeUsage(await res.json());
    }

    async isAdmin(user: string, auth: CertAuth): Promise<boolean> {
        const cached = this.admins.get(user);
        if (cached && this.now() - cached.at < ADMIN_CACHE_MS) return cached.admin;
        try {
            return (await this.usage(user, auth)).admin;
        } catch {
            // Usage down must not hide the list; OTS checks rename and delete itself.
            return false;
        }
    }

    async list(user: string, auth: CertAuth, q: RecordingQuery): Promise<RecordingList> {
        const query = otsQuery(q);
        const [res, admin] = await Promise.all([this.request(query, auth), this.isAdmin(user, auth)]);
        if (res.status === 404) {
            // No register route in this OTS (older image): the menu says so instead of an error.
            await res.body?.cancel().catch(() => undefined);
            return { enabled: false, admin: false, page: 1, total_pages: null, items: [] };
        }
        await RecordingsControl.check(res);
        const body = listItems(await res.json());
        return {
            enabled: true,
            admin,
            page: body.page ?? (q.page || 1),
            total_pages: body.total_pages,
            items: body.items
                .map((r) => normalizeRecording(r, user, admin))
                .filter((r): r is Recording => r !== null),
        };
    }

    async get(user: string, auth: CertAuth, id: string | number): Promise<RecordingDetail> {
        const [res, admin] = await Promise.all([this.request(`/${safeId(id)}`, auth), this.isAdmin(user, auth)]);
        await RecordingsControl.check(res);
        const raw = await res.json() as Record<string, unknown>;
        const rec = normalizeRecording(raw, user, admin);
        if (!rec) throw new Err(502, null, 'Serwer TAK zwrócił nieprawidłowe nagranie');
        return {
            ...rec,
            track: normalizeTrack(raw.track),
            text: typeof raw.text === 'string' ? raw.text : null,
        };
    }

    async rename(user: string, auth: CertAuth, id: string | number, name: string): Promise<RecordingDetail> {
        const clean = name.trim();
        if (!clean) throw new Err(400, null, 'Nazwa nie może być pusta');
        const res = await this.request(`/${safeId(id)}`, auth, { method: 'PATCH', body: { name: clean } });
        await RecordingsControl.check(res);
        await res.body?.cancel().catch(() => undefined);
        return await this.get(user, auth, id);
    }

    async remove(auth: CertAuth, id: string | number): Promise<void> {
        const res = await this.request(`/${safeId(id)}`, auth, { method: 'DELETE' });
        await RecordingsControl.check(res);
        await res.body?.cancel().catch(() => undefined);
    }

    /**
     * Stream the file to the browser. The Range header goes to OTS as is and
     * 206 with Content-Range comes back, so <video> can seek without the
     * proxy reading the whole file.
     */
    async file(auth: CertAuth, id: string | number, range: string | undefined, res: ExpressResponse, download: boolean): Promise<void> {
        const headers: Record<string, string> = { Accept: '*/*' };
        if (range && /^bytes=[0-9]*-[0-9]*(,\s*[0-9]*-[0-9]*)*$/.test(range)) headers.Range = range;
        const upstream = await RecordingsControl.check(await this.request(`/${safeId(id)}/file`, auth, { headers, timeout: FILE_TIMEOUT_MS }));

        res.status(upstream.status);
        for (const name of PASSED_FILE_HEADERS) {
            const value = upstream.headers.get(name);
            if (value) res.setHeader(name, value);
        }
        if (!upstream.headers.get('accept-ranges')) res.setHeader('accept-ranges', 'bytes');
        const disposition = upstream.headers.get('content-disposition');
        if (download) res.setHeader('content-disposition', disposition && disposition.startsWith('attachment') ? disposition : 'attachment');
        else res.setHeader('content-disposition', 'inline');
        res.setHeader('cache-control', 'private, no-store');

        if (!upstream.body) {
            res.end();
            return;
        }
        await new Promise<void>((resolve, reject) => {
            const stream = Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>);
            stream.on('error', (err) => {
                // The player closing a Range read is normal; only a failure before the first byte is an error.
                if (res.headersSent) resolve();
                else reject(err);
            });
            res.on('finish', () => resolve());
            res.on('close', () => {
                stream.destroy();
                resolve();
            });
            stream.pipe(res);
        });
    }
}
