import { fetch } from '@tak-ps/node-safeurl';
import { runJob, etlToken, type JobDeps } from './job.ts';
import { s3Deps } from './s3-deps.ts';
import type { AreaPackageJob } from './types.ts';

const STALE_MINUTES = 15;
const REQUEUE_EVERY_MS = 60 * 1000;

/**
 * Polls the CloudTAK API for area package jobs and builds them one at a time,
 * so the per-host tile rate limit holds for the whole environment.
 */
export default class AreaPackagePool {
    api: string;
    tiles: string;
    secret: string;
    tmpdir: string;
    interval: number;
    deps: JobDeps | null;

    #timer?: NodeJS.Timeout;
    #running: Promise<void> | null = null;
    #closing = false;
    #lastRequeue = Date.now();

    constructor(opts: {
        api: string;
        tiles: string;
        secret: string;
        tmpdir: string;
        interval: number;
        bucket?: string;
        deps?: JobDeps;
    }) {
        this.api = opts.api;
        this.tiles = opts.tiles;
        this.secret = opts.secret;
        this.tmpdir = opts.tmpdir;
        this.interval = opts.interval;
        this.deps = opts.deps ?? (opts.bucket ? s3Deps(opts.bucket) : null);
    }

    async #request(method: string, url: string, body?: unknown): Promise<Response> {
        return await fetch(new URL(url, this.api), {
            safeUrlAllow: [this.api],
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${etlToken(this.secret)}`,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        }) as unknown as Response;
    }

    async start(): Promise<void> {
        const res = await this.#request('POST', '/api/area-package/requeue', {});
        if (!res.ok) throw new Error(`Failed to requeue area packages: ${await res.text()}`);
        const { count } = await res.json() as { count: number };
        console.log(`ok - Area Package Pool started, requeued ${count} interrupted jobs`);

        this.#timer = setInterval(() => {
            if (this.#running || this.#closing) return;
            this.#running = this.#tick().finally(() => {
                this.#running = null;
            });
        }, this.interval);
    }

    async #tick(): Promise<void> {
        try {
            // A job whose worker died without a word (no progress report for
            // STALE_MINUTES) goes back to the queue, or fails after repeated tries
            if (Date.now() - this.#lastRequeue >= REQUEUE_EVERY_MS) {
                this.#lastRequeue = Date.now();
                const requeue = await this.#request('POST', '/api/area-package/requeue', { stale_minutes: STALE_MINUTES });
                await requeue.body?.cancel();
            }

            const res = await this.#request('GET', '/api/area-package?status=Pending&limit=1');
            if (!res.ok) throw new Error(await res.text());

            const { items } = await res.json() as { items: AreaPackageJob[] };
            if (!items.length || this.#closing) return;

            // Atomic: only one worker moves a Pending job to Running
            const claim = await this.#request('POST', `/api/area-package/${items[0].id}/claim`, {});
            if (!claim.ok) {
                await claim.body?.cancel();
                return;
            }

            const job = await claim.json() as AreaPackageJob;

            if (!this.deps) throw new Error('Area Package Pool has no storage configured');

            console.log(`ok - Area Package ${job.id}: building`);
            await runJob(job, {
                api: this.api,
                tiles: this.tiles,
                secret: this.secret,
                tmpdir: this.tmpdir,
            }, this.deps);
        } catch (err) {
            console.error('error - Area Package Pool:', err);
        }
    }

    async close(): Promise<void> {
        this.#closing = true;
        clearInterval(this.#timer);
        if (this.#running) await this.#running;
    }
}
