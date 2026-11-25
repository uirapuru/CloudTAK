import { describe, it, expect } from 'vitest';
import {
    APEX_HEIGHT_M,
    LIVE_RGB,
    SENSOR_RGB,
    MAX_RANGE_M,
    frustum,
    frustumCornersENU,
    frustumData,
    frustumLayers,
    frustumParams,
    hasFrustumData,
    hexToRgb,
    offsetPosition,
    drawnGround,
    groundKey,
} from './sensor-frustum.ts';
import { SENSOR_COLOR } from './cot/derived.ts';
import type { CameraMarker } from '../stores/live-video.ts';

const SENSOR = { azimuth: 90, fov: 60, vfov: 40, elevation: 0, range: 200 };

function camera(id: string, extra: Partial<CameraMarker> = {}): CameraMarker {
    return {
        id,
        callsign: id,
        coordinates: [17, 51],
        sensor: SENSOR,
        video: null,
        metadata: null,
        ...extra,
    };
}

function dist(a: number[]): number {
    return Math.hypot(a[0], a[1], a[2]);
}

describe('sensor frustum geometry', () => {
    it('reads the sensor like the 2D footprint and defaults vfov to 16:9', () => {
        expect(frustumParams(null)).toBeNull();
        expect(frustumParams({ azimuth: 10, fov: 60 })).toBeNull();
        expect(frustumParams({ fov: 60, range: 100 })).toBeNull();
        expect(frustumParams({ ...SENSOR, hideFov: true })).toBeNull();

        const p = frustumParams({ azimuth: 10, fov: 64, range: 100 });
        expect(p).toEqual({ azimuth: 10, fov: 64, vfov: 36, elevation: 0, roll: 0, range: 100 });
        expect(frustumParams({ ...SENSOR, range: 1e9 })?.range).toBe(MAX_RANGE_M);
    });

    it('points the corners along the azimuth, symmetric, at the slant range', () => {
        const corners = frustumCornersENU({ azimuth: 90, fov: 60, vfov: 40, elevation: 0, roll: 0, range: 200 });
        expect(corners).toHaveLength(4);
        for (const c of corners) {
            expect(dist(c)).toBeCloseTo(200, 6);
            expect(c[0]).toBeGreaterThan(0); // east
        }
        // bottom-left, bottom-right, top-right, top-left seen by a camera looking east
        const [bl, br, tr, tl] = corners;
        expect(bl[1]).toBeGreaterThan(0); // left of east is north
        expect(br[1]).toBeLessThan(0);
        expect(bl[2]).toBeLessThan(0);
        expect(tl[2]).toBeGreaterThan(0);
        expect(tr[1]).toBeCloseTo(br[1], 6);
        expect(tl[2]).toBeCloseTo(-bl[2], 6);

        // horizontal half angle is fov/2 on the centre line
        const mid = [(br[0] + tr[0]) / 2, (br[1] + tr[1]) / 2];
        expect(Math.atan2(-mid[1], mid[0]) * 180 / Math.PI).toBeCloseTo(30, 6);
    });

    it('tilts with elevation and keeps north at azimuth 0', () => {
        const down = frustumCornersENU({ azimuth: 0, fov: 40, vfov: 20, elevation: -30, roll: 0, range: 100 });
        const centreUp = down.reduce((s, c) => s + c[2], 0) / 4;
        const centreNorth = down.reduce((s, c) => s + c[1], 0) / 4;
        expect(centreUp).toBeLessThan(0);
        expect(centreNorth).toBeGreaterThan(0);
        expect(Math.atan2(centreUp, centreNorth) * 180 / Math.PI).toBeCloseTo(-30, 0);
        for (const c of down) expect(Math.abs(c[0])).toBeLessThan(40);
    });

    it('converts metres to degrees around the apex', () => {
        const p = offsetPosition([17, 51, 100], [0, 1000, 10]);
        expect(p[0]).toBeCloseTo(17, 9);
        expect(p[1] - 51).toBeCloseTo(1000 / 6378137 * 180 / Math.PI, 9);
        expect(p[2]).toBe(110);

        const east = offsetPosition([0, 60, 0], [1000, 0, 0]);
        expect(east[0]).toBeCloseTo(2 * 1000 / 6378137 * 180 / Math.PI, 6);
    });

    it('builds four side triangles and the far quad from an apex 1.5 m above the terrain', () => {
        const f = frustum([17, 51], 120, SENSOR)!;
        expect(f.apex).toEqual([17, 51, 120 + APEX_HEIGHT_M]);
        expect(f.faces).toHaveLength(5);
        for (const side of f.faces.slice(0, 4)) {
            expect(side).toHaveLength(3);
            expect(side[0]).toBe(f.apex);
        }
        expect(f.faces[4]).toEqual(f.corners);
        expect(frustum([17, 51], 0, null)).toBeNull();
    });
});

