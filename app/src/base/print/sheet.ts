/**
 * taklab: geometry of a printed map sheet.
 *
 * A sheet is a paper page (A4/A3, portrait/landscape) showing the map at a
 * fixed scale around a centre point. The map is rendered north-up in Web
 * Mercator, the way MapLibre draws it, so the scale is exact along the centre
 * of the sheet. The MGRS grid is drawn on top in the UTM zone of the centre,
 * which makes its lines lean by the grid convergence, as on a paper map.
 *
 * Everything here is pure so it can be unit tested without a browser.
 */
import { asMGRS, latLngToUTM, parseMGRS, utmToLatLng } from '../../utils/coordinateFormat.ts';

export type PaperSize = 'a4' | 'a3';
export type Orientation = 'portrait' | 'landscape';
export type PrintFormat = 'pdf' | 'png';
/** plain: map with a header and footer; topo: topographic sheet, landscape, with a side panel. */
export type SheetLayout = 'plain' | 'topo';

export type PrintSheet = {
    lng: number;
    lat: number;
    /** Scale denominator, 25000 for 1:25 000. */
    scale: number;
    orientation: Orientation;
    paper: PaperSize;
    layout?: SheetLayout;
    /**
     * Latitude the scale is exact at. Sheets of one plan share the latitude
     * of the plan centre so their edges meet without gaps.
     */
    refLat?: number;
    /** [lng, lat] whose UTM zone the MGRS grid uses; the plan centre for a plan. */
    gridOrigin?: [number, number];
};

/** A block of sheets: columns x rows around the centre of the plan. */
export type PrintPlan = PrintSheet & {
    columns: number;
    rows: number;
};

export type PlannedSheet = PrintSheet & {
    /** 1-based number, row by row from the top left. */
    index: number;
    column: number;
    row: number;
};

/** PrintPlugin limit: a bigger block is a sign of a wrong scale. */
export const MAX_SHEETS = 16;
export const MAX_SHEETS_PER_SIDE = 4;

export const PRINT_SCALES = [5000, 10000, 25000, 50000, 100000, 250000] as const;
export const DEFAULT_SCALE = 25000;

/** Output resolution of PNG and PDF. 200 dpi keeps an A3 page under 9 Mpx. */
export const PRINT_DPI = 200;

const PAPER_MM: Record<PaperSize, [number, number]> = {
    a4: [210, 297],
    a3: [297, 420],
};

export const MARGIN_MM = 8;
export const HEADER_MM = 10;
export const FOOTER_MM = 26;

/** Topographic sheet: gutter around the map for grid labels and the side panel. */
export const TOPO_GUTTER_MM = 7;
export const TOPO_GAP_MM = 3;

export function topoPanelMm(paper: PaperSize): number {
    return paper === 'a3' ? 80 : 66;
}

/** CSS pixels per millimetre (CSS fixes 96 px to the inch). */
export const CSS_PX_PER_MM = 96 / 25.4;

const EARTH_RADIUS = 6378137;
/** MapLibre's world is 512 CSS px wide at zoom 0. */
const TILE_SIZE = 512;

export function pageMm(paper: PaperSize, orientation: Orientation): { width: number; height: number } {
    const [short, long] = PAPER_MM[paper];
    return orientation === 'portrait'
        ? { width: short, height: long }
        : { width: long, height: short };
}

/** Rectangle of the map on the page, in millimetres from the top left corner. */
export function mapAreaMm(paper: PaperSize, orientation: Orientation, layout: SheetLayout = 'plain'): { x: number; y: number; width: number; height: number } {
    const page = pageMm(paper, orientation);
    if (layout === 'topo') {
        // map on the left with a gutter for grid labels, panel on the right
        return {
            x: MARGIN_MM + TOPO_GUTTER_MM,
            y: MARGIN_MM + TOPO_GUTTER_MM,
            width: page.width - 2 * MARGIN_MM - 2 * TOPO_GUTTER_MM - TOPO_GAP_MM - topoPanelMm(paper),
            height: page.height - 2 * MARGIN_MM - 2 * TOPO_GUTTER_MM,
        };
    }
    return {
        x: MARGIN_MM,
        y: MARGIN_MM + HEADER_MM,
        width: page.width - 2 * MARGIN_MM,
        height: page.height - 2 * MARGIN_MM - HEADER_MM - FOOTER_MM,
    };
}

