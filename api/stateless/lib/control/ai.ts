import Err from '@openaddresses/batch-error';
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';

const TIMEOUT_MS = 15_000;
/** Orders are a few MB at most; the limit covers the whole transfer. */
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/** Headers of an order file that reach the browser; everything else stays behind. */
const PASSED_HEADERS = ['content-type', 'content-length', 'content-disposition'];

/** Statuses of the report service whose Polish message the browser should see. */
const PASSED_STATUSES = new Set([400, 403, 404, 409, 429, 503]);

const FALLBACK: Record<number, string> = {
    400: 'Nieprawidłowe zamówienie rozkazu.',
    403: 'Chat AI jest dostępny tylko dla administratora.',
    404: 'Nie ma takiego rozkazu.',
    409: 'Rozkaz nie jest jeszcze gotowy.',
    429: 'Masz już 2 rozkazy w kolejce. Poczekaj, aż któryś się skończy.',
    503: 'Model AI jest chwilowo niedostępny.',
};

export const AiOrderId = Type.String({ pattern: '^[0-9a-f]{32}$' });

export const AiModelSchema = Type.Object({
    state: Type.String({ description: 'off, starting, ready, stopping or unavailable' }),
    pinned: Type.Boolean({ description: 'The machine stays on until someone switches it off' }),
    reason: Type.Union([Type.Null(), Type.String()]),
});

export const AiModelActionSchema = Type.Object({
    result: Type.Optional(Type.String({ description: 'start: ready, started or refused; stop: stopping or already_stopped' })),
    reason: Type.Optional(Type.Union([Type.Null(), Type.String()])),
});

const NullableBoolean = Type.Unsafe<boolean | null>({ type: ['boolean', 'null'], description: 'null until the step ran' });

// Every field of the service's public(order): batch-schema drops the rest.
export const AiOrderSchema = Type.Object({
    id: Type.String(),
    status: Type.String({ description: 'queued, running, done or failed' }),
    error: Type.Union([Type.Null(), Type.String()], { description: 'Polish reason of a failed order' }),
    created: Type.String({ description: 'ISO 8601 UTC' }),
    finished: Type.Union([Type.Null(), Type.String()]),
    owner: Type.String({ description: 'OTS account that ordered the document' }),
    format: Type.String({ description: 'pdf or docx' }),
    title: Type.Union([Type.Null(), Type.String()]),
    start: Type.Union([Type.Null(), Type.String()], { description: 'H hour, ISO 8601' }),
    has_location: Type.Boolean(),
    // A type list, not a Union: with type coercion the anyOf of a Union turns false into null.
    weather_ok: NullableBoolean,
    terrain_ok: NullableBoolean,
});

export const AiOrderListSchema = Type.Object({ items: Type.Array(AiOrderSchema) });
export const AiOrderCreatedSchema = Type.Object({ id: Type.String(), status: Type.String() });
export const AiOrderDeletedSchema = Type.Object({ deleted: Type.Boolean() });

const LngLat = Type.Tuple([
    Type.Number({ minimum: -180, maximum: 180 }),
    Type.Number({ minimum: -90, maximum: 90 }),
]);

export const AiOrderCreateBody = Type.Object({
    text: Type.String({ minLength: 1, maxLength: 20000, description: 'Order data from the administrator' }),
    format: Type.Union([Type.Literal('pdf'), Type.Literal('docx')]),
    title: Type.Optional(Type.String({ maxLength: 120 })),
    start: Type.Optional(Type.String({ maxLength: 64, description: 'H hour, ISO 8601 with time zone; default now' })),
    location: Type.Optional(LngLat),
    route: Type.Optional(Type.Array(LngLat, { minItems: 2, maxItems: 5000 })),
});

export type AiModel = Static<typeof AiModelSchema>;
export type AiModelAction = Static<typeof AiModelActionSchema>;
export type AiOrder = Static<typeof AiOrderSchema>;
export type AiOrderCreate = Static<typeof AiOrderCreateBody>;

/**
 * Proxy to the "Chat AI" part of the taklab report service of the environment
 * (REPORT_URL, shared token REPORT_TOKEN): the model switch and combat orders.
 * CloudTAK checks the login and sends the OTS account of the session in
 * X-Report-User; the service decides whether the account is an OTS
 * administrator (403 otherwise).
 */
