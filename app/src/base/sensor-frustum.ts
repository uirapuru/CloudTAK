/**
 * taklab: 3D view frustum of camera markers (CoT <sensor>), drawn by deck.gl
 * in the 3D Tiles overlay next to the 2D footprint from base/cot/derived.ts.
 *
 * The apex stands 1.5 m above the map terrain at the marker (GPS height in
 * CoT is ellipsoidal and jumps, so it is not used). While the terrain under
 * a camera is not loaded yet the camera is left out: drawn at 0 m it would
 * sit hundreds of metres under the terrain, the ring (drawn over everything)
 * would drift across the map with every pan and the frustum would only show
 * from below the surface. The layer is redrawn when the terrain arrives. Four side faces and the
 * far face span fov x vfov around the azimuth, tilted by elevation, out to
 * the slant range. A camera of a live stream is red, the rest keep the
 * blue of the 2D footprint.
 *
 * Geometry and layer data are pure functions; deck.gl is loaded only when
 * there is something to draw.
 */

import { SENSOR_COLOR } from './cot/derived.ts';
import type { CameraMarker } from '../stores/live-video.ts';
import { markerMatchesStream, type LiveVideoStream } from './live-video.ts';

export const APEX_HEIGHT_M = 1.5;
/** Longest frustum drawn; a typo in range must not paint half a country. */
export const MAX_RANGE_M = 20_000;
export const MAX_FOV_DEG = 170;
export const EXTRA_LAYERS_KEY = 'sensor-frustum';

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];
export type Position3D = [number, number, number];

export const LIVE_RGB: RGB = [220, 38, 38];

export function hexToRgb(hex: string): RGB {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return [59, 130, 246];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

export const SENSOR_RGB: RGB = hexToRgb(SENSOR_COLOR);

type Sensor = NonNullable<CameraMarker['sensor']>;

export type FrustumParams = {
    azimuth: number;
    fov: number;
    vfov: number;
    elevation: number;
    roll: number;
    range: number;
};

/** Sensor attributes to frustum angles, or null when there is nothing to draw (same rules as the 2D footprint). */
export function frustumParams(sensor: Sensor | null | undefined): FrustumParams | null {
    if (!sensor || sensor.hideFov) return null;
    if (typeof sensor.azimuth !== 'number' || !Number.isFinite(sensor.azimuth)) return null;
    if (!sensor.fov || !sensor.range || sensor.fov <= 0 || sensor.range <= 0) return null;

    const fov = Math.min(sensor.fov, MAX_FOV_DEG);
    const vfov = typeof sensor.vfov === 'number' && sensor.vfov > 0
        ? Math.min(sensor.vfov, MAX_FOV_DEG)
        : fov * 9 / 16;

    return {
        azimuth: sensor.azimuth,
        fov,
        vfov,
        elevation: typeof sensor.elevation === 'number' && Number.isFinite(sensor.elevation) ? Math.max(-90, Math.min(90, sensor.elevation)) : 0,
        roll: typeof sensor.roll === 'number' && Number.isFinite(sensor.roll) ? sensor.roll : 0,
        range: Math.min(sensor.range, MAX_RANGE_M),
    };
}

type Vec3 = [number, number, number];

const RAD = Math.PI / 180;
const EARTH_RADIUS_M = 6378137;

function add(a: Vec3, b: Vec3, k = 1): Vec3 {
    return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
}

function cross(a: Vec3, b: Vec3): Vec3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function scale(a: Vec3, k: number): Vec3 {
    return [a[0] * k, a[1] * k, a[2] * k];
}

function norm(a: Vec3): number {
    return Math.hypot(a[0], a[1], a[2]);
}

/**
 * Far corners as east/north/up offsets in metres from the apex, in the order
 * bottom-left, bottom-right, top-right, top-left (as seen by the camera).
 */
export function frustumCornersENU(p: FrustumParams): Vec3[] {
    const az = p.azimuth * RAD;
    const el = p.elevation * RAD;
    const forward: Vec3 = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
    let right: Vec3 = [Math.cos(az), -Math.sin(az), 0];
    let up = cross(right, forward);

    if (p.roll) {
        const r = p.roll * RAD;
        const rolledRight = add(scale(right, Math.cos(r)), up, -Math.sin(r));
        up = add(scale(up, Math.cos(r)), right, Math.sin(r));
        right = rolledRight;
    }

    const h = Math.tan(p.fov / 2 * RAD);
    const v = Math.tan(p.vfov / 2 * RAD);

    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
        const dir = add(add(forward, right, sx * h), up, sy * v);
        return scale(dir, p.range / norm(dir));
    });
}