export function toMercator(lng: number, lat: number): [number, number] {
    const x = EARTH_RADIUS * lng * Math.PI / 180;
    const y = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    return [x, y];
}

export function fromMercator(x: number, y: number): [number, number] {
    const lng = x / EARTH_RADIUS * 180 / Math.PI;
    const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * 180 / Math.PI;
    return [lng, lat];
}

/**
 * How the map area of a sheet maps onto MapLibre: its size in CSS pixels, the
 * zoom that gives the requested scale, and the Mercator metres per CSS pixel.
 */
export type SheetFrame = {
    cssWidth: number;
    cssHeight: number;
    zoom: number;
    center: [number, number];
    mercatorPerPx: number;
    /** Ground metres per CSS pixel at the centre latitude. */
    groundPerPx: number;
};

export function sheetFrame(sheet: PrintSheet): SheetFrame {
    const area = mapAreaMm(sheet.paper, sheet.orientation, sheet.layout);
    const cssWidth = Math.round(area.width * CSS_PX_PER_MM);
    const cssHeight = Math.round(area.height * CSS_PX_PER_MM);
    const groundPerPx = sheet.scale / CSS_PX_PER_MM / 1000;
    const mercatorPerPx = groundPerPx / Math.cos((sheet.refLat ?? sheet.lat) * Math.PI / 180);
    const zoom = Math.log2(2 * Math.PI * EARTH_RADIUS / (TILE_SIZE * mercatorPerPx));

    return {
        cssWidth,
        cssHeight,
        zoom,
        center: toMercator(sheet.lng, sheet.lat),
        mercatorPerPx,
        groundPerPx,
    };
}

/** Position of a point in the map area of the sheet, in CSS pixels from its top left corner. */
export function framePx(frame: SheetFrame, lng: number, lat: number): [number, number] {
    const [x, y] = toMercator(lng, lat);
    return [
        frame.cssWidth / 2 + (x - frame.center[0]) / frame.mercatorPerPx,
        frame.cssHeight / 2 - (y - frame.center[1]) / frame.mercatorPerPx,
    ];
}

export function framePxToLngLat(frame: SheetFrame, px: number, py: number): [number, number] {
    return fromMercator(
        frame.center[0] + (px - frame.cssWidth / 2) * frame.mercatorPerPx,
        frame.center[1] - (py - frame.cssHeight / 2) * frame.mercatorPerPx,
    );
}

/** Corners of the map area: NW, NE, SE, SW as [lng, lat]. */
export function sheetCorners(sheet: PrintSheet): Array<[number, number]> {
    const frame = sheetFrame(sheet);
    return [
        framePxToLngLat(frame, 0, 0),
        framePxToLngLat(frame, frame.cssWidth, 0),
        framePxToLngLat(frame, frame.cssWidth, frame.cssHeight),
        framePxToLngLat(frame, 0, frame.cssHeight),
    ];
}

export function sheetPolygon(sheet: PrintSheet): GeoJSON.Feature<GeoJSON.Polygon> {
    const corners = sheetCorners(sheet);
    return {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]]] },
    };
}

/** Ground size of the map area in metres. */
export function groundSize(sheet: PrintSheet): { width: number; height: number } {
    const frame = sheetFrame(sheet);
    return { width: frame.cssWidth * frame.groundPerPx, height: frame.cssHeight * frame.groundPerPx };
}

/**
 * Short code of a sheet, kept in the address so a printed sheet can be shared:
 * MGRS centre, scale in thousands, orientation, and "3" for A3.
 * 34UFB263764-25p = centre 34U FB 263 764 (100 m), 1:25 000, portrait, A4.
 * The format follows maps.trex-arms.com (?s=34UFB2676-25p).
 */
export function encodeSheetCode(sheet: PrintSheet | PrintPlan): string {
    const parts = asMGRS(sheet.lat, sheet.lng).split(' ');
    if (parts.length !== 4) throw new Error('Sheet centre is outside the MGRS area');
    const [zone, square, easting, northing] = parts;
    const scale = sheet.scale / 1000;
    return `${zone}${square}${easting.slice(0, 3)}${northing.slice(0, 3)}-${scale}${sheet.layout === 'topo' ? 't' : sheet.orientation === 'portrait' ? 'p' : 'l'}${sheet.paper === 'a3' ? '3' : ''}${blockSuffix(sheet)}`;
}

