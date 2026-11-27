/**
 * taklab: lays out a full print page around the rendered map.
 *
 * plain: header with title and scale, grid labels inside the map edge, and a
 * footer with a scale bar, the north diagram and print details.
 * topo: topographic sheet modelled on PrintPlugin - grid labels and corner
 * coordinates in a gutter around the map, and a side panel with the title,
 * sheet number, scale, north diagram, how to read MGRS, index and legend.
 */
import geomagnetism from 'geomagnetism';
import {
    FOOTER_MM,
    TOPO_GAP_MM,
    TOPO_GUTTER_MM,
    centreMgrs,
    crossing,
    formatAngle,
    formatDistance,
    formatDms,
    formatScale,
    framePxToLngLat,
    gridConvergence,
    gridLines,
    gridSpacing,
    mapAreaMm,
    mgrsReading,
    northDiagramAngles,
    pageMm,
    scaleBarMeters,
    topoPanelMm,
    type GridLine,
    type PrintSheet,
    type SheetFrame,
} from './sheet.ts';

export type PageLabels = {
    centre: string;
    grid: (spacing: string) => string;
    trueNorth: string;
    gridNorth: string;
    magneticNorth: string;
    declination: (value: string, date: string) => string;
    convergence: (value: string) => string;
    gridMagnetic: (value: string) => string;
    printed: (when: string) => string;
    sheet: (index: number, total: number) => string;
    /** Topographic sheet only. */
    topo?: {
        scale: string;
        north: string;
        mgrsTitle: string;
        mgrsSquare: (square: string) => string;
        mgrsEasting: (line: string, add: string, value: string) => string;
        mgrsNorthing: (line: string, add: string, value: string) => string;
        mgrsResult: (result: string) => string;
        index: string;
        legend: string;
        basemap: (name: string) => string;
        noOverlays: string;
    };
};

export type PageOptions = {
    title: string;
    grid: boolean;
    dpi: number;
    locale: string;
    labels: PageLabels;
    attribution: string;
    date?: Date;
    /** Place of the sheet in a block of sheets, for the header and the index. */
    block?: { index: number; columns: number; rows: number };
    /** Topographic sheet legend: basemap name and visible overlay names. */
    legend?: { basemap?: string; overlays: string[] };
};

/** Magnetic declination in degrees (east positive), or undefined outside the model. */
export function magneticDeclination(lat: number, lng: number, date: Date): number | undefined {
    try {
        return geomagnetism.model(date, { allowOutOfBoundsModel: true }).point([lat, lng]).decl;
    } catch {
        return undefined;
    }
}

type Pen = {
    ctx: CanvasRenderingContext2D;
    /** page pixels per millimetre */
    mm: number;
    font: (sizeMm: number, weight?: number) => string;
};

export function composePage(
    mapCanvas: HTMLCanvasElement,
    frame: SheetFrame,
    sheet: PrintSheet,
    opts: PageOptions
): HTMLCanvasElement {
    const mm = opts.dpi / 25.4;
    const page = pageMm(sheet.paper, sheet.orientation);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(page.width * mm);
    canvas.height = Math.round(page.height * mm);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pen: Pen = {
        ctx,
        mm,
        font: (sizeMm, weight = 400) => `${weight} ${sizeMm * mm}px "Open Sans", sans-serif`,
    };

    if (sheet.layout === 'topo') composeTopo(pen, mapCanvas, frame, sheet, opts);
    else composePlain(pen, mapCanvas, frame, sheet, opts);
    return canvas;
}

type MapRect = { x: number; y: number; w: number; h: number; k: number };

function drawMap(pen: Pen, mapCanvas: HTMLCanvasElement, frame: SheetFrame, sheet: PrintSheet): MapRect {
    const { ctx, mm } = pen;
    const area = mapAreaMm(sheet.paper, sheet.orientation, sheet.layout);
    const rect = { x: area.x * mm, y: area.y * mm, w: area.width * mm, h: area.height * mm, k: 0 };
    rect.k = rect.w / frame.cssWidth;
    ctx.drawImage(mapCanvas, rect.x, rect.y, rect.w, rect.h);
    return rect;
}

