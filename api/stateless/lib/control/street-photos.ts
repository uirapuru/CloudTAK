/**
 * taklab: street-level photos around a point, from Panoramax (open, CC-BY-SA,
 * no API key). The CloudTAK server asks Panoramax and streams the images, so
 * the operator's browser never talks to the outside service: Panoramax sees
 * the coordinates of the search, but not who looks or from where.
 *
 * Google Street View is deliberately not used: its terms forbid showing its
 * imagery on the same screen as a non-Google map.
 */
import Err from '@openaddresses/batch-error';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';

const TIMEOUT_MS = 10_000;
const IMAGE_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;
export const MAX_RADIUS_M = 300;
export const DEFAULT_RADIUS_M = 300;
/** Most photos asked for at once: 1500 take ~2 s from Panoramax, the 5875 of central Lyon in 600 m x 600 m took 17 s. */
export const SEARCH_LIMIT = 1500;
/** Radius of the second query that keeps the nearest photos when the wide one is cut. */
export const NEAR_RADIUS_M = 120;
export const NEAR_LIMIT = 300;

export type StreetPhotoSize = 'thumb' | 'sd' | 'hd';

export type StreetPhoto = {
    id: string;
    collection: string;
    lon: number;
    lat: number;
    /** Direction the camera looked, degrees from true north; null when the photo does not say. */
    azimuth: number | null;
    /** true for a 360 panorama (equirectangular), where any direction can be shown. */
    panorama: boolean;
    /** Horizontal field of view of a flat photo in degrees, when known. */
    fov: number | null;
    taken_at: string | null;
    author: string | null;
    license: string | null;
    provider: 'panoramax';
};

export type StreetPhotoList = {
    enabled: boolean;
    provider: string | null;
    attribution: string | null;
    /** true when there were more photos than SEARCH_LIMIT; only part of them is listed. */
    truncated: boolean;
    photos: StreetPhoto[];
};

const ID = /^[A-Za-z0-9-]{1,64}$/;

export function safeId(value: string): boolean {
    return ID.test(value);
}

function num(value: unknown): number | null {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
    return typeof value === 'string' && value.length ? value : null;
}

