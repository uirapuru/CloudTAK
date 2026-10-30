/**
 * taklab: deleting a feature for everyone on the CoT stream.
 *
 * A feature created by the current CloudTAK user and living on the
 * connection stream is removed for everyone with a forced t-x-d-d task.
 * Anything else stays a local deletion.
 */
import type { Feature } from '../types.ts';

interface DeletableFeature {
    id: string;
    properties: {
        type?: string;
        creator?: { uid?: string };
    };
}

/**
 * True when the feature was created by the given CloudTAK user uid
 * (ANDROID-CloudTAK-<username>) and is not that user's own position.
 */
export function isOwnFeature(cot: DeletableFeature, selfUid: string | undefined): boolean {
    if (!selfUid) return false;
    if (cot.id === selfUid) return false;
    return cot.properties.creator?.uid === selfUid;
}

/**
 * GeoJSON form of a forced delete task as ATAK expects it
 * (CotDeleteImporter: <link> with non-empty uid, relation and type plus <__forcedelete/>).
 * node-cot turns `links` and `forcedelete` into those elements.
 */
export function forceDeleteFeature(uid: string, type: string | undefined, now: Date = new Date()): Feature {
    const id = crypto.randomUUID();
    const time = now.toISOString();
    const stale = new Date(now.getTime() + 20_000).toISOString();

    return {
        id,
        type: 'Feature',
        path: '/',
        properties: {
            id,
            type: 't-x-d-d',
            how: 'h-g-i-g-o',
            callsign: '',
            time,
            start: time,
            stale,
            center: [0, 0, 0],
            forcedelete: true,
            links: [{ uid, relation: 'none', type: type || 'none' }],
        },
        geometry: { type: 'Point', coordinates: [0, 0, 0] },
    } as unknown as Feature;
}