function drawGridLines(pen: Pen, rect: MapRect, lines: GridLine[]): void {
    const { ctx, mm } = pen;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.lineWidth = 0.15 * mm;
    for (const line of lines) {
        ctx.beginPath();
        line.points.forEach(([x, y], i) => {
            if (i === 0) ctx.moveTo(rect.x + x * rect.k, rect.y + y * rect.k);
            else ctx.lineTo(rect.x + x * rect.k, rect.y + y * rect.k);
        });
        ctx.stroke();
    }
    ctx.restore();
}

type EdgeLabel = { text: string; edge: 'top' | 'bottom' | 'left' | 'right'; at: number };

/** Where grid lines leave the map, in page pixels along each edge. */
function edgeLabels(rect: MapRect, frame: SheetFrame, lines: GridLine[], margin: number): EdgeLabel[] {
    const out: EdgeLabel[] = [];
    const within = (value: number | undefined, max: number): value is number =>
        value !== undefined && value > margin && value < max - margin;
    for (const line of lines) {
        if (line.axis === 'easting') {
            const top = crossing(line.points, 'y', 0);
            const bottom = crossing(line.points, 'y', frame.cssHeight);
            if (within(top, frame.cssWidth)) out.push({ text: line.label, edge: 'top', at: rect.x + top * rect.k });
            if (within(bottom, frame.cssWidth)) out.push({ text: line.label, edge: 'bottom', at: rect.x + bottom * rect.k });
        } else {
            const left = crossing(line.points, 'x', 0);
            const right = crossing(line.points, 'x', frame.cssWidth);
            if (within(left, frame.cssHeight)) out.push({ text: line.label, edge: 'left', at: rect.y + left * rect.k });
            if (within(right, frame.cssHeight)) out.push({ text: line.label, edge: 'right', at: rect.y + right * rect.k });
        }
    }
    return out;
}

function drawScaleBar(pen: Pen, sheet: PrintSheet, x: number, y: number, maxWidth: number, locale: string): number {
    const { ctx, mm, font } = pen;
    const groundPerPageMm = sheet.scale / 1000;
    const barMeters = scaleBarMeters(maxWidth / mm * groundPerPageMm);
    const barWidth = barMeters / groundPerPageMm * mm;
    const barHeight = 1.6 * mm;
    const segments = 4;
    for (let i = 0; i < segments; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#000' : '#fff';
        ctx.fillRect(x + barWidth * i / segments, y, barWidth / segments, barHeight);
    }
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.2 * mm;
    ctx.strokeRect(x, y, barWidth, barHeight);
    ctx.fillStyle = '#000';
    ctx.font = font(2.4);
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText('0', x, y - 0.5 * mm);
    if (barWidth >= 30 * mm) {
        // a short bar has no room for the middle label
        ctx.textAlign = 'center';
        ctx.fillText(formatDistance(barMeters / 2, locale), x + barWidth / 2, y - 0.5 * mm);
    }
    ctx.textAlign = 'right';
    ctx.fillText(formatDistance(barMeters, locale), x + barWidth, y - 0.5 * mm);
    return barHeight;
}

