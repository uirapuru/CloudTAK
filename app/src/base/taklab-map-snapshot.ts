/**
 * Map snapshot attached to a direct chat message ("Załącz mapę")
 *
 * A pure description of what the user sees on the map - position, view,
 * basemap, layers and the nearest features - sent to a chat bot as the JSON
 * of a y-taklab-map CoT event (format version 1).
 */
import { distance } from '@turf/distance';
import pointOnFeature from '@turf/point-on-feature';
import type { Geometry } from 'geojson';
import { xmlSafeJSON } from './taklab-map-escape.ts';

export const MAP_SNAPSHOT_VERSION = 1;
export const MAP_SNAPSHOT_MAX_ITEMS = 40;
// Limit for the JSON as sent in the CoT event, i.e. after xmlSafeJSON escaping
export const MAP_SNAPSHOT_MAX_BYTES = 30 * 1024;

export type MapSnapshotKind = 'marker' | 'route' | 'shape' | 'drawing' | 'other';

/**
 * Minimal, structured-clone friendly description of a feature on the map
 */
export interface MapSnapshotFeature {
    id: string;
    callsign?: string;
    type?: string;
    remarks?: string;
    geometry: string;
    point: [number, number];
    // First and last vertex of a LineString ([lon, lat]), so a route can be
    // described by where it starts and ends, not only by one point on it
    start?: [number, number];
    end?: [number, number];
}

export interface MapSnapshotSource {
    now: Date;
    selfUid?: string;
    self?: { lat: number; lon: number; callsign?: string };
    view: {
        lat: number;
        lon: number;
        bearing: number;
        tilt: number;
        // [west, south, east, north]
        bbox: [number, number, number, number];
    };
    basemap?: string;
    layers: string[];
    features: MapSnapshotFeature[];
}

export interface MapSnapshotItem {
    name: string;
    kind: MapSnapshotKind;
    type: string;
    lat: number;
    lon: number;
    remarks?: string;
    dist_m: number;
    // Routes only: where the line starts and ends. The bot turns these into
    // place names ("trasa od A do B"); a single point on the route cannot
    start?: { lat: number; lon: number };
    end?: { lat: number; lon: number };
}

export interface MapSnapshot {
    v: 1;
    t: string;
    self?: { lat: number; lon: number; callsign?: string };
    view: {
        lat: number;
        lon: number;
        scale_m: number;
        bearing: number;
        tilt: number;
        bbox: [number, number, number, number];
    };
    basemap?: string;
    layers: string[];
    items: MapSnapshotItem[];
    outside: Partial<Record<MapSnapshotKind, number>>;
}

// Mean earth radius, as used by @turf/distance
const EARTH_RADIUS_M = 6371008.8;

const SHAPE_TYPES = ['u-d-f', 'u-d-r', 'u-d-c'];

function isType(type: string, prefix: string): boolean {
    return type === prefix || type.startsWith(`${prefix}-`);
}

export function snapshotKind(type: string, geometry: string): MapSnapshotKind {
    if (isType(type, 'b-m-r')) return 'route';
    if (geometry === 'Polygon' || SHAPE_TYPES.some(prefix => isType(type, prefix))) return 'shape';
    if (isType(type, 'u-d')) return 'drawing';
    if (isType(type, 'a') && geometry === 'Point') return 'marker';
    return 'other';
}

function isCoordinate(value: unknown): value is number[] {
    return Array.isArray(value)
        && value.length >= 2
        && typeof value[0] === 'number' && Number.isFinite(value[0])
        && typeof value[1] === 'number' && Number.isFinite(value[1]);
}

/**
 * Reduce a GeoJSON feature to what the snapshot needs, using the precomputed
 * `properties.center` or a point on the geometry as its representative point
 */
export function mapSnapshotFeature(feat: {
    id: string;
    properties: { callsign?: string; type?: string; remarks?: string; center?: unknown };
    geometry: Geometry;
}): MapSnapshotFeature | undefined {
    let point: unknown;
    if (isCoordinate(feat.properties.center)) {
        point = feat.properties.center;
    } else {
        try {
            point = pointOnFeature(feat.geometry).geometry.coordinates;
        } catch {
            // Empty or malformed geometry
        }
    }

    if (!isCoordinate(point)) return;

    const feature: MapSnapshotFeature = {
        id: feat.id,
        callsign: feat.properties.callsign,
        type: feat.properties.type,
        remarks: feat.properties.remarks,
        geometry: feat.geometry.type,
        point: [point[0], point[1]],
    };

    if (feat.geometry.type === 'LineString' && feat.geometry.coordinates.length >= 2) {
        const first = feat.geometry.coordinates[0];
        const last = feat.geometry.coordinates[feat.geometry.coordinates.length - 1];
        if (isCoordinate(first) && isCoordinate(last)) {
            feature.start = [first[0], first[1]];
            feature.end = [last[0], last[1]];
        }
    }

    return feature;
}