export function decodeSheetCode(code: string): PrintPlan | null {
    const match = code.trim().toUpperCase().match(/^(\d{1,2}[C-HJ-NP-X][A-HJ-NP-Z]{2})(\d{2,10})-(\d+(?:\.\d+)?)([PLT])(3?)(?:-(\d)X(\d))?$/);
    if (!match) return null;

    const [, square, digits, scaleText, orientation, a3, columnsText, rowsText] = match;
    const columns = columnsText ? Number(columnsText) : 1;
    const rows = rowsText ? Number(rowsText) : 1;
    if (!validBlock(columns, rows)) return null;
    if (digits.length % 2 !== 0) return null;

    const scale = Math.round(Number(scaleText) * 1000);
    if (!Number.isFinite(scale) || scale < 1000 || scale > 1000000) return null;

    let corner: [number, number];
    try {
        corner = parseMGRS(square + digits);
    } catch {
        return null;
    }

    // The code names a square of the grid; the sheet is centred in that square.
    const cell = Math.pow(10, 5 - digits.length / 2);
    const utm = latLngToUTM(corner[0], corner[1]);
    const [lat, lng] = utmToLatLng(utm.zoneNum, utm.zoneLetter, utm.easting + cell / 2, utm.northing + cell / 2);

    return {
        lng,
        lat,
        scale,
        orientation: orientation === 'P' ? 'portrait' : 'landscape',
        layout: orientation === 'T' ? 'topo' : 'plain',
        paper: a3 ? 'a3' : 'a4',
        columns,
        rows,
    };
}

/** Distance between MGRS grid lines on the sheet. */
export function gridSpacing(scale: number): number {
    return scale <= 100000 ? 1000 : 10000;
}

export type GridLine = {
    axis: 'easting' | 'northing';
    /** UTM coordinate of the line in metres. */
    value: number;
    /** Two digit kilometre label, as printed on military maps. */
    label: string;
    /** Points along the line in CSS pixels of the map area. */
    points: Array<[number, number]>;
};

const GRID_SAMPLES = 12;

export function gridLines(sheet: PrintSheet, frame: SheetFrame = sheetFrame(sheet)): GridLine[] {
    const spacing = gridSpacing(sheet.scale);
    const [originLng, originLat] = sheet.gridOrigin ?? [sheet.lng, sheet.lat];
    const origin = latLngToUTM(originLat, originLng);
    const zone = origin.zoneNum;
    const zoneLetter = origin.zoneLetter;

    const cornersPx: Array<[number, number]> = [
        [0, 0], [frame.cssWidth, 0], [frame.cssWidth, frame.cssHeight], [0, frame.cssHeight],
        [frame.cssWidth / 2, 0], [frame.cssWidth / 2, frame.cssHeight],
    ];
    const utmCorners = cornersPx.map(([px, py]) => {
        const [lng, lat] = framePxToLngLat(frame, px, py);
        return latLngToUTM(lat, lng, zone);
    });

    // One spacing of slack on each side: a line ending exactly on the sheet
    // edge (the zone central meridian) would lose its edge label to rounding.
    const minE = Math.min(...utmCorners.map((c) => c.easting)) - spacing;
    const maxE = Math.max(...utmCorners.map((c) => c.easting)) + spacing;
    const minN = Math.min(...utmCorners.map((c) => c.northing)) - spacing;
    const maxN = Math.max(...utmCorners.map((c) => c.northing)) + spacing;

    const toPx = (easting: number, northing: number): [number, number] => {
        const [lat, lng] = utmToLatLng(zone, zoneLetter, easting, northing);
        return framePx(frame, lng, lat);
    };

    const lines: GridLine[] = [];
    for (const easting of multiples(minE, maxE, spacing)) {
        const points: Array<[number, number]> = [];
        for (let i = 0; i <= GRID_SAMPLES; i++) {
            points.push(toPx(easting, minN + (maxN - minN) * i / GRID_SAMPLES));
        }
        lines.push({ axis: 'easting', value: easting, label: gridLabel(easting), points });
    }
    for (const northing of multiples(minN, maxN, spacing)) {
        const points: Array<[number, number]> = [];
        for (let i = 0; i <= GRID_SAMPLES; i++) {
            points.push(toPx(minE + (maxE - minE) * i / GRID_SAMPLES, northing));
        }
        lines.push({ axis: 'northing', value: northing, label: gridLabel(northing), points });
    }
    return lines;
}

