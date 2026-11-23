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

    baseUrl(): string | null {
        const url = (process.env.VOICE_URL || '').trim().replace(/\/+$/, '');
        return url || null;
    }

    private async request(path: string, user: string, timeout = TIMEOUT_MS): Promise<Response> {
        const base = this.baseUrl();
        if (!base) throw new Err(404, null, 'Rejestr głosu nie jest włączony w tym środowisku');

        let res: Response;
        try {
            res = await this.fetch(`${base}${path}`, {
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
        return { ...body, enabled: true };
    }

    async recordings(user: string, q: VoiceQuery): Promise<{ items: VoiceRecording[] }> {
        return await (await this.request(`/api/v1/recordings${VoiceControl.query(q)}`, user)).json() as { items: VoiceRecording[] };
    }

    async audio(user: string, id: number, res: ExpressResponse, download: boolean): Promise<void> {
        await this.pipe(await this.request(`/api/v1/recordings/${id}/audio`, user), res, download);
    }

    async export(user: string, q: VoiceQuery, res: ExpressResponse): Promise<void> {
        await this.pipe(await this.request(`/api/v1/export${VoiceControl.query(q)}`, user, EXPORT_TIMEOUT_MS), res, true);
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
