// Copy of the tile math and file name rules in api/common/area-package.ts:
// tasks/events does not import from api/. test/area-package-fetch.test.ts pins
// the same values as api/test/area-package-tiles.test.ts so the copies agree.
import type { BBox } from './types.ts';

export const MERCATOR_MAX_LAT = 85.0511;

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
