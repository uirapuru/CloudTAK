import { describe, expect, it } from 'vitest';
import { latLngToUTM, utmToLatLng } from '../../utils/coordinateFormat.ts';
import {
    CSS_PX_PER_MM,
    centreMgrs,
    crossing,
    decodeSheetCode,
    formatAngle,
    formatDistance,
    encodeSheetCode,
    formatScale,
    framePx,
    gridConvergence,
    gridLines,
    groundSize,
    mapAreaMm,
    northDiagramAngles,
    planBounds,
    planPolygons,
    planSheets,
    validBlock,
    scaleBarMeters,
    sheetCorners,
    sheetFrame,
    type PrintSheet,
} from './sheet.ts';

// Warsaw, 34U EC
const warsaw: PrintSheet = { lng: 21.0122, lat: 52.2297, scale: 25000, orientation: 'portrait', paper: 'a4' };

function haversine(a: [number, number], b: [number, number]): number {
    const R = 6371008.8;
    const toRad = (d: number) => d * Math.PI / 180;
    const dLat = toRad(b[1] - a[1]);
    const dLng = toRad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

describe('sheet geometry', () => {
    it('leaves room for the header and footer on A4 portrait', () => {
        const area = mapAreaMm('a4', 'portrait');
        expect(area.width).toBe(194);
        expect(area.height).toBe(297 - 16 - 10 - 26);
    });

    it('swaps the sides in landscape', () => {
        const area = mapAreaMm('a3', 'landscape');
        expect(area.width).toBe(420 - 16);
    });

    it('keeps the scale: 194 mm of paper is 4.85 km at 1:25 000', () => {
        const size = groundSize(warsaw);
        const expected = Math.round(194 * CSS_PX_PER_MM) / CSS_PX_PER_MM * 25;
        expect(size.width).toBeCloseTo(expected, 3);
        expect(size.width).toBeGreaterThan(4840);
        expect(size.width).toBeLessThan(4860);
    });

    it('measures the same ground width between the corners along the centre', () => {
        const [nw, ne, se, sw] = sheetCorners(warsaw);
        const west: [number, number] = [nw[0], warsaw.lat];
        const east: [number, number] = [ne[0], warsaw.lat];
        const measured = haversine(west, east);
        // spherical Mercator on the WGS84 ellipsoid: within 0.5 %
        expect(Math.abs(measured / groundSize(warsaw).width - 1)).toBeLessThan(0.005);
        expect(sw[0]).toBeCloseTo(nw[0], 9);
        expect(se[1]).toBeCloseTo(sw[1], 9);
    });

    it('puts the centre of the sheet in the middle of the frame', () => {
        const frame = sheetFrame(warsaw);
        const [x, y] = framePx(frame, warsaw.lng, warsaw.lat);
        expect(x).toBeCloseTo(frame.cssWidth / 2, 6);
        expect(y).toBeCloseTo(frame.cssHeight / 2, 6);
    });

    it('picks a deeper zoom for a larger scale', () => {
        const z25 = sheetFrame(warsaw).zoom;
        const z50 = sheetFrame({ ...warsaw, scale: 50000 }).zoom;
        expect(z25 - z50).toBeCloseTo(1, 6);
    });
});

describe('sheet code', () => {
    it('round-trips a sheet within 100 m', () => {
        const code = encodeSheetCode(warsaw);
        expect(code).toMatch(/^34U[A-Z]{2}\d{6}-25p$/);
        const back = decodeSheetCode(code)!;
        expect(back.scale).toBe(25000);
        expect(back.orientation).toBe('portrait');
        expect(back.paper).toBe('a4');
        expect(haversine([back.lng, back.lat], [warsaw.lng, warsaw.lat])).toBeLessThan(100);
    });

    it('reads the T.REX form with 1 km digits and centres it in the square', () => {
        const sheet = decodeSheetCode('34UFB2676-25p')!;
        expect(sheet).not.toBeNull();
        const utm = latLngToUTM(sheet.lat, sheet.lng);
        expect(utm.zoneNum).toBe(34);
        expect(Math.round(utm.easting % 100000)).toBe(26500);
        expect(Math.round(utm.northing % 100000)).toBe(76500);
    });

    it('carries landscape, A3 and other scales', () => {
        const code = encodeSheetCode({ ...warsaw, scale: 50000, orientation: 'landscape', paper: 'a3' });
        expect(code.endsWith('-50l3')).toBe(true);
        const back = decodeSheetCode(code)!;
        expect(back.paper).toBe('a3');
        expect(back.orientation).toBe('landscape');
        expect(back.scale).toBe(50000);
    });

    it('rejects garbage', () => {
        expect(decodeSheetCode('')).toBeNull();
        expect(decodeSheetCode('34UFB267-25p')).toBeNull();
        expect(decodeSheetCode('34UFB2676-25x')).toBeNull();
        expect(decodeSheetCode('hello')).toBeNull();
    });
});

describe('MGRS grid', () => {
    it('draws 1 km lines 40 mm apart at 1:25 000', () => {
        const frame = sheetFrame(warsaw);
        const lines = gridLines(warsaw, frame).filter((l) => l.axis === 'easting');
        expect(lines.length).toBeGreaterThanOrEqual(4);
        const xs = lines.map((l) => crossing(l.points, 'y', frame.cssHeight / 2)!);
        const gapMm = (xs[1] - xs[0]) / CSS_PX_PER_MM;
        // UTM scale factor and Mercator on the sphere: within 0.5 %
        expect(Math.abs(gapMm / 40 - 1)).toBeLessThan(0.005);
    });

    it('labels lines with kilometres in the 100 km square', () => {
        const lines = gridLines(warsaw);
        for (const line of lines) {
            expect(line.label).toMatch(/^\d{2}$/);
            expect(Number(line.label)).toBe(Math.floor((line.value % 100000) / 1000));
        }
    });

    it('tilts easting lines by the grid convergence', () => {
        const frame = sheetFrame(warsaw);
        const line = gridLines(warsaw, frame).find((l) => l.axis === 'easting')!;
        const first = line.points[0];
        const last = line.points[line.points.length - 1];
        // up the sheet is north; angle of grid north east of true north
        const angle = Math.atan2(last[0] - first[0], first[1] - last[1]) * 180 / Math.PI;
        expect(angle).toBeCloseTo(gridConvergence(warsaw.lng, warsaw.lat), 1);
    });
});

describe('gridConvergence', () => {
    it('is the angle of grid north east of true north', () => {
        const utm = latLngToUTM(warsaw.lat, warsaw.lng);
        const [lat2, lng2] = utmToLatLng(utm.zoneNum, utm.zoneLetter, utm.easting, utm.northing + 10000);
        const east = (lng2 - warsaw.lng) * Math.cos(warsaw.lat * Math.PI / 180);
        const north = lat2 - warsaw.lat;
        const bearing = Math.atan2(east, north) * 180 / Math.PI;
        expect(gridConvergence(warsaw.lng, warsaw.lat)).toBeCloseTo(bearing, 1);
    });

    it('is zero on the central meridian', () => {
        expect(gridConvergence(21, 52)).toBeCloseTo(0, 9);
    });
});

describe('labels', () => {
    it('formats scale with non-breaking thousand separators', () => {
        expect(formatScale(25000)).toBe('1:25 000');
        expect(formatScale(5000)).toBe('1:5 000');
    });

    it('rounds the scale bar down to 1, 2 or 5', () => {
        expect(scaleBarMeters(1300)).toBe(1000);
        expect(scaleBarMeters(2600)).toBe(2000);
        expect(scaleBarMeters(7300)).toBe(5000);
    });

    it('prints the centre with 10 m digits', () => {
        expect(centreMgrs(warsaw)).toMatch(/^34U [A-Z]{2} \d{4} \d{4}$/);
    });
});

describe('north diagram', () => {
    it('puts grid and magnetic north on their own sides', () => {
        expect(northDiagramAngles(-1.2, 6)).toEqual({ grid: -15, magnetic: 15 });
    });

    it('orders arrows on the same side by their real angle', () => {
        expect(northDiagramAngles(1.2, 6)).toEqual({ grid: 15, magnetic: 30 });
        expect(northDiagramAngles(3, 1)).toEqual({ grid: 30, magnetic: 15 });
    });

    it('moves a zero convergence away from the magnetic arrow', () => {
        expect(northDiagramAngles(0, 7.1)).toEqual({ grid: -15, magnetic: 15 });
    });

    it('works without a magnetic model', () => {
        expect(northDiagramAngles(0.8)).toEqual({ grid: 15 });
    });

    it('formats angles with the side, but not zero', () => {
        expect(formatAngle(7.08, 'pl')).toBe('7,1° E');
        expect(formatAngle(-0.44, 'en')).toBe('0.4° W');
        expect(formatAngle(-0.01, 'pl')).toBe('0,0°');
    });
});

describe('formatDistance', () => {
    it('switches to kilometres with the locale decimal sign', () => {
        expect(formatDistance(500)).toBe('500 m');
        expect(formatDistance(2500, 'pl')).toBe('2,5 km');
        expect(formatDistance(5000, 'en')).toBe('5 km');
    });
});

describe('plan of several sheets', () => {
    const plan = { ...warsaw, columns: 3, rows: 2 };

    it('numbers sheets row by row from the top left', () => {
        const sheets = planSheets(plan);
        expect(sheets.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(sheets[0].lat).toBeGreaterThan(sheets[3].lat);
        expect(sheets[0].lng).toBeLessThan(sheets[1].lng);
    });

    it('lets neighbouring sheets meet edge to edge', () => {
        const [first, second, , fourth] = planSheets(plan);
        const a = sheetCorners(first);
        const b = sheetCorners(second);
        const d = sheetCorners(fourth);
        // NE of sheet 1 = NW of sheet 2, SW of sheet 1 = NW of sheet 4
        expect(a[1][0]).toBeCloseTo(b[0][0], 9);
        expect(a[1][1]).toBeCloseTo(b[0][1], 9);
        expect(a[3][0]).toBeCloseTo(d[0][0], 9);
        expect(a[3][1]).toBeCloseTo(d[0][1], 9);
    });

    it('keeps one sheet in the middle when the plan is 1x1', () => {
        const [only] = planSheets({ ...warsaw, columns: 1, rows: 1 });
        expect(only.lng).toBeCloseTo(warsaw.lng, 9);
        expect(only.lat).toBeCloseTo(warsaw.lat, 9);
    });

    it('carries the block in the code', () => {
        const code = encodeSheetCode(plan);
        expect(code.endsWith('-25p-3x2')).toBe(true);
        const back = decodeSheetCode(code)!;
        expect(back.columns).toBe(3);
        expect(back.rows).toBe(2);
        expect(decodeSheetCode('34UFB2676-25p')!.columns).toBe(1);
    });

    it('refuses blocks above the limit', () => {
        expect(validBlock(4, 4)).toBe(true);
        expect(validBlock(5, 1)).toBe(false);
        expect(validBlock(0, 1)).toBe(false);
        expect(decodeSheetCode('34UFB2676-25p-5x1')).toBeNull();
    });

    it('gives the outline of every sheet', () => {
        expect(planPolygons(plan).features).toHaveLength(6);
        const [[w, s], [e, n]] = planBounds(plan);
        expect(w).toBeLessThan(warsaw.lng);
        expect(e).toBeGreaterThan(warsaw.lng);
        expect(s).toBeLessThan(warsaw.lat);
        expect(n).toBeGreaterThan(warsaw.lat);
    });
});

describe('grid on the zone central meridian', () => {
    it('labels every easting line on both the top and bottom edge', () => {
        // 21°E is the central meridian of zone 34: its grid line is vertical
        const sheet: PrintSheet = { lng: 21.0, lat: 52.25, scale: 25000, orientation: 'landscape', paper: 'a4' };
        const frame = sheetFrame(sheet);
        const inside = gridLines(sheet, frame).filter((l) => {
            if (l.axis !== 'easting') return false;
            const x = crossing(l.points, 'y', frame.cssHeight / 2);
            return x !== undefined && x > 0 && x < frame.cssWidth;
        });
        expect(inside.some((l) => l.value % 100000 === 0)).toBe(true);
        for (const line of inside) {
            expect(crossing(line.points, 'y', 0)).toBeDefined();
            expect(crossing(line.points, 'y', frame.cssHeight)).toBeDefined();
        }
    });
});
