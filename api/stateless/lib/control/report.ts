import Err from '@openaddresses/batch-error';
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';

const TIMEOUT_MS = 15_000;
/** Reports are capped at a few MB; the limit covers the whole transfer. */
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/** Headers of a report file that reach the browser; everything else stays behind. */
const PASSED_HEADERS = ['content-type', 'content-length', 'content-disposition'];

/** Statuses of the report service whose Polish message the browser should see. */
const PASSED_STATUSES = new Set([400, 404, 409, 429, 503]);

const FALLBACK: Record<number, string> = {
    400: 'Nieprawidłowe zamówienie raportu.',
    404: 'Nie ma takiego raportu.',
    409: 'Raport nie jest jeszcze gotowy.',
    429: 'Masz już 3 raporty w kolejce. Poczekaj, aż któryś się skończy.',
    503: 'Usługa raportów jest chwilowo niedostępna.',
};

export const ReportId = Type.String({ pattern: '^[0-9a-f]{32}$' });

// Every field of the service's public(job): batch-schema drops the rest.
export const ReportJobSchema = Type.Object({
    id: Type.String(),
    scope: Type.String({ description: 'environment or mission' }),
    mission: Type.Union([Type.Null(), Type.String()]),
    since: Type.String({ description: 'ISO 8601 UTC' }),
    until: Type.String({ description: 'ISO 8601 UTC' }),
    status: Type.String({ description: 'queued, running, done or failed' }),
    error: Type.Union([Type.Null(), Type.String()], { description: 'Polish reason of a failed report' }),
    created: Type.String({ description: 'ISO 8601 UTC' }),
    finished: Type.Union([Type.Null(), Type.String()]),
    owner: Type.String({ description: 'OTS account that ordered the report' }),
});

export const ReportListSchema = Type.Object({ items: Type.Array(ReportJobSchema) });
export const ReportCreatedSchema = Type.Object({ id: Type.String(), status: Type.String() });
export const ReportDeletedSchema = Type.Object({ deleted: Type.Boolean() });

export const ReportCreateBody = Type.Object({
    scope: Type.Union([Type.Literal('environment'), Type.Literal('mission')]),
    mission: Type.Optional(Type.String({ minLength: 1, maxLength: 256, description: 'Mission (feed) name, required for scope=mission' })),
    mission_password: Type.Optional(Type.String({ maxLength: 1024, description: 'Password of a protected mission; never logged' })),
    since: Type.String({ maxLength: 64, description: 'ISO 8601 with time zone' }),
    until: Type.String({ maxLength: 64, description: 'ISO 8601 with time zone; at most 7 days after since' }),
    basemap: Type.Optional(Type.String({ maxLength: 64, description: 'osm (default) or polska50k' })),
});

export type ReportJob = Static<typeof ReportJobSchema>;
export type ReportCreate = Static<typeof ReportCreateBody>;

/**
 * Proxy to the taklab report service of the environment (REPORT_URL, shared
 * token REPORT_TOKEN). The browser never talks to the service: CloudTAK checks
 * the login and sends the OTS account of the session in X-Report-User. The
 * service decides who sees which report (owner or OTS administrator).
 */
export class ReportControl {
    fetch: typeof fetch = globalThis.fetch;

    baseUrl(): string | null {
        const url = (process.env.REPORT_URL || '').trim().replace(/\/+$/, '');
        return url || null;
    }

    private async request(path: string, user: string, init: { method?: string; body?: string; timeout?: number } = {}): Promise<Response> {
        const base = this.baseUrl();
        if (!base) throw new Err(404, null, 'Raport misji nie jest włączony');

        const headers: Record<string, string> = {
            'X-Report-Token': process.env.REPORT_TOKEN || '',
            'X-Report-User': user,
        };
        if (init.body !== undefined) headers['Content-Type'] = 'application/json';

        let res: Response;
        try {
            res = await this.fetch(`${base}${path}`, {
                method: init.method || 'GET',
                headers,
                body: init.body,
                signal: AbortSignal.timeout(init.timeout || TIMEOUT_MS),
            });
        } catch {
            // No cause attached: the request carries the token and maybe a mission password.
            throw new Err(502, null, 'Usługa raportów nie odpowiada');
        }

        if (res.ok) return res;

        if (PASSED_STATUSES.has(res.status)) {
            let message = FALLBACK[res.status];
            try {
                const body = await res.json() as { error?: unknown };
                if (typeof body.error === 'string' && body.error.trim()) message = body.error;
            } catch {
                // Not JSON: keep the fallback.
            }
            throw new Err(res.status, null, message);
        }

        throw new Err(502, null, `Usługa raportów odpowiedziała ${res.status}`);
    }

    async create(user: string, body: ReportCreate): Promise<{ id: string; status: string }> {
        // Contract keys only; the password goes to the service and nowhere else.
        const payload: Record<string, string> = { scope: body.scope, since: body.since, until: body.until };
        if (body.mission !== undefined) payload.mission = body.mission;
        if (body.mission_password !== undefined) payload.mission_password = body.mission_password;
        if (body.basemap !== undefined) payload.basemap = body.basemap;

        const res = await this.request('/api/v1/reports', user, { method: 'POST', body: JSON.stringify(payload) });
        return await res.json() as { id: string; status: string };
    }

    async list(user: string): Promise<{ items: ReportJob[] }> {
        return await (await this.request('/api/v1/reports', user)).json() as { items: ReportJob[] };
    }

    async get(user: string, id: string): Promise<ReportJob> {
        return await (await this.request(`/api/v1/reports/${ReportControl.id(id)}`, user)).json() as ReportJob;
    }

    async delete(user: string, id: string): Promise<{ deleted: boolean }> {
        const res = await this.request(`/api/v1/reports/${ReportControl.id(id)}`, user, { method: 'DELETE' });
        return await res.json() as { deleted: boolean };
    }

    async download(user: string, id: string, ext: 'pdf' | 'txt', res: ExpressResponse): Promise<void> {
        const upstream = await this.request(`/api/v1/reports/${ReportControl.id(id)}.${ext}`, user, { timeout: DOWNLOAD_TIMEOUT_MS });
        for (const name of PASSED_HEADERS) {
            const value = upstream.headers.get(name);
            if (value) res.setHeader(name, value);
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

    /** Job ids are 32 hex characters; anything else never reaches the service path. */
    static id(id: string): string {
        if (!/^[0-9a-f]{32}$/.test(id)) throw new Err(404, null, 'Nie ma takiego raportu.');
        return id;
    }
}

export const reportControl = new ReportControl();
