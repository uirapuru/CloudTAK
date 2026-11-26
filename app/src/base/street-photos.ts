/**
 * taklab: "view from the ground" - an observer with a viewing cone on the map
 * and the street-level photo that best shows what the cone covers.
 *
 * Pure functions only (geometry, choice of photo, crop of a 360 panorama),
 * kept apart from the menu for tests. Choosing a photo needs no request:
 * turning the cone re-ranks the photos already fetched around the observer.
 */

export type LngLat = [number, number];

export type StreetPhoto = {
    id: string;
    collection: string;
    lon: number;
    lat: number;
    azimuth: number | null;
    panorama: boolean;
    fov: number | null;
    taken_at: string | null;
    author: string | null;
    license: string | null;
    provider: string;
};

export type Observer = {
    position: LngLat;
    /** Direction of the cone, degrees from true north. */
    azimuth: number;
    /** Width of the cone in degrees. */
    fov: number;
    /** Length of the cone in metres (only drawn). */
    range: number;
};

export type RankedPhoto = {
    photo: StreetPhoto;
    /** Metres from the observer to the place the photo was taken. */
    distance: number;
    /** Direction to show: the cone azimuth for a panorama, the photo azimuth for a flat photo. */
    heading: number;
    /** Angle between the cone direction and the shown direction (0-180). */
    offset: number;
    score: number;
};

const RAD = Math.PI / 180;
const EARTH_RADIUS_M = 6371008.8;

export const MIN_FOV = 10;
export const MAX_FOV = 120;
export const DEFAULT_FOV = 60;
export const DEFAULT_RANGE_M = 150;
export const MAX_RANGE_M = 2000;
/** How far from the observer a photo still counts when it is chosen for the cone. */
export const SEARCH_RADIUS_M = 120;
/** Every photo within this radius is shown on the map as a dot. */
export const DOTS_RADIUS_M = 300;
/** A flat photo looking further off the cone than this is not offered. */
export const MAX_OFFSET_DEG = 75;
/** Field of view assumed for a flat photo that does not state one (phone camera). */
export const DEFAULT_PHOTO_FOV = 65;
/** Moving the observer less than this keeps the photos already fetched. */
export const REFETCH_DISTANCE_M = 40;

export function normalizeDeg(deg: number): number {
    return ((deg % 360) + 360) % 360;
}

/** Smallest angle between two directions, 0-180. */
export function angleDiff(a: number, b: number): number {
    const d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
    return d > 180 ? 360 - d : d;
}

