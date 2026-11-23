import { bbox } from '@turf/bbox';
import type { Feature } from '../types.ts';

/** [west, south, east, north] in EPSG:4326 */
export type AreaBounds = [number, number, number, number];

export type AreaFeatureKind = 'marker' | 'shape' | 'route';

export type AreaFeature = {
    id: string;
    kind: AreaFeatureKind;
    title: string;
    feature: Feature;
};

/** People (contacts and devices) carry a group and never go into an area package */
export function isPerson(feat: Pick<Feature, 'properties'>): boolean {
    return !!feat.properties.group;
}

export function areaFeatureKind(feat: Pick<Feature, 'properties' | 'geometry'>): AreaFeatureKind {
    if (feat.geometry.type === 'Point') return 'marker';
    if (feat.geometry.type === 'LineString' && feat.properties.type === 'b-m-r') return 'route';
    return 'shape';
}

/**
 * True when the feature's bounding box overlaps the area, so a route that
 * crosses the edge of the area is included and not just the ones inside it
 */
export function overlapsArea(feat: Pick<Feature, 'geometry'>, area: AreaBounds): boolean {
    let box: number[];
    try {
        box = bbox(feat.geometry);
    } catch {
        return false;
    }

    if (box.some((v) => !Number.isFinite(v))) return false;

    return box[0] <= area[2] && box[2] >= area[0] && box[1] <= area[3] && box[3] >= area[1];
}

export function toAreaFeature(feat: Feature, area: AreaBounds): AreaFeature | undefined {
    if (!feat.geometry || isPerson(feat) || !overlapsArea(feat, area)) return;

    return {
        id: String(feat.id),
        kind: areaFeatureKind(feat),
        title: feat.properties.callsign || String(feat.id),
        feature: feat,
    };
}
