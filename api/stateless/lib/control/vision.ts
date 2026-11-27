import Err from '@openaddresses/batch-error';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';
import { certTransport, type CertAuth, type OtsTransport } from './recordings.js';

const TIMEOUT_MS = 15_000;

export const ANALYSIS_STATES = ['queued', 'running', 'done', 'stopped', 'error'] as const;
export type AnalysisState = typeof ANALYSIS_STATES[number];

export type Analysis = {
    id: number;
    source: 'live' | 'recording';
    label: string;
    account: string | null;
    created_by: string;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    state: AnalysisState;
    percent: number | null;
    elapsed_s: number | null;
    persons: number;
    error: string | null;
};

export type LiveSource = {
    path: string;
    account: string | null;
    ready_time: string | null;
    analysis: number | null;
};

export type RecordingSource = {
    id: string;
    name: string;
    account: string | null;
    started_at: string;
    duration_s: number | null;
};

export type FaceMoment = { moment: string; at: string; sighting_id: number };

export type AnalysisFace = {
    id: number;
    label: string;
    count: number;
    /** CloudTAK path of the thumbnail; the browser adds its token. */
    thumb_url: string;
    moments: FaceMoment[];
};

export type AnalysisChoice =
    | { source: 'live'; path: string }
    | { source: 'recording'; recording_id: string };

function str(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    return '';
}

function strOrNull(value: unknown): string | null {
    const text = str(value);
    return text === '' ? null : text;
}

function num(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function int(value: unknown): number | null {
    const n = num(value);
    return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

/** Analysis and person ids go into the OTS path: whole numbers only. */
export function safeNumber(value: string | number): string {
    const text = String(value);
    if (!/^[0-9]{1,9}$/.test(text)) throw new Err(400, null, 'Nieprawidłowy identyfikator analizy');
    return text;
}

export function normalizeAnalysis(raw: unknown): Analysis | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const id = int(r.id);
    const source = r.source === 'live' || r.source === 'recording' ? r.source : null;
    if (id === null || source === null) return null;
    const state = ANALYSIS_STATES.includes(r.state as AnalysisState) ? r.state as AnalysisState : 'error';
    return {
        id,
        source,
        label: str(r.label),
        account: strOrNull(r.account),
        created_by: str(r.created_by),
        created_at: str(r.created_at),
        started_at: strOrNull(r.started_at),
        finished_at: strOrNull(r.finished_at),
        state,
        percent: num(r.percent),
        elapsed_s: num(r.elapsed_s),
        persons: int(r.persons) ?? 0,
        error: strOrNull(r.error),
    };
}

export function normalizeSources(body: unknown): { live: LiveSource[]; recordings: RecordingSource[] } {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const live: LiveSource[] = [];
    for (const raw of Array.isArray(b.live) ? b.live : []) {
        if (!raw || typeof raw !== 'object') continue;
        const s = raw as Record<string, unknown>;
        const path = str(s.path);
        if (!path) continue;
        live.push({ path, account: strOrNull(s.account), ready_time: strOrNull(s.ready_time), analysis: int(s.analysis) });
    }
    const recordings: RecordingSource[] = [];
    for (const raw of Array.isArray(b.recordings) ? b.recordings : []) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        const id = str(r.id);
        if (!id) continue;
        recordings.push({
            id,
            name: str(r.name),
            account: strOrNull(r.account),
            started_at: str(r.started_at),
            duration_s: num(r.duration_s),
        });
    }
    return { live, recordings };
}

const OTS_THUMB = /^\/api\/taklab\/vision\/analyses\/([0-9]{1,9})\/persons\/([0-9]{1,9})\/thumb\.jpg$/;

export function normalizeFaces(body: unknown): AnalysisFace[] {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const out: AnalysisFace[] = [];
    for (const raw of Array.isArray(b.items) ? b.items : []) {
        if (!raw || typeof raw !== 'object') continue;
        const f = raw as Record<string, unknown>;
        const id = int(f.id);
        if (id === null) continue;
        // The thumbnail goes through this proxy; any other address from OTS is dropped.
        const match = OTS_THUMB.exec(str(f.thumb_url));
        const moments: FaceMoment[] = [];
        for (const m of Array.isArray(f.moments) ? f.moments : []) {
            if (!m || typeof m !== 'object') continue;
            const mm = m as Record<string, unknown>;
            const sighting = int(mm.sighting_id);
            if (sighting === null) continue;
            moments.push({ moment: str(mm.moment), at: str(mm.at), sighting_id: sighting });
        }
        out.push({
            id,
            label: str(f.label),
            count: int(f.count) ?? 0,
            thumb_url: match ? `/api/vision/analyses/${match[1]}/persons/${match[2]}/thumb.jpg` : '',
            moments,
        });
    }
    return out;
}

export function choiceBody(body: unknown): AnalysisChoice {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    if (b.source === 'live' && typeof b.path === 'string' && b.path.trim() && b.path.length <= 256) {
        return { source: 'live', path: b.path.trim() };
    }
    if (b.source === 'recording' && typeof b.recording_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(b.recording_id)) {
        return { source: 'recording', recording_id: b.recording_id };
    }
    throw new Err(400, null, 'Wybierz transmisję albo nagranie');
}