function snapshotEnd(end: [number, number]): { lat: number; lon: number } {
    return { lat: round(end[1], 6), lon: round(wrapLon(end[0]), 6) };
}

function round(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function wrapLon(lon: number): number {
    if (lon >= -180 && lon <= 180) return lon;
    return ((lon + 180) % 360 + 360) % 360 - 180;
}

function inBbox(lon: number, lat: number, bbox: [number, number, number, number]): boolean {
    const [west, south, east, north] = bbox;
    if (lat < south || lat > north) return false;
    if (east - west >= 360) return true;
    // Longitude measured eastwards from the west edge, so views across the antimeridian work
    return ((lon - west) % 360 + 360) % 360 <= east - west;
}

// Size of the JSON as the server writes it into the CoT event
function byteLength(value: unknown): number {
    return new TextEncoder().encode(xmlSafeJSON(value)).length;
}

// Degrees in [0, 360): rounded first, so 359.999 becomes 0 and never 360
function normaliseBearing(bearing: number): number {
    return round((round(bearing, 2) % 360 + 360) % 360, 2) || 0;
}

export function buildMapSnapshot(source: MapSnapshotSource): MapSnapshot {
    const { view } = source;
    const center: [number, number] = [view.lon, view.lat];
    const [west, south, east, north] = view.bbox;

    const inside: Array<MapSnapshotItem> = [];
    const outside: MapSnapshot['outside'] = {};

    for (const feat of source.features) {
        if (source.selfUid && feat.id === source.selfUid) continue;

        const type = feat.type || '';
        const kind = snapshotKind(type, feat.geometry);
        const [lon, lat] = feat.point;

        if (!inBbox(lon, lat, view.bbox)) {
            outside[kind] = (outside[kind] || 0) + 1;
            continue;
        }

        const item: MapSnapshotItem = {
            name: feat.callsign || '',
            kind,
            type,
            lat: round(lat, 6),
            lon: round(wrapLon(lon), 6),
            dist_m: Math.round(distance(center, [lon, lat], { units: 'meters' })),
        };

        if (feat.remarks) item.remarks = feat.remarks;

        // Only routes get their ends: for a shape the first and last vertex
        // say nothing useful, and every extra byte counts against the 30 KB
        if (kind === 'route' && feat.start && feat.end) {
            item.start = snapshotEnd(feat.start);
            item.end = snapshotEnd(feat.end);
        }

        inside.push(item);
    }

    inside.sort((a, b) => a.dist_m - b.dist_m);

    const snapshot: MapSnapshot = {
        v: MAP_SNAPSHOT_VERSION,
        t: source.now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        ...(source.self ? { self: source.self } : {}),
        view: {
            lat: round(view.lat, 6),
            lon: round(wrapLon(view.lon), 6),
            // Width of the view along the parallel through its center
            scale_m: Math.round(Math.min(east - west, 360) / 360 * 2 * Math.PI * EARTH_RADIUS_M * Math.cos(view.lat * Math.PI / 180)),
            bearing: normaliseBearing(view.bearing),
            tilt: round(view.tilt, 2),
            bbox: east - west >= 360
                ? [-180, south, 180, north]
                : [round(wrapLon(west), 6), round(south, 6), round(wrapLon(east), 6), round(north, 6)],
        },
        ...(source.basemap ? { basemap: source.basemap } : {}),
        layers: source.layers,
        items: inside.slice(0, MAP_SNAPSHOT_MAX_ITEMS),
        outside,
    };

    while (snapshot.items.length && byteLength(snapshot) > MAP_SNAPSHOT_MAX_BYTES) {
        snapshot.items.pop();
    }

    if (byteLength(snapshot) > MAP_SNAPSHOT_MAX_BYTES) {
        throw new Error('Map snapshot does not fit in 30 KB');
    }

    return snapshot;
}
