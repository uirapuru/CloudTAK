import Err from '@openaddresses/batch-error';

/** Layer names accepted in /api/live/:name - nothing else reaches the pod URL */
export const LIVE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

const TIMEOUT_MS = 10_000;

export type LiveLayer = {
    name: string;
    label: string;
    refresh: number;
    attribution: string;
    updated: string | null;
    stale: boolean;
};

/**
 * Proxy to the taklab live-feeds pod (LIVE_FEEDS_URL). The pod polls the
 * sources once for every user; this class only forwards its answers.
 */
export class LiveControl {
    fetch: typeof fetch = globalThis.fetch;

    baseUrl(): string | null {
        const url = (process.env.LIVE_FEEDS_URL || '').trim().replace(/\/+$/, '');
        return url || null;
    }

    private async get(path: string): Promise<Response> {
        const base = this.baseUrl();
        if (!base) throw new Err(404, null, 'Live layers are not configured');

        let res: Response;
        try {
            res = await this.fetch(`${base}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        } catch (err) {
            throw new Err(502, err instanceof Error ? err : new Error(String(err)), 'Live layers service is unavailable');
        }

        if (res.status === 404) throw new Err(404, null, 'Unknown live layer');
        if (!res.ok) throw new Err(502, null, `Live layers service answered ${res.status}`);
        return res;
    }

    async index(): Promise<{ items: LiveLayer[] }> {
        if (!this.baseUrl()) return { items: [] };
        return await (await this.get('/layers')).json() as { items: LiveLayer[] };
    }

    async layer(name: string): Promise<string> {
        if (!LIVE_NAME.test(name)) throw new Err(400, null, 'Invalid live layer name');
        return await (await this.get(`/layers/${name}`)).text();
    }
}

export const liveControl = new LiveControl();
