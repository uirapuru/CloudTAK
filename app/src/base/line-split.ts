/**
 * Podział linii na dwie (akcja „cot:geometry-split” w Map.vue): budowa obu połówek.
 * Połówki dostają własną kopię metadata bez planu trasy (taklab_route) - plan opisuje
 * całą linię, więc po podziale obie są zwykłymi trasami bez planu.
 */
import type { Feature } from '../types.ts';

type SplitSource = {
    path?: string;
    properties: Feature['properties'];
};

export type SplitHalf = {
    id: string;
    coordinates: [number, number][];
};

function half(source: SplitSource, part: SplitHalf, index: number, now: Date): Feature {
    const properties = { ...source.properties } as Feature['properties'];
    const metadata = (source.properties as { metadata?: Record<string, unknown> }).metadata;
    if (metadata && typeof metadata === 'object') {
        const copy = structuredClone(metadata);
        delete copy.taklab_route;
        (properties as { metadata?: Record<string, unknown> }).metadata = copy;
    }

    return {
        id: part.id,
        type: 'Feature',
        path: source.path || '/',
        properties: {
            ...properties,
            id: part.id,
            callsign: `${source.properties.callsign} (${index})`,
            time: now.toISOString(),
            start: now.toISOString(),
        },
        geometry: { type: 'LineString', coordinates: part.coordinates },
    } as Feature;
}

export function splitLineFeatures(source: SplitSource, a: SplitHalf, b: SplitHalf, now: Date = new Date()): [Feature, Feature] {
    return [half(source, a, 1, now), half(source, b, 2, now)];
}