/** East/north/up metres from a point to longitude/latitude/altitude. */
export function offsetPosition(origin: Position3D, enu: Vec3): Position3D {
    const lat = origin[1] * RAD;
    return [
        origin[0] + enu[0] / (EARTH_RADIUS_M * Math.cos(lat)) / RAD,
        origin[1] + enu[1] / EARTH_RADIUS_M / RAD,
        origin[2] + enu[2],
    ];
}

export type Frustum = {
    apex: Position3D;
    corners: Position3D[];
    /** four triangles apex-corner-corner, then the far quad */
    faces: Position3D[][];
};

export function frustum(center: [number, number], ground: number, sensor: Sensor | null | undefined): Frustum | null {
    const p = frustumParams(sensor);
    if (!p) return null;
    const apex: Position3D = [center[0], center[1], ground + APEX_HEIGHT_M];
    const corners = frustumCornersENU(p).map((c) => offsetPosition(apex, c));
    const faces: Position3D[][] = [];
    for (let i = 0; i < 4; i++) {
        faces.push([apex, corners[i], corners[(i + 1) % 4]]);
    }
    faces.push([...corners]);
    return { apex, corners, faces };
}

export type FaceDatum = { id: string; polygon: Position3D[]; color: RGBA };
export type EdgeDatum = { id: string; path: Position3D[]; color: RGBA };
export type RingDatum = { id: string; position: Position3D; color: RGBA };

export type FrustumData = {
    faces: FaceDatum[];
    edges: EdgeDatum[];
    rings: RingDatum[];
};

export const FACE_ALPHA = 46;
export const LIVE_FACE_ALPHA = 72;
export const EDGE_ALPHA = 200;

/** Minimal map surface used to read the ground under a camera. */
export type TerrainMap = {
    getTerrain(): unknown;
    queryTerrainElevation(lngLat: [number, number]): number | null | undefined;
};

/**
 * Ground under a point as drawn by the map: 0 m on a flat map, the drawn
 * (exaggerated) terrain height in 3D, null while that terrain is not loaded.
 */