function obj(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Bounding box [west, south, east, north] of a square of radius metres around a point. */
export function bboxAround(lon: number, lat: number, radius: number): [number, number, number, number] {
    const dLat = radius / 111_320;
    const dLon = radius / (111_320 * Math.max(Math.cos(lat * Math.PI / 180), 0.01));
    return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

function collectionOf(feature: Record<string, unknown>): string | null {
    const direct = str(feature.collection);
    if (direct) return direct;
    const links = Array.isArray(feature.links) ? feature.links : [];
    for (const link of links) {
        const l = obj(link);
        if (!l || l.rel !== 'collection') continue;
        const href = str(l.href);
        const m = href ? /\/collections\/([A-Za-z0-9-]+)/.exec(href) : null;
        if (m) return m[1];
    }
    return null;
}

/** One Panoramax STAC item to a photo, or null when it is not usable (no position, not public, not ready). */
export function normalizePhoto(raw: unknown): StreetPhoto | null {
    const feature = obj(raw);
    if (!feature) return null;
    const id = str(feature.id);
    const collection = collectionOf(feature);
    if (!id || !collection || !safeId(id) || !safeId(collection)) return null;

    const geometry = obj(feature.geometry);
    const coords = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
    const lon = coords ? num(coords[0]) : null;
    const lat = coords ? num(coords[1]) : null;
    if (lon === null || lat === null) return null;

    const p = obj(feature.properties) || {};
    const status = str(p['geovisio:status']);
    if (status && status !== 'ready') return null;
    const visibility = str(p['geovisio:visibility']);
    if (visibility && visibility !== 'anyone') return null;

    const orientation = obj(p['pers:interior_orientation']) || {};
    const fov = num(orientation.field_of_view);
    const azimuthRaw = num(p['view:azimuth']);
    const azimuth = azimuthRaw === null ? null : ((azimuthRaw % 360) + 360) % 360;

    return {
        id,
        collection,
        lon,
        lat,
        azimuth,
        panorama: fov !== null && fov >= 359,
        fov: fov !== null && fov > 0 && fov < 359 ? fov : null,
        taken_at: str(p.datetimetz) || str(p.datetime),
        author: str(p['geovisio:producer']),
        license: str(p.license),
        provider: 'panoramax',
    };
}

export function normalizeSearch(body: unknown): StreetPhoto[] {
    const features = obj(body)?.features;
    if (!Array.isArray(features)) return [];
    const seen = new Set<string>();
    const out: StreetPhoto[] = [];
    for (const raw of features) {
        const photo = normalizePhoto(raw);
        if (!photo || seen.has(photo.id)) continue;
        seen.add(photo.id);
        out.push(photo);
    }
    return out;
}

/** Image URL of an item, only https and only for the requested size. */
export function assetUrl(item: unknown, size: StreetPhotoSize): string | null {
    const assets = obj(obj(item)?.assets);
    const asset = assets ? obj(assets[size]) : null;
    const href = asset ? str(asset.href) : null;
    if (!href) return null;
    try {
        const url = new URL(href);
        return url.protocol === 'https:' ? url.toString() : null;
    } catch {
        return null;
    }
}

/** Image type from the first bytes: JPEG, PNG or WebP; null for anything else. */
export function sniffImage(head: Uint8Array): string | null {
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
    if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png';
    if (head.length >= 12 && Buffer.from(head.subarray(0, 4)).toString('latin1') === 'RIFF'
        && Buffer.from(head.subarray(8, 12)).toString('latin1') === 'WEBP') return 'image/webp';
    return null;
}

export type Fetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

export class StreetPhotosControl {
    baseUrl: () => string | null;
    fetcher: Fetcher;
    cache = new Map<string, { at: number; photos: StreetPhoto[]; truncated: boolean }>();

    constructor(baseUrl: () => string | null, fetcher: Fetcher = (url, init) => fetch(url, init)) {
        this.baseUrl = baseUrl;
        this.fetcher = fetcher;
    }

    base(): string | null {
        const url = this.baseUrl();
        if (!url || url === 'off') return null;
        return url.replace(/\/+$/, '');
    }

    /** One bbox query, cached for a minute. Returns the photos and whether Panoramax hit the limit. */
    async query(base: string, lon: number, lat: number, radius: number, limit: number): Promise<{ photos: StreetPhoto[]; truncated: boolean }> {
        const bbox = bboxAround(lon, lat, radius).map((n) => n.toFixed(6)).join(',');
        const key = `${bbox}|${limit}`;
        const now = Date.now();
        const hit = this.cache.get(key);
        if (hit && now - hit.at < CACHE_TTL_MS) return { photos: hit.photos, truncated: hit.truncated };

        const url = `${base}/api/search?bbox=${bbox}&limit=${limit}`;
        let res: Response;
        try {
            res = await this.fetcher(url, {
                signal: AbortSignal.timeout(TIMEOUT_MS),
                headers: { Accept: 'application/geo+json, application/json' },
            });
        } catch (err) {
            throw new Err(503, err instanceof Error ? err : null, 'Serwis zdjęć ulic nie odpowiada');
        }
        if (!res.ok) throw new Err(503, null, `Serwis zdjęć ulic odpowiedział błędem ${res.status}`);
        const body = await res.json() as { features?: unknown[] };
        const truncated = Array.isArray(body?.features) && body.features.length >= limit;
        const photos = normalizeSearch(body);

        if (this.cache.size >= CACHE_MAX) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(key, { at: now, photos, truncated });
        return { photos, truncated };
    }

    /**
     * Photos within radius metres. Panoramax returns a bbox in no particular
     * order, so when the wide query hits the limit (dense city centres) a
     * second, narrow query makes sure the photos nearest the observer are there.
     */
    async search(lon: number, lat: number, radius = DEFAULT_RADIUS_M): Promise<StreetPhotoList> {
        const base = this.base();
        if (!base) return { enabled: false, provider: null, attribution: null, truncated: false, photos: [] };

        const r = Math.min(Math.max(radius, 10), MAX_RADIUS_M);
        const wide = await this.query(base, lon, lat, r, SEARCH_LIMIT);
        let photos = wide.photos;
        if (wide.truncated && r > NEAR_RADIUS_M) {
            const near = await this.query(base, lon, lat, NEAR_RADIUS_M, NEAR_LIMIT);
            const seen = new Set(photos.map((p) => p.id));
            photos = photos.concat(near.photos.filter((p) => !seen.has(p.id)));
        }

        return {
            enabled: true,
            provider: 'panoramax',
            attribution: 'Panoramax, CC-BY-SA',
            truncated: wide.truncated,
            photos,
        };
    }

    /**
     * Streams one image of an item. The item is looked up again by id, so the
     * server only ever fetches URLs that Panoramax itself names (no open proxy).
     */
    async image(collection: string, id: string, size: StreetPhotoSize, res: ExpressResponse): Promise<void> {
        const base = this.base();
        if (!base) throw new Err(404, null, 'Zdjęcia ulic są wyłączone');
        if (!safeId(collection) || !safeId(id)) throw new Err(400, null, 'Nieprawidłowy identyfikator zdjęcia');

        let item: Response;
        try {
            item = await this.fetcher(`${base}/api/collections/${collection}/items/${id}`, {
                signal: AbortSignal.timeout(TIMEOUT_MS),
                headers: { Accept: 'application/geo+json, application/json' },
            });
        } catch (err) {
            throw new Err(503, err instanceof Error ? err : null, 'Serwis zdjęć ulic nie odpowiada');
        }
        if (item.status === 404) throw new Err(404, null, 'Nie ma takiego zdjęcia');
        if (!item.ok) throw new Err(503, null, `Serwis zdjęć ulic odpowiedział błędem ${item.status}`);

        const url = assetUrl(await item.json(), size);
        if (!url) throw new Err(404, null, 'Zdjęcie nie ma takiego rozmiaru');

        let image: Response;
        try {
            image = await this.fetcher(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS), headers: { Accept: 'image/*' } });
        } catch (err) {
            throw new Err(503, err instanceof Error ? err : null, 'Nie udało się pobrać zdjęcia');
        }
        if (!image.ok || !image.body) throw new Err(503, null, `Pobranie zdjęcia dało ${image.status}`);

        // Some Panoramax storages (OVH S3) answer binary/octet-stream, so the
        // first bytes decide; anything that is not a known image is refused.
        const reader = (image.body as unknown as NodeReadableStream<Uint8Array>).getReader();
        const first = await reader.read();
        const head = first.value ? Buffer.from(first.value) : Buffer.alloc(0);
        const type = sniffImage(head);
        if (!type) {
            await reader.cancel().catch(() => undefined);
            throw new Err(503, null, 'Serwis zdjęć ulic nie oddał obrazu');
        }

        res.status(200);
        res.setHeader('Content-Type', type);
        const length = image.headers.get('content-length');
        if (length) res.setHeader('Content-Length', length);
        // Photos of a given id never change; the browser may keep them.
        res.setHeader('Cache-Control', 'private, max-age=86400');

        async function* rest(): AsyncGenerator<Uint8Array> {
            if (head.length) yield head;
            if (first.done) return;
            for (;;) {
                const next = await reader.read();
                if (next.done) return;
                yield next.value;
            }
        }

        await new Promise<void>((resolve, reject) => {
            const stream = Readable.from(rest());
            stream.on('error', reject);
            res.on('close', () => { stream.destroy(); void reader.cancel().catch(() => undefined); resolve(); });
            stream.on('end', resolve);
            stream.pipe(res);
        });
    }
}

export const streetPhotosControl = new StreetPhotosControl(
    () => process.env.STREET_PHOTOS_URL || 'https://api.panoramax.xyz',
);
