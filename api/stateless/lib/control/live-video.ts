import Err from '@openaddresses/batch-error';
import { certTransport, type CertAuth, type OtsTransport } from './recordings.js';

const TIMEOUT_MS = 10_000;

export type LiveVideoTrack = {
    codec: string | null;
    width: number | null;
    height: number | null;
    profile: string | null;
    level: string | null;
    fps: number | null;
};

export type LiveAudioTrack = {
    codec: string | null;
    sample_rate: number | null;
    channels: number | null;
};

/** MediaMTX state of one path as OTS reports it; any field may be null when MediaMTX does not know it. */
export type LiveVideoTech = {
    source: string | null;
    transport: string | null;
    readers: number | null;
    bytes_received: number | null;
    bitrate_kbps: number | null;
    packets_lost: number | null;
    jitter_ms: number | null;
    video: LiveVideoTrack | null;
    audio: LiveAudioTrack | null;
};

export type LiveVideoStream = {
    path: string;
    username: string;
    started_at: string | null;
    tech: LiveVideoTech | null;
};

export type LiveVideoList = {
    /** false: the OTS of this environment has no /api/taklab/video/live (older image). */
    supported: boolean;
    generated_at?: string | null;
    streams: LiveVideoStream[];
};

function str(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

function num(value: unknown): number | null {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function obj(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeVideoTrack(raw: unknown): LiveVideoTrack | null {
    const v = obj(raw);
    if (!v) return null;
    return {
        codec: str(v.codec),
        width: num(v.width),
        height: num(v.height),
        profile: str(v.profile),
        level: str(v.level),
        fps: num(v.fps),
    };
}

function normalizeAudioTrack(raw: unknown): LiveAudioTrack | null {
    const a = obj(raw);
    if (!a) return null;
    return {
        codec: str(a.codec),
        sample_rate: num(a.sample_rate),
        channels: num(a.channels),
    };
}

export function normalizeTech(raw: unknown): LiveVideoTech | null {
    const t = obj(raw);
    if (!t) return null;
    return {
        source: str(t.source),
        transport: str(t.transport),
        readers: num(t.readers),
        bytes_received: num(t.bytes_received),
        bitrate_kbps: num(t.bitrate_kbps),
        packets_lost: num(t.packets_lost),
        jitter_ms: num(t.jitter_ms),
        video: normalizeVideoTrack(t.video),
        audio: normalizeAudioTrack(t.audio),
    };
}

/**
 * One stream of the OTS answer, contract fields only: anything else OTS may
 * add (a sender address, for one) never reaches the browser.
 */
export function normalizeStream(raw: unknown): LiveVideoStream | null {
    const s = obj(raw);
    if (!s) return null;
    const path = str(s.path)?.trim();
    if (!path) return null;
    return {
        path,
        username: str(s.username) ?? '',
        started_at: str(s.started_at),
        tech: normalizeTech(s.tech),
    };
}

export function normalizeLiveList(body: unknown): LiveVideoList {
    const b = obj(body);
    const streams = Array.isArray(b?.streams) ? b.streams : [];
    const seen = new Set<string>();
    const out: LiveVideoStream[] = [];
    for (const raw of streams) {
        const stream = normalizeStream(raw);
        if (!stream || seen.has(stream.path)) continue;
        seen.add(stream.path);
        out.push(stream);
    }
    return {
        supported: true,
        generated_at: str(b?.generated_at),
        streams: out,
    };
}

/**
 * Proxy to the live stream list of the environment's OpenTAK Server
 * (/api/taklab/video/live, fork taklab). Same identity as the recordings
 * proxy: the caller's client certificate against the Marti TLS proxy.
 */
export class LiveVideoControl {
    transport: OtsTransport = certTransport;

    constructor(public baseUrl: () => string | null) {}

    private url(): string {
        const base = (this.baseUrl() || '').trim().replace(/\/+$/, '');
        if (!base) throw new Err(404, null, 'Transmisje na żywo nie są dostępne w tym środowisku');
        return `${base}/api/taklab/video/live`;
    }

    async list(auth: CertAuth): Promise<LiveVideoList> {
        let res: Response;
        try {
            res = await this.transport(this.url(), {
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            }, auth);
        } catch (err) {
            if (err instanceof Err) throw err;
            throw new Err(502, err instanceof Error ? err : new Error(String(err)), 'Serwer TAK nie odpowiada');
        }

        if (res.status === 404) {
            // No live route in this OTS (older image): the browser stops asking.
            await res.body?.cancel().catch(() => undefined);
            return { supported: false, streams: [] };
        }

        if (!res.ok) {
            const status = res.status;
            await res.body?.cancel().catch(() => undefined);
            if (status === 401 || status === 403) throw new Err(403, null, 'Brak dostępu do listy transmisji');
            throw new Err(502, null, `Serwer TAK odpowiedział ${status}`);
        }

        let body: unknown;
        try {
            body = await res.json();
        } catch {
            throw new Err(502, null, 'Serwer TAK zwrócił nieprawidłową listę transmisji');
        }
        return normalizeLiveList(body);
    }
}

/** Shared instance; the router points it at the OTS address, tests swap its transport. */
export const liveVideoControl = new LiveVideoControl(() => null);