/** Arrows of true, grid and magnetic north growing up from (x, y). */
function drawNorthArrows(pen: Pen, sheet: PrintSheet, x: number, y: number, length: number, labels: PageLabels, date: Date): void {
    const { ctx, mm, font } = pen;
    const declination = magneticDeclination(sheet.lat, sheet.lng, date);
    const convergence = gridConvergence(sheet.lng, sheet.lat);
    const shown = northDiagramAngles(convergence, declination);
    const arrow = (deg: number, text: string, style: 'true' | 'grid' | 'magnetic') => {
        const rad = deg * Math.PI / 180;
        const tx = x + Math.sin(rad) * length;
        const ty = y - Math.cos(rad) * length;
        ctx.save();
        ctx.strokeStyle = '#000';
        ctx.fillStyle = '#000';
        ctx.lineWidth = 0.3 * mm;
        if (style === 'grid') ctx.setLineDash([0.9 * mm, 0.6 * mm]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);
        if (style === 'magnetic') {
            // half arrowhead, as on military map margins
            const back = 3 * mm;
            const hx = tx - Math.sin(rad) * back;
            const hy = ty + Math.cos(rad) * back;
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(hx + Math.cos(rad) * 1 * mm, hy + Math.sin(rad) * 1 * mm);
            ctx.lineTo(hx, hy);
            ctx.closePath();
            ctx.fill();
        } else if (style === 'true') {
            ctx.beginPath();
            ctx.arc(tx, ty, 0.7 * mm, 0, 2 * Math.PI);
            ctx.fill();
        }
        ctx.font = font(2.3, 700);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(text, tx + Math.sin(rad) * 2.5 * mm, ty - 1.2 * mm);
        ctx.restore();
    };
    arrow(0, labels.trueNorth, 'true');
    arrow(shown.grid, labels.gridNorth, 'grid');
    if (shown.magnetic !== undefined) arrow(shown.magnetic, labels.magneticNorth, 'magnetic');
}

function northFacts(sheet: PrintSheet, opts: PageOptions, date: Date): string[] {
    const angle = (deg: number) => formatAngle(deg, opts.locale);
    const declination = magneticDeclination(sheet.lat, sheet.lng, date);
    const convergence = gridConvergence(sheet.lng, sheet.lat);
    const when = new Intl.DateTimeFormat(opts.locale, { month: '2-digit', year: 'numeric' }).format(date);
    const facts: string[] = [];
    if (declination !== undefined) facts.push(opts.labels.declination(angle(declination), when));
    facts.push(opts.labels.convergence(angle(convergence)));
    if (declination !== undefined) facts.push(opts.labels.gridMagnetic(angle(declination - convergence)));
    return facts;
}

/** Index of a block of sheets with the current one filled; returns its height. */
function drawIndex(pen: Pen, block: NonNullable<PageOptions['block']>, x: number, y: number, maxWidth: number, maxHeight: number): number {
    const { ctx, mm, font } = pen;
    const cell = Math.min(maxWidth / block.columns, maxHeight / block.rows, 6 * mm);
    ctx.lineWidth = 0.2 * mm;
    ctx.strokeStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(Math.min(2.2, cell / mm * 0.5), 700);
    for (let row = 0; row < block.rows; row++) {
        for (let column = 0; column < block.columns; column++) {
            const n = row * block.columns + column + 1;
            const cx = x + column * cell;
            const cy = y + row * cell;
            const current = n === block.index;
            ctx.fillStyle = current ? '#000' : '#fff';
            ctx.fillRect(cx, cy, cell, cell);
            ctx.strokeRect(cx, cy, cell, cell);
            ctx.fillStyle = current ? '#fff' : '#000';
            ctx.fillText(String(n), cx + cell / 2, cy + cell / 2);
        }
    }
    return cell * block.rows;
}

function printedText(opts: PageOptions, date: Date): string {
    const printed = new Intl.DateTimeFormat(opts.locale, { dateStyle: 'short', timeStyle: 'short' }).format(date);
    return opts.labels.printed(printed);
}

