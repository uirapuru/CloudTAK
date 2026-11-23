import Err from '@openaddresses/batch-error';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';

const TIMEOUT_MS = 15_000;
/** Export builds a ZIP of up to 30 days of recordings before the first byte. */
const EXPORT_TIMEOUT_MS = 10 * 60_000;

/** Headers of a binary answer that reach the browser; everything else stays behind. */
const PASSED_HEADERS = ['content-type', 'content-length', 'content-disposition'];

export type VoiceRecording = {
    id: number;
    channel: string;
    author: string;
    source: string;
    started_at: string;
    ended_at: string;
    started_ts: number;
    duration_s: number;
    transcript: string | null;
    transcript_status: string;
    transcript_attempts: number;
};

export type VoiceQuery = {
    channel?: string;
    since?: number;
    until?: number;
    before_id?: number;
    limit?: number;
    ids?: string;
};

/**
 * Proxy to the taklab voice-log service of the environment (VOICE_URL, shared
 * token VOICE_TOKEN). The browser never talks to the service: it has no user
 * accounts, CloudTAK checks the login and forwards the caller's username in
 * X-Voice-User for the service log.
 */
export class VoiceControl {
    fetch: typeof fetch = globalThis.fetch;

    /**
     * Accounts that may see the history, play and download recordings
     * (VOICE_HISTORY_USERS, comma separated; taklab decision of 23 XI 2026:
     * only the environment administrator). Empty = nobody. Live listening
     * and PTT on the map are for everyone - that is the radio, not history.
     */
    canSeeHistory(user: string): boolean {
        const allowed = (process.env.VOICE_HISTORY_USERS || '')
            .split(',')
            .map(u => u.trim().toLowerCase())
            .filter(Boolean);
        return allowed.includes(user.trim().toLowerCase());
    }

    requireHistory(user: string): void {
        if (!this.canSeeHistory(user)) {
            throw new Err(403, null, 'Historia głosu jest dostępna tylko dla administratora środowiska');
        }
    }

    baseUrl(): string | null {
        const url = (process.env.VOICE_URL || '').trim().replace(/\/+$/, '');
        return url || null;
    }

    private async request(path: string, user: string, timeout = TIMEOUT_MS, method = 'GET'): Promise<Response> {
        const base = this.baseUrl();
        if (!base) throw new Err(404, null, 'Rejestr głosu nie jest włączony w tym środowisku');

        let res: Response;
        try {
            res = await this.fetch(`${base}${path}`, {
                method,
                headers: {
                    'X-Voice-Token': process.env.VOICE_TOKEN || '',
                    'X-Voice-User': user,
                },
                signal: AbortSignal.timeout(timeout),
            });
        } catch (err) {
            throw new Err(502, err instanceof Error ? err : new Error(String(err)), 'Usługa rejestru głosu nie odpowiada');
        }

        if (res.status === 404) throw new Err(404, null, 'Brak nagrań');
        if (!res.ok) throw new Err(502, null, `Usługa rejestru głosu odpowiedziała ${res.status}`);
        return res;
    }

    static query(q: VoiceQuery): string {
        const params = new URLSearchParams();
        for (const key of ['channel', 'since', 'until', 'before_id', 'limit', 'ids'] as const) {
            const value = q[key];
            if (value !== undefined && value !== '') params.set(key, String(value));
        }
        const text = params.toString();
        return text ? `?${text}` : '';
    }

    async status(user: string): Promise<{ enabled: boolean } & Record<string, unknown>> {
        if (!this.baseUrl()) return { enabled: false };
        const body = await (await this.request('/api/v1/status', user)).json() as Record<string, unknown>;
        return { ...body, enabled: true, history: this.canSeeHistory(user) };
    }

    async recordings(user: string, q: VoiceQuery): Promise<{ items: VoiceRecording[] }> {
        this.requireHistory(user);
        return await (await this.request(`/api/v1/recordings${VoiceControl.query(q)}`, user)).json() as { items: VoiceRecording[] };
    }

    async audio(user: string, id: number, res: ExpressResponse, download: boolean): Promise<void> {
        this.requireHistory(user);
        await this.pipe(await this.request(`/api/v1/recordings/${id}/audio`, user), res, download);
    }

    async export(user: string, q: VoiceQuery, res: ExpressResponse): Promise<void> {
        this.requireHistory(user);
        await this.pipe(await this.request(`/api/v1/export${VoiceControl.query(q)}`, user, EXPORT_TIMEOUT_MS), res, true);
    }

    /** Delete one or more recordings (ids "1,2,3"); history accounts only. */
    async deleteRecordings(user: string, ids: string): Promise<{ deleted: number }> {
        this.requireHistory(user);
        if (!/^[0-9]+(,[0-9]+)*$/.test(ids)) throw new Err(400, null, 'Nieprawidłowa lista nagrań');
        const res = await this.request(`/api/v1/recordings${VoiceControl.query({ ids })}`, user, TIMEOUT_MS, 'DELETE');
        return await res.json() as { deleted: number };
    }

    private async pipe(upstream: Response, res: ExpressResponse, download: boolean): Promise<void> {
        for (const name of PASSED_HEADERS) {
            const value = upstream.headers.get(name);
            if (!value) continue;
            // The player needs the file inline; only downloads keep "attachment".
            if (name === 'content-disposition' && !download) continue;
            res.setHeader(name, value);
        }
        if (!upstream.body) {
            res.end();
            return;
        }
        await new Promise<void>((resolve, reject) => {
            const stream = Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>);
            stream.on('error', reject);
            res.on('finish', () => resolve());
            res.on('close', () => resolve());
            stream.pipe(res);
        });
    }
}

export const voiceControl = new VoiceControl();
