import Err from '@openaddresses/batch-error';
import { Type } from '@sinclair/typebox';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';
import { certTransport, type CertAuth, type OtsTransport } from './recordings.js';

const TIMEOUT_MS = 30_000;
/** PDF of up to 20 000 entries is rendered by OTS before the first byte. */
const PDF_TIMEOUT_MS = 10 * 60_000;
/** A ZIP with every video file of an exercise may take hours to download. */
const ZIP_TIMEOUT_MS = 12 * 60 * 60_000;

export const PER_PAGE_MAX = 200;
export const PDF_MAX_ENTRIES = 20_000;

export const JOURNAL_KINDS = [
    'object_add', 'object_change', 'object_delete', 'position', 'disconnect', 'chat',
    'video_share', 'file_upload', 'file_send', 'alert', 'casevac',
    'recording_video', 'recording_voice', 'recording_scan', 'recording_delete', 'journal_export',
] as const;
export type JournalKind = typeof JOURNAL_KINDS[number];

export const FILE_SOURCES = ['data_package', 'mission_content', 'recording'] as const;

/** Headers of the export answer that reach the browser. */
const PASSED_EXPORT_HEADERS = ['content-type', 'content-length', 'last-modified'];

// Response schemas: batch-schema runs AJV with removeAdditional 'all', so every field of the
// OTS contract (Entry in docs/superpowers/specs/2026-11-24-journal-design.md) is named here.
const NullableString = Type.Union([Type.Null(), Type.String()]);
const NullableNumber = Type.Union([Type.Null(), Type.Number()]);

export const JournalRecipientSchema = Type.Object({
    callsign: NullableString,
    uid: NullableString,
    account: NullableString,
});

export const JournalFileSchema = Type.Object({
    source: Type.String(),
    ref: Type.String(),
    filename: Type.String(),
    size: NullableNumber,
    mime: NullableString,
    available: Type.Boolean(),
});

export const JournalEntrySchema = Type.Object({
    id: Type.Integer(),
    at: Type.String(),
    kind: Type.String(),
    account: NullableString,
    callsign: NullableString,
    device_uid: NullableString,
    object_uid: NullableString,
    object_type: NullableString,
    title: Type.String(),
    text: NullableString,
    private: Type.Boolean(),
    recipients: Type.Array(JournalRecipientSchema),
    chatroom: NullableString,
    lat: NullableNumber,
    lon: NullableNumber,
    mission: NullableString,
    file: Type.Union([Type.Null(), JournalFileSchema]),
});

export const JournalListSchema = Type.Object({
    items: Type.Array(JournalEntrySchema),
    total: Type.Integer(),
    page: Type.Integer(),
    per_page: Type.Integer(),
});

export const JournalAccessSchema = Type.Object({ admin: Type.Boolean() });

export const JournalAccountsSchema = Type.Object({
    accounts: Type.Array(Type.Object({
        account: Type.String(),
        callsigns: Type.Array(Type.String()),
    })),
});

export const JournalEstimateSchema = Type.Object({
    entries: Type.Integer(),
    files: Type.Integer(),
    bytes: Type.Number(),
    missing: Type.Integer(),
});

export type JournalRecipient = { callsign: string | null; uid: string | null; account: string | null };

export type JournalFile = {
    source: string;
    ref: string;
    filename: string;
    size: number | null;
    mime: string | null;
    available: boolean;
};

export type JournalEntry = {
    id: number;
    at: string;
    kind: string;
    account: string | null;
    callsign: string | null;
    device_uid: string | null;
    object_uid: string | null;
    object_type: string | null;
    title: string;
    text: string | null;
    private: boolean;
    recipients: JournalRecipient[];
    chatroom: string | null;
    lat: number | null;
    lon: number | null;
    mission: string | null;
    file: JournalFile | null;
};

export type JournalList = { items: JournalEntry[]; total: number; page: number; per_page: number };
export type JournalAccount = { account: string; callsigns: string[] };
export type JournalEstimate = { entries: number; files: number; bytes: number; missing: number };

/** Filters shared by the list and both exports (contract names). */
export type JournalQuery = {
    since?: string;
    until?: string;
    account?: string;
    kind?: string;
    q?: string;
    positions?: boolean;
    page?: number;
    per_page?: number;
};

function text(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
}

function num(value: unknown): number | null {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function count(value: unknown): number {
    const n = num(value);
    return n === null || n < 0 ? 0 : Math.floor(n);
}

function coord(value: unknown, limit: number): number | null {
    const n = num(value);
    return n === null || Math.abs(n) > limit ? null : n;
}

export function normalizeRecipient(raw: unknown): JournalRecipient | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const out = { callsign: text(r.callsign), uid: text(r.uid), account: text(r.account) };
    return out.callsign || out.uid || out.account ? out : null;
}