/** Great-circle distance in metres. */
export function distance(a: LngLat, b: LngLat): number {
    const dLat = (b[1] - a[1]) * RAD;
    const dLon = (b[0] - a[0]) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees from true north. */
export function bearing(a: LngLat, b: LngLat): number {
    const φ1 = a[1] * RAD;
    const φ2 = b[1] * RAD;
    const Δλ = (b[0] - a[0]) * RAD;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return normalizeDeg(Math.atan2(y, x) / RAD);
}

/** Point at metres along a bearing from a start point. */
export function destination(start: LngLat, bearingDeg: number, metres: number): LngLat {
    const δ = metres / EARTH_RADIUS_M;
    const θ = bearingDeg * RAD;
    const φ1 = start[1] * RAD;
    const λ1 = start[0] * RAD;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    return [((λ2 / RAD + 540) % 360) - 180, φ2 / RAD];
}

export function clampFov(fov: number): number {
    if (!Number.isFinite(fov)) return DEFAULT_FOV;
    return Math.min(MAX_FOV, Math.max(MIN_FOV, fov));
}

export function clampRange(range: number): number {
    if (!Number.isFinite(range) || range <= 0) return DEFAULT_RANGE_M;
    return Math.min(MAX_RANGE_M, Math.max(10, range));
}

/** Closed ring of the cone: apex, arc of 16 steps, apex. */
export function conePolygon(observer: Observer, steps = 16): LngLat[] {
    const fov = clampFov(observer.fov);
    const range = clampRange(observer.range);
    const start = observer.azimuth - fov / 2;
    const ring: LngLat[] = [observer.position];
    for (let i = 0; i <= steps; i++) {
        ring.push(destination(observer.position, start + fov * i / steps, range));
    }
    ring.push(observer.position);
    return ring;
}

/** Tip of the cone, where the rotation handle stands. */
export function coneTip(observer: Observer): LngLat {
    return destination(observer.position, observer.azimuth, clampRange(observer.range));
}

/**
 * Photos ranked for the cone, best first. A panorama shows any direction, so
 * only its distance counts; a flat photo must look roughly where the cone
 * looks, and must not be taken far in front of the observer looking back.
 * Photos without an azimuth are flat photos of unknown direction - left out.
 */
export function rankPhotos(photos: StreetPhoto[], observer: Observer, maxDistance = SEARCH_RADIUS_M): RankedPhoto[] {
    const out: RankedPhoto[] = [];
    for (const photo of photos) {
        const r = rankOne(photo, observer);
        if (r && r.distance <= maxDistance && r.offset <= MAX_OFFSET_DEG) out.push(r);
    }
    return out.sort((a, b) => a.score - b.score);
}

/**
 * One photo against the cone, without the limits of rankPhotos: used also for
 * a photo picked by hand on the map, which may look anywhere. Null only for a
 * flat photo of unknown direction.
 */
export function rankOne(photo: StreetPhoto, observer: Observer): RankedPhoto | null {
    const at: LngLat = [photo.lon, photo.lat];
    const d = distance(observer.position, at);

    let heading: number;
    let offset: number;
    if (photo.panorama) {
        heading = normalizeDeg(observer.azimuth);
        offset = 0;
    } else {
        if (photo.azimuth === null) return null;
        heading = photo.azimuth;
        offset = angleDiff(photo.azimuth, observer.azimuth);
    }

    // 1 m of distance weighs as much as 1 degree off the cone direction;
    // a photo in front of the observer is shifted along the view, which
    // matters less than one beside it.
    let score = d + offset * 1.0;
    if (d > 5) {
        const side = angleDiff(bearing(observer.position, at), observer.azimuth);
        score += Math.sin(Math.min(side, 90) * RAD) * d * 0.5;
    }
    // Panoramas show the exact direction: a small bonus.
    if (photo.panorama) score -= 5;

    return { photo, distance: d, heading, offset, score };
}

/** Photos within radius metres of a point (the search box is square, the dots a circle). */
export function photosWithin(photos: StreetPhoto[], at: LngLat, radius = DOTS_RADIUS_M): StreetPhoto[] {
    return photos.filter((p) => distance(at, [p.lon, p.lat]) <= radius);
}

/**
 * Crop of an equirectangular panorama for a direction: the horizontal
 * position of the window centre as a fraction of the image width (0-1) and
 * the window width as a fraction. The panorama's azimuth is the direction at
 * the image centre (Panoramax/Geovisio convention).
 */
export function panoramaWindow(photoAzimuth: number | null, heading: number, fov: number): { centre: number; width: number } {
    const centreAz = photoAzimuth ?? 0;
    const delta = normalizeDeg(heading - centreAz + 180) - 180; // -180..180
    return {
        centre: normalizeDeg(180 + delta) / 360,
        width: clampFov(fov) / 360,
    };
}

/** true when the observer moved far enough from the last fetch to ask again. */
export function needsRefetch(last: LngLat | null, now: LngLat): boolean {
    return !last || distance(last, now) > REFETCH_DISTANCE_M;
}

export function photoUrl(photo: Pick<StreetPhoto, 'collection' | 'id'>, size: 'thumb' | 'sd' | 'hd', token: string | undefined): string {
    const path = `/api/street-photos/${encodeURIComponent(photo.collection)}/${encodeURIComponent(photo.id)}/${size}`;
    return token ? `${path}?token=${encodeURIComponent(token)}` : path;
}

/** 8-point compass name of a direction, for the panel. */
export function compass(deg: number, names: string[]): string {
    return names[Math.round(normalizeDeg(deg) / 45) % 8];
}