export function multiples(from: number, to: number, spacing: number): number[] {
    const first = Math.ceil(from / spacing);
    const last = Math.floor(to / spacing);
    const out: number[] = [];
    for (let i = first; i <= last; i++) out.push(i * spacing);
    return out;
}

/** Kilometres within the 100 km square: 34U FB 26 76 -> "26" and "76". */
export function gridLabel(value: number): string {
    return String(Math.floor((value % 100000) / 1000)).padStart(2, '0');
}

/**
 * Where a polyline crosses a horizontal (y = at) or vertical (x = at) edge,
 * or undefined when it does not.
 */
export function crossing(points: Array<[number, number]>, edge: 'x' | 'y', at: number): number | undefined {
    const i = edge === 'x' ? 0 : 1;
    const j = 1 - i;
    for (let k = 1; k < points.length; k++) {
        const a = points[k - 1];
        const b = points[k];
        if ((a[i] - at) * (b[i] - at) <= 0 && a[i] !== b[i]) {
            const t = (at - a[i]) / (b[i] - a[i]);
            return a[j] + (b[j] - a[j]) * t;
        }
    }
    return undefined;
}

/** Longest 1, 2 or 5 times a power of ten not above the limit, in metres. */
export function scaleBarMeters(limit: number): number {
    const value = Math.max(limit, 2);
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    const leading = value / magnitude;
    const factor = leading >= 5 ? 5 : leading >= 2 ? 2 : 1;
    return factor * magnitude;
}

