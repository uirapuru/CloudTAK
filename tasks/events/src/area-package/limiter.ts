const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60000;

const INTERNAL = { concurrency: 16, perSecond: null };
const EXTERNAL = { concurrency: 2, perSecond: 10 };

/**
 * Concurrency and rate limit for one upstream host. Free tile servers
 * (OpenStreetMap.de, OpenTopoMap, ...) forbid bulk downloads, so external
 * hosts are fetched slowly; internal services and profile files are not.
 */
export class HostLimiter {
    concurrency: number;
    perSecond: number | null;

    #running = 0;
    #queue: Array<() => void> = [];
    #nextStart = 0;
    #backoff = 0;
    #pausedUntil = 0;

    constructor(opts: { concurrency: number; perSecond: number | null }) {
        this.concurrency = opts.concurrency;
        this.perSecond = opts.perSecond;
    }

    async run<T>(fn: () => Promise<T>): Promise<T> {
        await this.#acquire();

        try {
            await this.#pace();
            const result = await fn();
            return result;
        } finally {
            this.#release();
        }
    }

    /** Upstream asked us to slow down (429/503): pause, doubling each time */
    backoff(): void {
        this.#backoff = this.#backoff ? Math.min(MAX_BACKOFF_MS, this.#backoff * 2) : MIN_BACKOFF_MS;
        this.#pausedUntil = Date.now() + this.#backoff;
    }

    succeeded(): void {
        this.#backoff = 0;
    }

    async #acquire(): Promise<void> {
        if (this.#running < this.concurrency) {
            this.#running++;
            return;
        }

        await new Promise<void>((resolve) => this.#queue.push(resolve));
    }

    #release(): void {
        const next = this.#queue.shift();
        if (next) {
            next();
        } else {
            this.#running--;
        }
    }

    async #pace(): Promise<void> {
        const now = Date.now();
        let start = Math.max(now, this.#pausedUntil);

        if (this.perSecond) {
            start = Math.max(start, this.#nextStart);
            this.#nextStart = start + 1000 / this.perSecond;
        }

        if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
    }
}

const limiters = new Map<string, HostLimiter>();

export function isInternalHost(host: string): boolean {
    return host === 'profile' || host.endsWith('.svc') || host.endsWith('.svc.cluster.local');
}

export function limiterFor(host: string): HostLimiter {
    let limiter = limiters.get(host);
    if (!limiter) {
        limiter = new HostLimiter(isInternalHost(host) ? INTERNAL : EXTERNAL);
        limiters.set(host, limiter);
    }
    return limiter;
}