export function drawnGround(map: TerrainMap, lngLat: [number, number]): number | null {
    try {
        if (!map.getTerrain()) return 0;
        const value = map.queryTerrainElevation(lngLat);
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

/** Grounds of all cameras as one string, to redraw only when one of them changes. */
export function groundKey(cameras: Iterable<CameraMarker>, elevation: (lngLat: [number, number]) => number | null): string {
    return Array.from(cameras, (c) => {
        const g = elevation(c.coordinates);
        return `${c.id}:${g === null ? '-' : g.toFixed(1)}`;
    }).join('|');
}

/**
 * Layer data for all camera markers: a frustum for each one with a usable
 * sensor and a red ring for each camera of a live stream (sensor or not).
 * A camera whose ground is unknown (null) is skipped, see the file header.
 */
export function frustumData(
    cameras: Iterable<CameraMarker>,
    streams: Iterable<Pick<LiveVideoStream, 'path'>>,
    elevation: (lngLat: [number, number]) => number | null,
): FrustumData {
    const live = Array.from(streams);
    const out: FrustumData = { faces: [], edges: [], rings: [] };

    for (const camera of cameras) {
        const ground = elevation(camera.coordinates);
        if (ground === null) continue;
        const isLive = live.some((s) => markerMatchesStream(camera, s.path));
        const rgb = isLive ? LIVE_RGB : SENSOR_RGB;

        if (isLive) {
            out.rings.push({ id: camera.id, position: [camera.coordinates[0], camera.coordinates[1], ground], color: [...LIVE_RGB, 255] });
        }

        const f = frustum(camera.coordinates, ground, camera.sensor);
        if (!f) continue;

        const fill: RGBA = [...rgb, isLive ? LIVE_FACE_ALPHA : FACE_ALPHA];
        f.faces.forEach((polygon, i) => out.faces.push({ id: `${camera.id}.${i}`, polygon, color: fill }));

        const line: RGBA = [...rgb, EDGE_ALPHA];
        f.corners.forEach((corner, i) => out.edges.push({ id: `${camera.id}.r${i}`, path: [f.apex, corner], color: line }));
        out.edges.push({ id: `${camera.id}.far`, path: [...f.corners, f.corners[0]], color: line });
    }

    return out;
}

type LayerModules = {
    SolidPolygonLayer: new (props: Record<string, unknown>) => unknown;
    PathLayer: new (props: Record<string, unknown>) => unknown;
    ScatterplotLayer: new (props: Record<string, unknown>) => unknown;
};

/** deck.gl layers for frustumData; beforeId keeps them under the CoT markers. */
export function frustumLayers(modules: LayerModules, data: FrustumData, beforeId: string | undefined): unknown[] {
    // Translucent faces must not hide each other or the terrain behind them
    const translucent = { depthWriteEnabled: false };

    return [
        new modules.SolidPolygonLayer({
            id: 'taklab-sensor-frustum-faces',
            data: data.faces,
            beforeId,
            _full3d: true,
            filled: true,
            extruded: false,
            pickable: false,
            getPolygon: (d: FaceDatum) => d.polygon,
            getFillColor: (d: FaceDatum) => d.color,
            parameters: translucent,
        }),
        new modules.PathLayer({
            id: 'taklab-sensor-frustum-edges',
            data: data.edges,
            beforeId,
            pickable: false,
            widthUnits: 'pixels',
            getWidth: 1.5,
            getPath: (d: EdgeDatum) => d.path,
            getColor: (d: EdgeDatum) => d.color,
            parameters: translucent,
        }),
        new modules.ScatterplotLayer({
            id: 'taklab-live-camera-ring',
            data: data.rings,
            beforeId,
            pickable: false,
            stroked: true,
            filled: false,
            billboard: true,
            radiusUnits: 'pixels',
            getRadius: 22,
            lineWidthUnits: 'pixels',
            getLineWidth: 4,
            getPosition: (d: RingDatum) => d.position,
            getLineColor: (d: RingDatum) => d.color,
            // The ring stays visible over the terrain and the 3D buildings
            parameters: { depthCompare: 'always', depthWriteEnabled: false },
        }),
    ];
}

let modules: Promise<LayerModules> | null = null;

function loadModules(): Promise<LayerModules> {
    if (!modules) {
        modules = import('@deck.gl/layers').then((m) => ({
            SolidPolygonLayer: m.SolidPolygonLayer as unknown as LayerModules['SolidPolygonLayer'],
            PathLayer: m.PathLayer as unknown as LayerModules['PathLayer'],
            ScatterplotLayer: m.ScatterplotLayer as unknown as LayerModules['ScatterplotLayer'],
        })).catch((err) => {
            modules = null;
            throw err;
        });
    }
    return modules;
}

/** Has frustumData anything to draw? */
export function hasFrustumData(data: FrustumData): boolean {
    return data.faces.length > 0 || data.rings.length > 0;
}

/**
 * Draw (or clear) the frustums and rings in the shared deck.gl overlay.
 * Loads deck.gl only when something is to be drawn.
 */
export async function renderFrustums(
    cameras: CameraMarker[],
    streams: LiveVideoStream[],
    elevation: (lngLat: [number, number]) => number | null,
): Promise<void> {
    const { getTiles3D, peekTiles3D } = await import('./tiles3d.ts');
    const data = frustumData(cameras, streams, elevation);

    if (!hasFrustumData(data)) {
        peekTiles3D()?.setExtraLayers(EXTRA_LAYERS_KEY, null);
        return;
    }

    const [layers, manager] = await Promise.all([loadModules(), getTiles3D()]);
    manager.setExtraLayers(EXTRA_LAYERS_KEY, (beforeId) => frustumLayers(layers, data, beforeId));
}