export class AiControl {
    fetch: typeof fetch = globalThis.fetch;

    baseUrl(): string | null {
        const url = (process.env.REPORT_URL || '').trim().replace(/\/+$/, '');
        return url || null;
    }

    private async request(path: string, user: string, init: { method?: string; body?: string; timeout?: number } = {}): Promise<Response> {
        const base = this.baseUrl();
        if (!base) throw new Err(404, null, 'Chat AI nie jest włączony');

        // An empty token would only earn a 403 from the service; say what is wrong instead.
        const token = (process.env.REPORT_TOKEN || '').trim();
        if (!token) throw new Err(502, null, 'Usługa raportów nie jest skonfigurowana.');

        const headers: Record<string, string> = {
            'X-Report-Token': token,
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
            // No cause attached: the request carries the token and maybe the order text.
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

    async model(user: string): Promise<AiModel> {
        return await (await this.request('/api/v1/ai/model', user)).json() as AiModel;
    }

    async start(user: string): Promise<AiModelAction> {
        return await (await this.request('/api/v1/ai/model/start', user, { method: 'POST' })).json() as AiModelAction;
    }

    async stop(user: string): Promise<AiModelAction> {
        return await (await this.request('/api/v1/ai/model/stop', user, { method: 'POST' })).json() as AiModelAction;
    }

    async create(user: string, body: AiOrderCreate): Promise<{ id: string; status: string }> {
        if (body.location !== undefined && body.route !== undefined) {
            throw new Err(400, null, 'Podaj położenie albo trasę, nie oba naraz.');
        }

        // Contract keys only.
        const payload: Record<string, unknown> = { text: body.text, format: body.format };
        if (body.title !== undefined) payload.title = body.title;
        if (body.start !== undefined) payload.start = body.start;
        if (body.location !== undefined) payload.location = body.location;
        if (body.route !== undefined) payload.route = body.route;

        const res = await this.request('/api/v1/orders', user, { method: 'POST', body: JSON.stringify(payload) });
        return await res.json() as { id: string; status: string };
    }

    async list(user: string): Promise<{ items: AiOrder[] }> {
        return await (await this.request('/api/v1/orders', user)).json() as { items: AiOrder[] };
    }

    async get(user: string, id: string): Promise<AiOrder> {
        return await (await this.request(`/api/v1/orders/${AiControl.id(id)}`, user)).json() as AiOrder;
    }

    async delete(user: string, id: string): Promise<{ deleted: boolean }> {
        const res = await this.request(`/api/v1/orders/${AiControl.id(id)}`, user, { method: 'DELETE' });
        return await res.json() as { deleted: boolean };
    }

    async download(user: string, id: string, ext: 'pdf' | 'docx', res: ExpressResponse): Promise<void> {
        const upstream = await this.request(`/api/v1/orders/${AiControl.id(id)}.${ext}`, user, { timeout: DOWNLOAD_TIMEOUT_MS });
        for (const name of PASSED_HEADERS) {
            const value = upstream.headers.get(name);
            if (value) res.setHeader(name, value);
        }
        if (!upstream.body) {
            res.end();
            return;
        }
        // pipeline destroys the upstream body when the browser goes away, and
        // destroys the response on an upstream error instead of writing to it.
        try {
            await pipeline(Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>), res);
        } catch (err) {
            // ERR_STREAM_PREMATURE_CLOSE: the response closed first, i.e. the browser left.
            // Anything else is logged by its code only (no URL, no token).
            const e = err as { code?: unknown; name?: unknown };
            if (e.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
                const kind = typeof e.code === 'string' ? e.code : typeof e.name === 'string' ? e.name : 'unknown';
                console.error(`Order download broken: ${kind}`);
            }
        }
    }

    /** Order ids are 32 hex characters; anything else never reaches the service path. */
    static id(id: string): string {
        if (!/^[0-9a-f]{32}$/.test(id)) throw new Err(404, null, 'Nie ma takiego rozkazu.');
        return id;
    }
}

export const aiControl = new AiControl();