export function normalizeFile(raw: unknown): JournalFile | null {
    if (!raw || typeof raw !== 'object') return null;
    const f = raw as Record<string, unknown>;
    const filename = text(f.filename) ?? '';
    const ref = text(f.ref) ?? '';
    if (!filename && !ref) return null;
    return {
        source: text(f.source) ?? '',
        ref,
        filename,
        size: num(f.size),
        mime: text(f.mime),
        // A file OTS does not vouch for is shown as unavailable, never as present.
        available: f.available === true,
    };
}

export function normalizeEntry(raw: unknown): JournalEntry | null {
    if (!raw || typeof raw !== 'object') return null;
    const e = raw as Record<string, unknown>;
    const id = num(e.id);
    const at = text(e.at);
    const kind = text(e.kind);
    if (id === null || !Number.isInteger(id) || !at || !kind) return null;
    return {
        id,
        at,
        kind,
        account: text(e.account),
        callsign: text(e.callsign),
        device_uid: text(e.device_uid),
        object_uid: text(e.object_uid),
        object_type: text(e.object_type),
        title: text(e.title) ?? '',
        text: text(e.text),
        private: e.private === true,
        recipients: Array.isArray(e.recipients)
            ? e.recipients.map(normalizeRecipient).filter((r): r is JournalRecipient => r !== null)
            : [],
        chatroom: text(e.chatroom),
        lat: coord(e.lat, 90),
        lon: coord(e.lon, 180),
        mission: text(e.mission),
        file: normalizeFile(e.file),
    };
}

export function normalizeList(body: unknown, q: JournalQuery): JournalList {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const items = (Array.isArray(b.items) ? b.items : [])
        .map(normalizeEntry)
        .filter((e): e is JournalEntry => e !== null);
    return {
        items,
        total: num(b.total) !== null ? count(b.total) : items.length,
        page: count(b.page) || q.page || 1,
        per_page: count(b.per_page) || q.per_page || items.length,
    };
}

export function normalizeAccounts(body: unknown): JournalAccount[] {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    if (!Array.isArray(b.accounts)) return [];
    const out: JournalAccount[] = [];
    for (const raw of b.accounts) {
        if (!raw || typeof raw !== 'object') continue;
        const a = raw as Record<string, unknown>;
        const account = text(a.account);
        if (!account) continue;
        const callsigns = Array.isArray(a.callsigns)
            ? a.callsigns.map(text).filter((c): c is string => Boolean(c))
            : [];
        out.push({ account, callsigns });
    }
    return out;
}

export function normalizeEstimate(body: unknown): JournalEstimate {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    return { entries: count(b.entries), files: count(b.files), bytes: num(b.bytes) ?? 0, missing: count(b.missing) };
}

function list(value: string, check: (item: string) => boolean, what: string): string {
    const items = value.split(',').map((s) => s.trim()).filter(Boolean);
    for (const item of items) if (!check(item)) throw new Err(400, null, `Nieprawidłowa wartość w polu ${what}`);
    return items.join(',');
}

/** Browser filters to the OTS query: contract keys only, values checked, dates as ISO 8601 UTC. */
export function otsQuery(q: JournalQuery, withPaging = true): string {
    const params = new URLSearchParams();
    for (const key of ['since', 'until'] as const) {
        const value = q[key];
        if (!value) continue;
        const ms = new Date(value).getTime();
        if (!Number.isFinite(ms)) throw new Err(400, null, `Nieprawidłowa data w polu ${key}`);
        params.set(key, new Date(ms).toISOString());
    }
    if (q.account && q.account.trim()) {
        const accounts = list(q.account, (a) => a.length <= 128, 'account');
        if (accounts) params.set('account', accounts);
    }
    if (q.kind && q.kind.trim()) {
        const kinds = list(q.kind, (k) => (JOURNAL_KINDS as readonly string[]).includes(k), 'kind');
        if (kinds) params.set('kind', kinds);
    }
    if (q.q && q.q.trim()) params.set('q', q.q.trim());
    params.set('positions', q.positions ? '1' : '0');
    if (withPaging) {
        if (q.page !== undefined && q.page > 1) params.set('page', String(Math.floor(q.page)));
        if (q.per_page !== undefined) params.set('per_page', String(Math.min(PER_PAGE_MAX, Math.max(1, Math.floor(q.per_page)))));
    }
    return `?${params.toString()}`;
}

export type ExportFormat = 'pdf' | 'zip';

const EXPORT_DEFAULTS: Record<ExportFormat, { type: string; name: string; timeout: number }> = {
    pdf: { type: 'application/pdf', name: 'dziennik.pdf', timeout: PDF_TIMEOUT_MS },
    zip: { type: 'application/zip', name: 'dziennik.zip', timeout: ZIP_TIMEOUT_MS },
};