describe('sensor frustum layer data', () => {
    const live = { path: 'operator' };

    it('draws every camera with a sensor, red for the live one, blue for the rest', () => {
        const data = frustumData([
            camera('A', { metadata: { taklab_video: { path: 'operator' } } }),
            camera('B'),
            camera('C', { sensor: null, video: { url: 'rtsp://h:8554/other' } }),
        ], [live], () => 50);

        expect(data.faces).toHaveLength(10);
        expect(data.faces.filter((f) => f.id.startsWith('A.')).every((f) => f.color.slice(0, 3).join() === LIVE_RGB.join())).toBe(true);
        expect(data.faces.filter((f) => f.id.startsWith('B.')).every((f) => f.color.slice(0, 3).join() === SENSOR_RGB.join())).toBe(true);
        expect(data.edges).toHaveLength(10);
        expect(data.rings).toEqual([{ id: 'A', position: [17, 51, 50], color: [...LIVE_RGB, 255] }]);
        expect(data.faces[0].polygon[0][2]).toBe(50 + APEX_HEIGHT_M);
    });

    it('rings a live camera without a sensor and stands at 0 m without terrain', () => {
        const data = frustumData([camera('C', { sensor: null, video: { url: 'rtsp://h:8554/operator' } })], [live], () => 0);
        expect(data.faces).toEqual([]);
        expect(data.rings[0].position).toEqual([17, 51, 0]);
        expect(hasFrustumData(data)).toBe(true);
        expect(hasFrustumData(frustumData([], [live], () => 0))).toBe(false);
    });

    it('leaves out a camera while the terrain under it is not loaded', () => {
        const data = frustumData([
            camera('A', { metadata: { taklab_video: { path: 'operator' } } }),
            camera('B'),
        ], [live], () => null);
        expect(data).toEqual({ faces: [], edges: [], rings: [] });
        expect(hasFrustumData(data)).toBe(false);
    });

    it('reads the drawn ground: 0 m flat, terrain height in 3D, null while not loaded', () => {
        const flat = { getTerrain: () => null, queryTerrainElevation: () => 120 };
        const loaded = { getTerrain: () => ({ source: 'dem' }), queryTerrainElevation: () => 1048.9 };
        const loading = { getTerrain: () => ({ source: 'dem' }), queryTerrainElevation: () => null };
        const broken = { getTerrain: () => ({ source: 'dem' }), queryTerrainElevation: () => { throw new Error('no dem'); } };
        expect(drawnGround(flat, [17, 51])).toBe(0);
        expect(drawnGround(loaded, [17, 51])).toBe(1048.9);
        expect(drawnGround(loading, [17, 51])).toBeNull();
        expect(drawnGround(broken, [17, 51])).toBeNull();
    });

    it('keys the grounds so a redraw happens only when one changes', () => {
        const cams = [camera('A'), camera('B')];
        expect(groundKey(cams, () => null)).toBe('A:-|B:-');
        expect(groundKey(cams, () => 1048.94)).toBe('A:1048.9|B:1048.9');
    });

    it('makes a full-3D SolidPolygonLayer, edges and a ring layer', () => {
        class Layer { constructor(public props: Record<string, unknown>) {} }
        const layers = frustumLayers({ SolidPolygonLayer: Layer, PathLayer: Layer, ScatterplotLayer: Layer }, frustumData([camera('A')], [], () => 0), 'cot') as Layer[];
        expect(layers.map((l) => l.props.id)).toEqual(['taklab-sensor-frustum-faces', 'taklab-sensor-frustum-edges', 'taklab-live-camera-ring']);
        expect(layers[0].props._full3d).toBe(true);
        expect(layers[0].props.beforeId).toBe('cot');
        expect((layers[0].props.data as unknown[]).length).toBe(5);
    });

    it('uses the 2D footprint colour', () => {
        expect(hexToRgb(SENSOR_COLOR)).toEqual(SENSOR_RGB);
        expect(SENSOR_RGB).toEqual([59, 130, 246]);
    });
});
