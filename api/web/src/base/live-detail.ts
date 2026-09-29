import type { Feature } from 'geojson';
import type { Map as MapLibreMap, MapGeoJSONFeature } from 'maplibre-gl';
import { std } from '../std.ts';
import OverlayManager from './overlay.ts';

/**
 * On-demand details of a live overlay feature (features with `_detail`):
 * extra rows, an optional photo and an optional route, fetched from
 * /api/live/<layer>/<_id> when the user opens the feature.
 */

export const LIVE_ROUTE_SOURCE = 'live-route';
export const LIVE_ROUTE_LAYER = 'live-route-line';
const DEFAULT_ROUTE_COLOR = '#111827';

export type LivePhoto = { src: string; link: string; credit: string };

export type LiveDetail = {
    properties?: Record<string, unknown>;
    photo?: LivePhoto;
    route?: Feature;
    error?: string;
};

export type LiveFeatureRef = { layer: string; id: string };

type FeatureLike = Feature | MapGeoJSONFeature;

/** Layer name and id of a live feature that offers details; null for anything else */
export function liveFeatureRef(feature?: FeatureLike | null): LiveFeatureRef | null {
    if (!feature) return null;
    const props = feature.properties || {};
    if (!props._detail || props._id === undefined || props._id === null || props._id === '') return null;

    const sourceId = Number((feature as { source?: unknown }).source);
    if (!sourceId || Number.isNaN(sourceId)) return null;

    const overlay = OverlayManager.loadedFrom(sourceId);
    if (!overlay || overlay.mode !== 'live' || !overlay.mode_id) return null;

    return { layer: overlay.mode_id, id: String(props._id) };
}

export async function fetchDetail(layer: string, id: string): Promise<LiveDetail> {
    return await std(`/api/live/${encodeURIComponent(layer)}/${encodeURIComponent(id)}`) as LiveDetail;
}

type RouteMap = Pick<MapLibreMap, 'addSource' | 'addLayer' | 'getSource' | 'getLayer' | 'removeLayer' | 'removeSource'>;

/** Temporary dashed route of one live feature; show/hide are idempotent */
export class RouteToggle {
    visible = false;

    show(map: RouteMap, route: Feature): void {
        this.hide(map);

        const color = route.properties?._color;
        map.addSource(LIVE_ROUTE_SOURCE, { type: 'geojson', data: route });
        map.addLayer({
            id: LIVE_ROUTE_LAYER,
            type: 'line',
            source: LIVE_ROUTE_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': typeof color === 'string' && color ? color : DEFAULT_ROUTE_COLOR,
                'line-width': 3,
                'line-dasharray': [2, 2],
            },
        });
        this.visible = true;
    }

    hide(map: RouteMap): void {
        if (map.getLayer(LIVE_ROUTE_LAYER)) map.removeLayer(LIVE_ROUTE_LAYER);
        if (map.getSource(LIVE_ROUTE_SOURCE)) map.removeSource(LIVE_ROUTE_SOURCE);
        this.visible = false;
    }
}