/**
 * Proxy to the event journal of the environment's OpenTAK Server
 * (/api/taklab/journal, fork taklab). CloudTAK calls OTS with the caller's
 * client certificate through marti-tls, so OTS itself decides whether the
 * account holds the administrator role; CloudTAK adds no rule of its own.
 */
export class JournalControl {
    transport: OtsTransport = certTransport;

    constructor(private baseUrl: () => string | null) {}

    private base(): string {
        const base = (this.baseUrl() || '').trim().replace(/\/+$/, '');
        if (!base) throw new Err(404, null, 'Dziennik nie jest dostępny w tym środowisku');
        return `${base}/api/taklab/journal`;
    }

    private async request(path: string, auth: CertAuth, accept: string, timeout = TIMEOUT_MS): Promise<Response> {
        try {
            return await this.transport(`${this.base()}${path}`, {
                method: 'GET',
                headers: { Accept: accept },
                signal: AbortSignal.timeout(timeout),
            }, auth);
        } catch (err) {
            if (err instanceof Err) throw err;
            throw new Err(502, err instanceof Error ? err : new Error(String(err)), 'Serwer TAK nie odpowiada');
        }
    }

    /** OTS status to a CloudTAK error with a Polish message; the OTS text is not passed on. */
    static async check(res: Response): Promise<Response> {
        if (res.ok) return res;
        const status = res.status;
        await res.body?.cancel().catch(() => undefined);
        if (status === 401 || status === 403) throw new Err(403, null, 'Dziennik jest dostępny tylko dla administratora serwera');
        if (status === 404) throw new Err(404, null, 'Ten serwer nie prowadzi jeszcze dziennika');
        if (status === 413) throw new Err(413, null, `Za dużo wpisów do PDF (limit ${PDF_MAX_ENTRIES}). Zawęź filtr.`);
        if (status === 400 || status === 422) throw new Err(400, null, 'Serwer TAK odrzucił filtr dziennika');
        throw new Err(502, null, `Serwer TAK odpowiedział ${status}`);
    }

    private async json(path: string, auth: CertAuth): Promise<unknown> {
        const res = await JournalControl.check(await this.request(path, auth, 'application/json'));
        return await res.json();
    }

    /** admin=false also when OTS has no journal yet (404) or refuses the account: the menu stays hidden. */
    async access(auth: CertAuth): Promise<{ admin: boolean }> {
        const res = await this.request('/access', auth, 'application/json');
        if (res.status === 401 || res.status === 403 || res.status === 404) {
            await res.body?.cancel().catch(() => undefined);
            return { admin: false };
        }
        await JournalControl.check(res);
        const body = await res.json() as Record<string, unknown> | null;
        return { admin: Boolean(body && body.admin === true) };
    }

    async list(auth: CertAuth, q: JournalQuery): Promise<JournalList> {
        return normalizeList(await this.json(otsQuery(q), auth), q);
    }

    async accounts(auth: CertAuth): Promise<{ accounts: JournalAccount[] }> {
        return { accounts: normalizeAccounts(await this.json('/accounts', auth)) };
    }

    async estimate(auth: CertAuth, q: JournalQuery): Promise<JournalEstimate> {
        return normalizeEstimate(await this.json(`/export/estimate${otsQuery(q, false)}`, auth));
    }

    /**
     * Stream the PDF or ZIP from OTS to the browser chunk by chunk: the ZIP
     * may hold gigabytes of video, so nothing is collected in memory, the
     * pipe follows the browser's pace and a closed tab cancels the OTS read.
     */
    async export(auth: CertAuth, format: ExportFormat, q: JournalQuery, res: ExpressResponse): Promise<void> {
        const defaults = EXPORT_DEFAULTS[format];
        const upstream = await JournalControl.check(await this.request(
            `/export.${format}${otsQuery(q, false)}`, auth, defaults.type, defaults.timeout,
        ));

        res.status(200);
        for (const name of PASSED_EXPORT_HEADERS) {
            const value = upstream.headers.get(name);
            if (value) res.setHeader(name, value);
        }
        if (!upstream.headers.get('content-type')) res.setHeader('content-type', defaults.type);
        const disposition = upstream.headers.get('content-disposition');
        res.setHeader('content-disposition', disposition && /^attachment\b/i.test(disposition)
            ? disposition
            : `attachment; filename="${defaults.name}"`);
        res.setHeader('cache-control', 'private, no-store');
        // nginx in front of the CloudTAK API must not spool a multi-gigabyte ZIP to disk.
        res.setHeader('x-accel-buffering', 'no');

        if (!upstream.body) {
            res.end();
            return;
        }
        await new Promise<void>((resolve, reject) => {
            const stream = Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>);
            stream.on('error', (err) => {
                if (!res.headersSent) {
                    reject(err);
                    return;
                }
                // Headers are gone: cut the connection so the browser sees a broken download, not a short file.
                res.destroy(err);
                resolve();
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