function composePlain(pen: Pen, mapCanvas: HTMLCanvasElement, frame: SheetFrame, sheet: PrintSheet, opts: PageOptions): void {
    const { ctx, mm, font } = pen;
    const date = opts.date ?? new Date();
    const rect = drawMap(pen, mapCanvas, frame, sheet);
    const { x: mx, y: my, w: mw, h: mh } = rect;

    if (opts.grid) {
        const lines = gridLines(sheet, frame);
        drawGridLines(pen, rect, lines);
        ctx.save();
        ctx.font = font(2.4, 700);
        ctx.lineJoin = 'round';
        ctx.lineWidth = 0.7 * mm;
        ctx.strokeStyle = '#fff';
        ctx.fillStyle = '#000';
        const pad = 1 * mm;
        for (const label of edgeLabels(rect, frame, lines, 4)) {
            let x = label.at;
            let y = label.at;
            if (label.edge === 'top') { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; y = my + pad; }
            if (label.edge === 'bottom') { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; y = my + mh - pad; }
            if (label.edge === 'left') { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; x = mx + pad; }
            if (label.edge === 'right') { ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; x = mx + mw - pad; }
            ctx.strokeText(label.text, x, y);
            ctx.fillText(label.text, x, y);
        }
        ctx.restore();
    }

    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.4 * mm;
    ctx.strokeRect(mx, my, mw, mh);

    // Header
    const headerBase = my - 2 * mm;
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'right';
    let headerRight = mx + mw;
    ctx.font = font(5, 700);
    ctx.fillText(formatScale(sheet.scale), headerRight, headerBase);
    headerRight -= ctx.measureText(formatScale(sheet.scale)).width + 4 * mm;
    ctx.font = font(2.8);
    const centreText = `${opts.labels.centre}: ${centreMgrs(sheet)}`;
    ctx.fillText(centreText, headerRight, headerBase);
    headerRight -= ctx.measureText(centreText).width + 4 * mm;
    const total = opts.block ? opts.block.columns * opts.block.rows : 1;
    if (opts.block && total > 1) {
        ctx.font = font(3.4, 700);
        const sheetText = opts.labels.sheet(opts.block.index, total);
        ctx.fillText(sheetText, headerRight, headerBase);
        headerRight -= ctx.measureText(sheetText).width + 4 * mm;
    }
    ctx.textAlign = 'left';
    ctx.font = font(5, 700);
    ctx.fillText(fitText(ctx, opts.title, headerRight - mx), mx, headerBase);

    // Footer
    const fy = my + mh + 3 * mm;
    const columnWidth = mw / 3;

    if (opts.block && total > 1) {
        const box = 18 * mm;
        const cell = Math.min(box / opts.block.columns, box / opts.block.rows, 6 * mm);
        drawIndex(pen, opts.block, mx + columnWidth * 0.98 - cell * opts.block.columns, fy + 1 * mm, box, box);
    }

    const barShare = opts.block && total > 1 ? 0.55 : 0.8;
    const barY = fy + 3.5 * mm;
    const barHeight = drawScaleBar(pen, sheet, mx, barY, columnWidth * barShare, opts.locale);
    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = font(3.2, 700);
    ctx.fillText(formatScale(sheet.scale), mx, barY + barHeight + 1.5 * mm);
    ctx.font = font(2.4);
    if (opts.grid) {
        ctx.fillText(opts.labels.grid(formatDistance(gridSpacing(sheet.scale), opts.locale)), mx, barY + barHeight + 6 * mm);
    }

    const nx = mx + columnWidth + 8 * mm;
    drawNorthArrows(pen, sheet, nx, fy + FOOTER_MM * mm - 6 * mm, 12 * mm, opts.labels, date);
    ctx.fillStyle = '#000';
    ctx.font = font(2.4);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    northFacts(sheet, opts, date).forEach((line, i) => {
        ctx.fillText(fitText(ctx, line, columnWidth * 1.2 - 15 * mm), nx + 13 * mm, fy + 2 * mm + i * 3.6 * mm);
    });

    const rx = mx + mw;
    ctx.textAlign = 'right';
    ctx.font = font(2.4);
    ctx.fillText(printedText(opts, date), rx, fy + 2 * mm);
    ctx.font = font(2.4, 700);
    ctx.fillText('taklab.eu', rx, fy + 5.6 * mm);
    ctx.font = font(1.9);
    wrap(ctx, opts.attribution, columnWidth * 0.8).slice(0, 4).forEach((line, i) => {
        ctx.fillText(line, rx, fy + 9.6 * mm + i * 2.6 * mm);
    });
}

