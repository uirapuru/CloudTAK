import crypto from 'node:crypto';
import Err from '@openaddresses/batch-error';

/** [west, south, east, north] in EPSG:4326 */
export type BBox = [number, number, number, number];

export type AreaPackageFormat = 'png' | 'jpeg' | 'webp';

export type AreaPackageLayer = {
    source: 'basemap';
    id: number;
    name: string;
    format: AreaPackageFormat;
    host: string;
    minzoom: number;
    maxzoom: number;
} | {
    source: 'profile';
    file: string;
    name: string;
    format: AreaPackageFormat;
    /** Extension the tile server expects for this file (PMTiles JPEG is .jpg) */
    ext: string;
    host: 'profile';
    minzoom: number;
    maxzoom: number;
};

export const MERCATOR_MAX_LAT = 85.0511;

const AVERAGE_TILE_BYTES: Record<string, number> = {
    png: 15000,
    jpeg: 25000,
    jpg: 25000,
    webp: 12000,
};

const GOOGLE_HOSTS = ['google.com', 'googleapis.com', 'gstatic.com'];

export function limits(): { tiles: number; bytes: number; features: number } {
    return {
        tiles: Number(process.env.AREA_PACKAGE_MAX_TILES || 100000),
        bytes: Number(process.env.AREA_PACKAGE_MAX_BYTES || 2147483648),
        features: Number(process.env.AREA_PACKAGE_MAX_FEATURES || 5000),
    };
}

export function validateBounds(b: BBox): void {
    if (!Array.isArray(b) || b.length !== 4 || b.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
        throw new Err(400, null, 'Area bounds must be [west, south, east, north]');
    }

    const [west, south, east, north] = b;

    if (west < -180 || east > 180 || south < -90 || north > 90) {
        throw new Err(400, null, 'Area bounds are outside of the valid coordinate range');
    } else if (west >= east) {
        throw new Err(400, null, 'Area must not cross the antimeridian and must have a width');
    } else if (south >= north) {
        throw new Err(400, null, 'Area must have a height');
    }
}

function lon2x(lon: number, z: number): number {
    const n = 2 ** z;
    return Math.min(n - 1, Math.max(0, Math.floor((lon + 180) / 360 * n)));
}

function lat2y(lat: number, z: number): number {
    const n = 2 ** z;
    const clamped = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
    const rad = clamped * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n);
    return Math.min(n - 1, Math.max(0, y));
}

export function tileRange(b: BBox, z: number): { minX: number; maxX: number; minY: number; maxY: number } {
    return {
        minX: lon2x(b[0], z),
        maxX: lon2x(b[2], z),
        minY: lat2y(b[3], z),
        maxY: lat2y(b[1], z),
    };
}

export function countTiles(b: BBox, minzoom: number, maxzoom: number): number {
    let total = 0;
    for (let z = minzoom; z <= maxzoom; z++) {
        const r = tileRange(b, z);
        total += (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);
    }
    return total;
}

export function isGoogleUrl(url: string): boolean {
    let host: string;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return false;
    }

    return GOOGLE_HOSTS.some((g) => host === g || host.endsWith(`.${g}`));
}

export function estimateBytes(tiles: number, format: string): number {
    return tiles * (AVERAGE_TILE_BYTES[format.toLowerCase()] ?? AVERAGE_TILE_BYTES.png);
}

export function safeFileName(name: string): string {
    const cleaned = name
        // eslint-disable-next-line no-control-regex
        .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '')
        .replace(/\.{2,}/g, '.')
        .replace(/^[.\s]+/, '')
        .trim()
        .slice(0, 100)
        .trim();

    return cleaned.length ? cleaned : 'paczka';
}

const TILE_EXTENSIONS: Record<string, AreaPackageFormat> = {
    png: 'png',
    jpg: 'jpeg',
    jpeg: 'jpeg',
    webp: 'webp',
};

/**
 * Extension of a tile URL template as the tile server expects it, and the
 * matching MBTiles format; null for formats an ATAK raster layer cannot carry
 */
export function tileExtension(url: string): { ext: string; format: AreaPackageFormat } | null {
    let pathname: string;
    try {
        pathname = new URL(url).pathname;
    } catch {
        return null;
    }

    const match = /\.([a-z0-9]+)$/i.exec(decodeURIComponent(pathname));
    if (!match) return null;

    const ext = match[1].toLowerCase();
    const format = TILE_EXTENSIONS[ext];
    return format ? { ext, format } : null;
}

export function newToken(): string {
    return crypto.randomBytes(32).toString('base64url');
}