/**
 * Proxy to on-demand video analysis of the environment's OpenTAK Server
 * (/api/taklab/vision, fork taklab). Like the recordings proxy it calls OTS
 * with the caller's client certificate through marti-tls, so OTS decides who
 * is an administrator; CloudTAK adds no access rule of its own.
 */
export class VisionControl {
    transport: OtsTransport = certTransport;

    constructor(private baseUrl: () => string | null) {}

    private base(): string {
        const base = (this.baseUrl() || '').trim().replace(/\/+$/, '');
        if (!base) throw new Err(404, null, 'Analiza wideo nie jest włączona na tym serwerze');
        return `${base}/api/taklab/vision`;
    }

    private async request(path: string, auth: CertAuth, opts: { method?: string; body?: unknown; accept?: string } = {}): Promise<Response> {
        const headers: Record<string, string> = { Accept: opts.accept || 'application/json' };
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
                signal: AbortSignal.timeout(TIMEOUT_MS),
            }, auth);
        } catch (err) {
            if (err instanceof Err) throw err;
            throw new Err(502, err instanceof Error ? err : new Error(String(err)), 'Serwer TAK nie odpowiada');
        }
    }

    /**
     * OTS status to a CloudTAK error. OTS and the vision service answer with
     * short Polish messages about the analysis itself (queue full, stream not
     * live), so those pass through; anything long or odd gets a default.
     */
    static async check(res: Response): Promise<Response> {
        if (res.ok) return res;
        const status = res.status;
        let message: string | null = null;
        try {
            const body = await res.json() as { error?: unknown };
            if (typeof body?.error === 'string' && body.error.length > 0 && body.error.length <= 300) message = body.error;
        } catch {
            // not JSON
        }
        if (status === 401 || status === 403) throw new Err(403, null, 'Analiza wideo jest dostępna tylko dla administratora');
        if (status === 404) throw new Err(404, null, message || 'Nie ma takiej analizy');
        if (status === 400 || status === 409 || status === 422 || status === 429) {
            throw new Err(status === 422 ? 400 : status, null, message || 'Serwer TAK odrzucił żądanie');
        }
        if (status === 503) throw new Err(503, null, message || 'Usługa analizy wideo nie odpowiada');
        throw new Err(502, null, `Serwer TAK odpowiedział ${status}`);
    }

    /** enabled=false for anyone who cannot use it: feature off, not an administrator, older OTS. */
    async status(auth: CertAuth): Promise<{ enabled: boolean }> {
        let res: Response;
        try {
            res = await this.request('/status', auth);
        } catch {
            return { enabled: false };
        }
        if (!res.ok) {
            await res.body?.cancel().catch(() => undefined);
            return { enabled: false };
        }
        const body = await res.json().catch(() => null) as { enabled?: unknown } | null;
        return { enabled: body?.enabled === true };
    }

    async sources(auth: CertAuth): Promise<{ live: LiveSource[]; recordings: RecordingSource[] }> {
        const res = await VisionControl.check(await this.request('/sources', auth));
        return normalizeSources(await res.json());
    }

    async list(auth: CertAuth): Promise<Analysis[]> {
        const res = await VisionControl.check(await this.request('/analyses', auth));
        const body = await res.json() as { analyses?: unknown };
        return (Array.isArray(body?.analyses) ? body.analyses : [])
            .map(normalizeAnalysis)
            .filter((a): a is Analysis => a !== null);
    }

    private static one(raw: unknown): Analysis {
        const a = normalizeAnalysis(raw);
        if (!a) throw new Err(502, null, 'Serwer TAK zwrócił nieprawidłową analizę');
        return a;
    }

    async start(auth: CertAuth, choice: AnalysisChoice): Promise<Analysis> {
        const res = await VisionControl.check(await this.request('/analyses', auth, { method: 'POST', body: choice }));
        return VisionControl.one(await res.json());
    }

    async get(auth: CertAuth, id: string | number): Promise<Analysis> {
        const res = await VisionControl.check(await this.request(`/analyses/${safeNumber(id)}`, auth));
        return VisionControl.one(await res.json());
    }

    async stop(auth: CertAuth, id: string | number): Promise<Analysis> {
        const res = await VisionControl.check(await this.request(`/analyses/${safeNumber(id)}/stop`, auth, { method: 'POST' }));
        return VisionControl.one(await res.json());
    }

    async faces(auth: CertAuth, id: string | number): Promise<AnalysisFace[]> {
        const res = await VisionControl.check(await this.request(`/analyses/${safeNumber(id)}/faces`, auth));
        return normalizeFaces(await res.json());
    }

    async thumb(auth: CertAuth, id: string | number, person: string | number, res: ExpressResponse): Promise<void> {
        const upstream = await VisionControl.check(await this.request(
            `/analyses/${safeNumber(id)}/persons/${safeNumber(person)}/thumb.jpg`, auth, { accept: 'image/jpeg' },
        ));
        res.status(200);
        res.setHeader('content-type', 'image/jpeg');
        res.setHeader('cache-control', 'private, no-store');
        if (!upstream.body) {
            res.end();
            return;
        }
        await new Promise<void>((resolve, reject) => {
            const stream = Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>);
            stream.on('error', (err) => (res.headersSent ? resolve() : reject(err)));
            res.on('finish', () => resolve());
            res.on('close', () => {
                stream.destroy();
                resolve();
            });
            stream.pipe(res);
        });
    }
}
