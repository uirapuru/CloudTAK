import jwt from 'jsonwebtoken';
import { fetch } from '@tak-ps/node-safeurl';
import { tileRange } from './tiles.ts';
import { limiterFor, type HostLimiter } from './limiter.ts';
import type { AreaPackageLayer, BBox } from './types.ts';

const MAX_ATTEMPTS = 3;
// A host that keeps throttling (429/503) is given up after this many pauses
// (1 s doubling up to 60 s: roughly ten minutes), so one blocked provider
// cannot hold the single-job queue forever
const MAX_THROTTLED = 15;
const RETRY_DELAY_MS = 1000;

type FetchOptions = {
    tilesBase: string;
    secret: string;
    username: string;
    layer: AreaPackageLayer;
    signal: AbortSignal;
    maxThrottled?: number;
    retryDelayMs?: number;
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (ms <= 0 || signal.aborted) return resolve();
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}

export type FetchedTile = { z: number; x: number; y: number; data: Buffer };

type Outcome = { tile?: FetchedTile; status: number };

export function tileUrl(
    tilesBase: string,
    layer: AreaPackageLayer,
    username: string,
    secret: string,
    z: number,
    x: number,
    y: number,
): string {
    let url: URL;
    let token: string;

    if (layer.source === 'basemap') {
        url = new URL(`/tiles/basemap/${layer.id}/tiles/${z}/${x}/${y}`, tilesBase);
        token = jwt.sign({ access: 'user', email: username }, secret);
    } else {
        url = new URL(`/tiles/profile/${encodeURIComponent(username)}/${encodeURIComponent(layer.file)}/tiles/${z}/${x}/${y}.${layer.ext ?? layer.format}`, tilesBase);
        token = jwt.sign({ access: 'profile', email: username }, secret);
    }

    url.searchParams.set('token', token);
    return String(url);
}

async function fetchTile(
    opts: FetchOptions,
    limiter: HostLimiter,
    z: number,
    x: number,
    y: number,
): Promise<Outcome> {
    const url = tileUrl(opts.tilesBase, opts.layer, opts.username, opts.secret, z, x, y);

    const maxThrottled = opts.maxThrottled ?? MAX_THROTTLED;
    const retryDelay = opts.retryDelayMs ?? RETRY_DELAY_MS;

    let failures = 0;
    let throttled = 0;
    while (true) {
        if (opts.signal.aborted) return { status: 0 };

        let status = 0;
        let data: Buffer | undefined;

        try {
            const res = await limiter.run(() => fetch(url, {
                safeUrlAllow: [opts.tilesBase],
                signal: opts.signal,
            }));

            status = res.status;

            if (res.ok) {
                data = Buffer.from(await res.arrayBuffer());
            } else {
                await res.body?.cancel();
            }
        } catch (err) {
            if (opts.signal.aborted) return { status: 0 };
            failures++;
            if (failures >= MAX_ATTEMPTS) {
                throw new Error(`${opts.layer.name}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
            }
            await sleep(retryDelay * 2 ** (failures - 1), opts.signal);
            continue;
        }

        if (status === 429 || status === 503) {
            if (++throttled > maxThrottled) throw new Error(`${opts.layer.name}: ${status}`);
            limiter.backoff();
            continue;
        }

        if (status >= 200 && status < 300) {
            limiter.succeeded();
            return data && data.length ? { status, tile: { z, x, y, data } } : { status };
        }

        if ([401, 403, 404].includes(status)) return { status };

        failures++;
        if (failures >= MAX_ATTEMPTS) throw new Error(`${opts.layer.name}: ${status}`);
        await sleep(retryDelay * 2 ** (failures - 1), opts.signal);
    }
}

/**
 * Download every tile of a layer inside the area, through the CloudTAK tile
 * server, honouring the per-host rate limit. Missing tiles are skipped.
 */
export async function* fetchLayerTiles(opts: FetchOptions & { bounds: BBox }): AsyncGenerator<FetchedTile> {
    const limiter = limiterFor(opts.layer.host);

    for (let z = opts.layer.minzoom; z <= opts.layer.maxzoom; z++) {
        const range = tileRange(opts.bounds, z);
        const inflight: Array<Promise<Outcome>> = [];
        let yielded = 0;

        const drain = async function* (limit: number): AsyncGenerator<FetchedTile> {
            while (inflight.length > limit) {
                const outcome = await inflight.shift() as Outcome;
                if (outcome.tile) {
                    yielded++;
                    yield outcome.tile;
                }
            }
        };

        try {
            for (let x = range.minX; x <= range.maxX; x++) {
                for (let y = range.minY; y <= range.maxY; y++) {
                    if (opts.signal.aborted) return;

                    inflight.push(fetchTile(opts, limiter, z, x, y));
                    yield* drain(limiter.concurrency - 1);
                }
            }

            yield* drain(0);
        } finally {
            // Swallow failures of requests abandoned by an abort or an earlier error
            for (const pending of inflight) pending.catch(() => {});
        }

        if (opts.signal.aborted) return;

        if (z === opts.layer.minzoom && yielded === 0) {
            throw new Error(`${opts.layer.name}: brak dostępu albo brak danych`);
        }
    }
}