function composeTopo(pen: Pen, mapCanvas: HTMLCanvasElement, frame: SheetFrame, sheet: PrintSheet, opts: PageOptions): void {
    const { ctx, mm, font } = pen;
    const date = opts.date ?? new Date();
    const topo = opts.labels.topo;
    const rect = drawMap(pen, mapCanvas, frame, sheet);
    const { x: mx, y: my, w: mw, h: mh } = rect;
    const gutter = TOPO_GUTTER_MM * mm;

    if (opts.grid) drawGridLines(pen, rect, gridLines(sheet, frame));

    // Neat line around the map and outer frame around the gutter
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.4 * mm;
    ctx.strokeRect(mx, my, mw, mh);
    ctx.lineWidth = 0.2 * mm;
    ctx.strokeRect(mx - gutter, my - gutter, mw + 2 * gutter, mh + 2 * gutter);

    // Corner coordinates in the outer band of the gutter, grid labels in the inner one
    const corners = [
        { px: [0, 0], x: mx, y: my, align: 'left' as const, top: true },
        { px: [frame.cssWidth, 0], x: mx + mw, y: my, align: 'right' as const, top: true },
        { px: [0, frame.cssHeight], x: mx, y: my + mh, align: 'left' as const, top: false },
        { px: [frame.cssWidth, frame.cssHeight], x: mx + mw, y: my + mh, align: 'right' as const, top: false },
    ];
    ctx.fillStyle = '#000';
    ctx.font = font(2.0);
    for (const corner of corners) {
        const [lng, lat] = framePxToLngLat(frame, corner.px[0], corner.px[1]);
        const text = `${formatDms(lat, 'lat')} ${formatDms(lng, 'lng')}`;
        ctx.textAlign = corner.align;
        ctx.textBaseline = corner.top ? 'bottom' : 'top';
        ctx.fillText(text, corner.x, corner.top ? corner.y - gutter + 2.6 * mm : corner.y + gutter - 2.6 * mm);
    }

    if (opts.grid) {
        const lines = gridLines(sheet, frame);
        const offset = 1.5 * mm;
        ctx.font = font(2.5, 700);
        for (const label of edgeLabels(rect, frame, lines, 2)) {
            if (label.edge === 'top' || label.edge === 'bottom') {
                ctx.textAlign = 'center';
                ctx.textBaseline = label.edge === 'top' ? 'bottom' : 'top';
                ctx.fillText(label.text, label.at, label.edge === 'top' ? my - offset : my + mh + offset);
            } else {
                ctx.textAlign = label.edge === 'left' ? 'right' : 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(label.text, label.edge === 'left' ? mx - offset : mx + mw + offset, label.at);
            }
        }
    }

    // Side panel
    const px = mx + mw + gutter + TOPO_GAP_MM * mm;
    const pw = topoPanelMm(sheet.paper) * mm;
    const top = my - gutter;
    const bottom = top + mh + 2 * gutter;
    ctx.lineWidth = 0.2 * mm;
    ctx.strokeRect(px, top, pw, bottom - top);
    const pad = 3 * mm;
    const ix = px + pad;
    const iw = pw - 2 * pad;
    let y = top + pad;

    const heading = (text: string) => {
        ctx.fillStyle = '#000';
        ctx.font = font(2.5, 700);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(text.toUpperCase(), ix, y);
        y += 3.6 * mm;
    };
    const body = (text: string, size = 2.4, weight = 400) => {
        ctx.font = font(size, weight);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#000';
        for (const line of wrap(ctx, text, iw)) {
            ctx.fillText(line, ix, y);
            y += size * 1.35 * mm;
        }
    };
    const rule = () => {
        y += 1.5 * mm;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 0.15 * mm;
        ctx.beginPath();
        ctx.moveTo(ix, y);
        ctx.lineTo(ix + iw, y);
        ctx.stroke();
        y += 2.5 * mm;
    };

    // Title and sheet number
    const total = opts.block ? opts.block.columns * opts.block.rows : 1;
    ctx.font = font(4.6, 700);
    for (const line of wrap(ctx, opts.title, iw).slice(0, 2)) {
        ctx.fillStyle = '#000';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(line, ix, y);
        y += 5.8 * mm;
    }
    if (opts.block && total > 1) body(opts.labels.sheet(opts.block.index, total), 3.4, 700);
    body(`${opts.labels.centre}: ${centreMgrs(sheet)}`);
    rule();

    // Scale
    if (topo) heading(topo.scale);
    ctx.font = font(4.2, 700);
    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(formatScale(sheet.scale), ix, y);
    y += 8.5 * mm;
    y += drawScaleBar(pen, sheet, ix, y, iw, opts.locale) + 2 * mm;
    if (opts.grid) body(opts.labels.grid(formatDistance(gridSpacing(sheet.scale), opts.locale)));
    rule();

    // North
    if (topo) heading(topo.north);
    const arrowsTop = y + 4 * mm;
    drawNorthArrows(pen, sheet, ix + 8 * mm, arrowsTop + 14 * mm, 12 * mm, opts.labels, date);
    const factsX = ix + 19 * mm;
    ctx.font = font(2.2);
    let fy = arrowsTop;
    for (const fact of northFacts(sheet, opts, date)) {
        for (const line of wrap(ctx, fact, iw - 19 * mm)) {
            ctx.fillStyle = '#000';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(line, factsX, fy);
            fy += 3 * mm;
        }
    }
    y = Math.max(arrowsTop + 16 * mm, fy);
    rule();

    // How to read MGRS, on the centre of the sheet
    const reading = mgrsReading(sheet.lng, sheet.lat);
    if (topo && reading && opts.grid) {
        heading(topo.mgrsTitle);
        body(topo.mgrsSquare(reading.square), 2.2);
        body(topo.mgrsEasting(reading.easting.line, reading.easting.add, reading.easting.value), 2.2);
        body(topo.mgrsNorthing(reading.northing.line, reading.northing.add, reading.northing.value), 2.2);
        body(topo.mgrsResult(reading.result), 2.4, 700);
        rule();
    }

    // Index of the block
    if (topo && opts.block && total > 1) {
        heading(topo.index);
        y += drawIndex(pen, opts.block, ix, y, iw, 24 * mm) + 1 * mm;
        rule();
    }

    // Legend, then print details pinned to the panel bottom
    const footerLines = wrap(ctx, opts.attribution, iw).slice(0, 3);
    const footerTop = bottom - pad - (2 + footerLines.length) * 3 * mm;
    if (topo && opts.legend) {
        heading(topo.legend);
        if (opts.legend.basemap) body(topo.basemap(opts.legend.basemap), 2.2);
        const items = opts.legend.overlays.length ? opts.legend.overlays : [topo.noOverlays];
        for (const item of items) {
            if (y > footerTop - 4 * mm) break;
            body(`• ${item}`, 2.2);
        }
    }

    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let ly = footerTop;
    ctx.font = font(2.2);
    ctx.fillText(printedText(opts, date), ix, ly);
    ly += 3 * mm;
    ctx.font = font(2.2, 700);
    ctx.fillText('taklab.eu', ix, ly);
    ly += 3 * mm;
    ctx.font = font(1.8);
    for (const line of wrap(ctx, opts.attribution, iw).slice(0, 3)) {
        ctx.fillText(line, ix, ly);
        ly += 2.5 * mm;
    }
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
    if (ctx.measureText(text).width <= width) return text;
    let out = text;
    while (out.length > 1 && ctx.measureText(out + '…').width > width) out = out.slice(0, -1);
    return out + '…';
}

export function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (ctx.measureText(next).width > width && current) {
            lines.push(current);
            current = word;
        } else {
            current = next;
        }
    }
    if (current) lines.push(current);
    return lines;
}
