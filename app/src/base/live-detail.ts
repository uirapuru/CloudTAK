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
export const LIVE_ROUTE_FILL_LAYER = 'live-route-fill';
const DEFAULT_ROUTE_COLOR = '#111827';

export type LivePhoto = { src: string; link: string; credit: string };

export type LiveDetail = {
    properties?: Record<string, unknown>;
    photo?: LivePhoto;
    route?: Feature;
    route_label?: string;
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

/** Absolute http(s) URL, else null — blocks javascript:, data: and relative values */
export function safeHttpUrl(u: unknown): string | null {
    if (typeof u !== 'string' || !u) return null;
    try {
        const url = new URL(u);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
}

export async function fetchDetail(layer: string, id: string): Promise<LiveDetail> {
    return await std(`/api/live/${encodeURIComponent(layer)}/${encodeURIComponent(id)}`) as LiveDetail;
}

/** Text of the route toggle button, e.g. "Pokaż zasięg" (default noun: "trasę") */
export function routeToggleLabel(detail: Pick<LiveDetail, 'route_label'> | null | undefined, visible: boolean): string {
    const raw = detail?.route_label;
    const label = typeof raw === 'string' ? raw.trim().slice(0, 40).trim() : '';
    return `${visible ? 'Ukryj' : 'Pokaż'} ${label || 'trasę'}`;
}

type RouteMap = Pick<MapLibreMap, 'addSource' | 'addLayer' | 'getSource' | 'getLayer' | 'removeLayer' | 'removeSource'>;

/** Temporary route of one live feature (dashed line, or semi-transparent polygon); show/hide are idempotent */
export class RouteToggle {
    visible = false;

    show(map: RouteMap, route: Feature): void {
        this.hide(map);

        const rawColor = route.properties?._color;
        const color = typeof rawColor === 'string' && rawColor ? rawColor : DEFAULT_ROUTE_COLOR;
        map.addSource(LIVE_ROUTE_SOURCE, { type: 'geojson', data: route });

        const type = route.geometry?.type;
        if (type === 'Polygon' || type === 'MultiPolygon') {
            const rawOpacity = route.properties?._fill_opacity;
            const opacity = typeof rawOpacity === 'number' && rawOpacity >= 0 && rawOpacity <= 1 ? rawOpacity : 0.25;
            map.addLayer({
                id: LIVE_ROUTE_FILL_LAYER,
                type: 'fill',
                source: LIVE_ROUTE_SOURCE,
                paint: { 'fill-color': color, 'fill-opacity': opacity },
            });
            map.addLayer({
                id: LIVE_ROUTE_LAYER,
                type: 'line',
                source: LIVE_ROUTE_SOURCE,
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': color, 'line-width': 2 },
            });
        } else {
            map.addLayer({
                id: LIVE_ROUTE_LAYER,
                type: 'line',
                source: LIVE_ROUTE_SOURCE,
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': color,
                    'line-width': 3,
                    'line-dasharray': [2, 2],
                },
            });
        }
        this.visible = true;
    }

    hide(map: RouteMap): void {
        for (const id of [LIVE_ROUTE_LAYER, LIVE_ROUTE_FILL_LAYER]) {
            if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(LIVE_ROUTE_SOURCE)) map.removeSource(LIVE_ROUTE_SOURCE);
        this.visible = false;
    }
}