export function formatDistance(meters: number, locale = 'pl'): string {
    if (meters < 1000) return `${meters} m`;
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(meters / 1000)} km`;
}

/** 25000 -> "1:25 000" */
export function formatScale(scale: number): string {
    return '1:' + String(scale).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Grid convergence: angle from true north to grid north at the point, in
 * degrees, positive when grid north lies east of true north.
 */
export function gridConvergence(lng: number, lat: number): number {
    const zone = latLngToUTM(lat, lng).zoneNum;
    const central = (zone - 1) * 6 - 180 + 3;
    const dLng = (lng - central) * Math.PI / 180;
    return Math.atan(Math.tan(dLng) * Math.sin(lat * Math.PI / 180)) * 180 / Math.PI;
}

/** Centre of the sheet in MGRS with 10 m digits: "34U FB 2634 7642". */
export function centreMgrs(sheet: PrintSheet): string {
    const parts = asMGRS(sheet.lat, sheet.lng).split(' ');
    if (parts.length !== 4) return '';
    return `${parts[0]} ${parts[1]} ${parts[2].slice(0, 4)} ${parts[3].slice(0, 4)}`;
}

export function sheetFilename(sheet: PrintSheet, format: PrintFormat): string {
    return `mapa-${encodeSheetCode(sheet)}.${format}`;
}

/**
 * Angles (degrees, clockwise from up) at which the north diagram draws grid
 * and magnetic north. Real angles in Poland are 0–8°, too close to tell the
 * arrows apart, so the diagram keeps only their side and order, the way
 * military map margins do; the true values are printed next to it.
 */
export function northDiagramAngles(convergence: number, declination?: number): { grid: number; magnetic?: number } {
    const near = (deg: number) => Math.abs(deg) < 0.05;
    const magneticSide = declination === undefined || near(declination) ? 1 : Math.sign(declination);
    const gridSide = near(convergence) ? -magneticSide : Math.sign(convergence);

    if (declination === undefined) return { grid: gridSide * 15 };
    if (gridSide !== magneticSide) return { grid: gridSide * 15, magnetic: magneticSide * 15 };

    return Math.abs(convergence) <= Math.abs(declination)
        ? { grid: gridSide * 15, magnetic: magneticSide * 30 }
        : { grid: gridSide * 30, magnetic: magneticSide * 15 };
}

/** "7,1° E", "0,4° W", or "0,0°" when the angle rounds to zero. */
export function formatAngle(deg: number, locale: string): string {
    const text = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(deg));
    if (Math.abs(deg) < 0.05) return `${text}°`;
    return `${text}° ${deg > 0 ? 'E' : 'W'}`;
}

/** [[west, south], [east, north]] of the sheet, for fitting the live map to it. */
export function sheetBounds(sheet: PrintSheet): [[number, number], [number, number]] {
    const corners = sheetCorners(sheet);
    const lngs = corners.map((c) => c[0]);
    const lats = corners.map((c) => c[1]);
    return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

export function validBlock(columns: number, rows: number): boolean {
    return Number.isInteger(columns) && Number.isInteger(rows)
        && columns >= 1 && rows >= 1
        && columns <= MAX_SHEETS_PER_SIDE && rows <= MAX_SHEETS_PER_SIDE
        && columns * rows <= MAX_SHEETS;
}

function blockSuffix(sheet: PrintSheet | PrintPlan): string {
    if (!('columns' in sheet) || (sheet.columns === 1 && sheet.rows === 1)) return '';
    return `-${sheet.columns}x${sheet.rows}`;
}

/**
 * Sheets of a plan, row by row from the top left. They share one Mercator
 * resolution (exact scale at the plan centre), so neighbouring sheets meet
 * edge to edge and can be taped together.
 */
export function planSheets(plan: PrintPlan): PlannedSheet[] {
    const base: PrintSheet = { ...plan, refLat: plan.lat };
    const frame = sheetFrame(base);
    const stepX = frame.cssWidth * frame.mercatorPerPx;
    const stepY = frame.cssHeight * frame.mercatorPerPx;

    const sheets: PlannedSheet[] = [];
    for (let row = 0; row < plan.rows; row++) {
        for (let column = 0; column < plan.columns; column++) {
            const x = frame.center[0] + (column - (plan.columns - 1) / 2) * stepX;
            const y = frame.center[1] - (row - (plan.rows - 1) / 2) * stepY;
            const [lng, lat] = fromMercator(x, y);
            sheets.push({
                lng,
                lat,
                scale: plan.scale,
                orientation: plan.orientation,
                layout: plan.layout,
                paper: plan.paper,
                refLat: plan.lat,
                gridOrigin: [plan.lng, plan.lat],
                index: row * plan.columns + column + 1,
                column,
                row,
            });
        }
    }
    return sheets;
}

/** Outline of every sheet of the plan, for the frame on the live map. */
export function planPolygons(plan: PrintPlan): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
    return {
        type: 'FeatureCollection',
        features: planSheets(plan).map((sheet) => ({
            ...sheetPolygon(sheet),
            properties: { index: sheet.index },
        })),
    };
}

/** [[west, south], [east, north]] of the whole plan. */
export function planBounds(plan: PrintPlan): [[number, number], [number, number]] {
    const corners = planSheets(plan).flatMap((sheet) => sheetCorners(sheet));
    const lngs = corners.map((c) => c[0]);
    const lats = corners.map((c) => c[1]);
    return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

/** 52.2297, 'lat' -> "52°13′47″N" */
export function formatDms(value: number, axis: 'lat' | 'lng'): string {
    const hemisphere = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
    let total = Math.round(Math.abs(value) * 3600);
    const degrees = Math.floor(total / 3600);
    total -= degrees * 3600;
    const minutes = Math.floor(total / 60);
    const seconds = total - minutes * 60;
    return `${degrees}°${String(minutes).padStart(2, '0')}′${String(seconds).padStart(2, '0')}″${hemisphere}`;
}

export type MgrsReading = {
    /** "34U DC" */
    square: string;
    /** Grid line west of the point, its 100 m digit and the result: "99", "4", "994". */
    easting: { line: string; add: string; value: string };
    /** Grid line south of the point, likewise. */
    northing: { line: string; add: string; value: string };
    /** "34U DC 994 918" (100 m) */
    result: string;
};

/** Worked example of reading an MGRS reference to 100 m, for the sheet margin. */
export function mgrsReading(lng: number, lat: number): MgrsReading | null {
    const parts = asMGRS(lat, lng).split(' ');
    if (parts.length !== 4) return null;
    const [zone, square, e, n] = parts;
    const easting = { line: e.slice(0, 2), add: e.slice(2, 3), value: e.slice(0, 3) };
    const northing = { line: n.slice(0, 2), add: n.slice(2, 3), value: n.slice(0, 3) };
    return {
        square: `${zone} ${square}`,
        easting,
        northing,
        result: `${zone} ${square} ${easting.value} ${northing.value}`,
    };
}
