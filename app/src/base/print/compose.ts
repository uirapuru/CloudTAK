/**
 * taklab: lays out a full print page around the rendered map: header with
 * title and scale, MGRS grid with edge labels, and a footer with a scale bar,
 * the north diagram (true, grid and magnetic north) and print details.
 */
import geomagnetism from 'geomagnetism';
import {
    FOOTER_MM,
    centreMgrs,
    crossing,
    formatAngle,
    formatDistance,
    formatScale,
    gridConvergence,
    gridLines,
    gridSpacing,
    mapAreaMm,
    northDiagramAngles,
    pageMm,
    scaleBarMeters,
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
};

export type PageOptions = {
    title: string;
    grid: boolean;
    dpi: number;
    locale: string;
    labels: PageLabels;
    attribution: string;
    date?: Date;
};

/** Magnetic declination in degrees (east positive), or undefined outside the model. */
export function magneticDeclination(lat: number, lng: number, date: Date): number | undefined {
    try {
        return geomagnetism.model(date, { allowOutOfBoundsModel: true }).point([lat, lng]).decl;
    } catch {
        return undefined;
    }
}

export function composePage(
    mapCanvas: HTMLCanvasElement,
    frame: SheetFrame,
    sheet: PrintSheet,
    opts: PageOptions
): HTMLCanvasElement {
    const date = opts.date ?? new Date();
    const mm = opts.dpi / 25.4;
    const page = pageMm(sheet.paper, sheet.orientation);
    const area = mapAreaMm(sheet.paper, sheet.orientation);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(page.width * mm);
    canvas.height = Math.round(page.height * mm);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');

    const font = (sizeMm: number, weight = 400) => `${weight} ${sizeMm * mm}px "Open Sans", sans-serif`;
    const angle = (deg: number) => formatAngle(deg, opts.locale);

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Map
    const mx = area.x * mm;
    const my = area.y * mm;
    const mw = area.width * mm;
    const mh = area.height * mm;
    ctx.drawImage(mapCanvas, mx, my, mw, mh);

    // CSS px of the hidden map -> page px
    const k = mw / frame.cssWidth;

    if (opts.grid) {
        const lines = gridLines(sheet, frame);
        ctx.save();
        ctx.beginPath();
        ctx.rect(mx, my, mw, mh);
        ctx.clip();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.lineWidth = 0.15 * mm;
        for (const line of lines) {
            ctx.beginPath();
            line.points.forEach(([x, y], i) => {
                if (i === 0) ctx.moveTo(mx + x * k, my + y * k);
                else ctx.lineTo(mx + x * k, my + y * k);
            });
            ctx.stroke();
        }

        ctx.font = font(2.4, 700);
        ctx.lineJoin = 'round';
        ctx.lineWidth = 0.7 * mm;
        ctx.strokeStyle = '#fff';
        ctx.fillStyle = '#000';
        const label = (text: string, x: number, y: number, align: CanvasTextAlign, baseline: CanvasTextBaseline) => {
            ctx.textAlign = align;
            ctx.textBaseline = baseline;
            ctx.strokeText(text, x, y);
            ctx.fillText(text, x, y);
        };
        const pad = 1 * mm;
        for (const line of lines) {
            if (line.axis === 'easting') {
                const top = crossing(line.points, 'y', 0);
                const bottom = crossing(line.points, 'y', frame.cssHeight);
                if (top !== undefined && top > 4 && top < frame.cssWidth - 4) label(line.label, mx + top * k, my + pad, 'center', 'top');
                if (bottom !== undefined && bottom > 4 && bottom < frame.cssWidth - 4) label(line.label, mx + bottom * k, my + mh - pad, 'center', 'bottom');
            } else {
                const left = crossing(line.points, 'x', 0);
                const right = crossing(line.points, 'x', frame.cssWidth);
                if (left !== undefined && left > 4 && left < frame.cssHeight - 4) label(line.label, mx + pad, my + left * k, 'left', 'middle');
                if (right !== undefined && right > 4 && right < frame.cssHeight - 4) label(line.label, mx + mw - pad, my + right * k, 'right', 'middle');
            }
        }
        ctx.restore();
    }

    // Map border
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.4 * mm;
    ctx.strokeRect(mx, my, mw, mh);

    // Header
    const headerBase = (area.y - 2) * mm;
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = font(5, 700);
    ctx.fillText(fitText(ctx, opts.title, mw * 0.6), mx, headerBase);
    ctx.textAlign = 'right';
    ctx.font = font(5, 700);
    ctx.fillText(formatScale(sheet.scale), mx + mw, headerBase);
    const scaleWidth = ctx.measureText(formatScale(sheet.scale)).width;
    ctx.font = font(2.8);
    ctx.fillText(`${opts.labels.centre}: ${centreMgrs(sheet)}`, mx + mw - scaleWidth - 4 * mm, headerBase);

    // Footer
    const fy = (area.y + area.height + 3) * mm;
    const columnWidth = mw / 3;

    // Scale bar - at most two thirds of the left column
    const groundPerPageMm = sheet.scale / 1000;
    const barMeters = scaleBarMeters(columnWidth * 0.8 / mm * groundPerPageMm);
    const barWidth = barMeters / groundPerPageMm * mm;
    const barHeight = 1.6 * mm;
    const segments = 4;
    const barY = fy + 3.5 * mm;
    for (let i = 0; i < segments; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#000' : '#fff';
        ctx.fillRect(mx + barWidth * i / segments, barY, barWidth / segments, barHeight);
    }
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.2 * mm;
    ctx.strokeRect(mx, barY, barWidth, barHeight);
    ctx.fillStyle = '#000';
    ctx.font = font(2.4);
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText('0', mx, barY - 0.5 * mm);
    ctx.textAlign = 'center';
    ctx.fillText(formatDistance(barMeters / 2, opts.locale), mx + barWidth / 2, barY - 0.5 * mm);
    ctx.textAlign = 'right';
    ctx.fillText(formatDistance(barMeters, opts.locale), mx + barWidth, barY - 0.5 * mm);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = font(3.2, 700);
    ctx.fillText(formatScale(sheet.scale), mx, barY + barHeight + 1.5 * mm);
    ctx.font = font(2.4);
    if (opts.grid) {
        ctx.fillText(opts.labels.grid(formatDistance(gridSpacing(sheet.scale), opts.locale)), mx, barY + barHeight + 6 * mm);
    }

    // North diagram
    const declination = magneticDeclination(sheet.lat, sheet.lng, date);
    const convergence = gridConvergence(sheet.lng, sheet.lat);
    const nx = mx + columnWidth + 8 * mm;
    const ny = fy + FOOTER_MM * mm - 6 * mm;
    const arrowLength = 12 * mm;
    const shown = northDiagramAngles(convergence, declination);
    const arrow = (deg: number, text: string, style: 'true' | 'grid' | 'magnetic') => {
        const rad = deg * Math.PI / 180;
        const tx = nx + Math.sin(rad) * arrowLength;
        const ty = ny - Math.cos(rad) * arrowLength;
        ctx.save();
        ctx.strokeStyle = '#000';
        ctx.fillStyle = '#000';
        ctx.lineWidth = 0.3 * mm;
        if (style === 'grid') ctx.setLineDash([0.9 * mm, 0.6 * mm]);
        ctx.beginPath();
        ctx.moveTo(nx, ny);
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
    arrow(0, opts.labels.trueNorth, 'true');
    arrow(shown.grid, opts.labels.gridNorth, 'grid');
    if (shown.magnetic !== undefined) arrow(shown.magnetic, opts.labels.magneticNorth, 'magnetic');

    const when = new Intl.DateTimeFormat(opts.locale, { month: '2-digit', year: 'numeric' }).format(date);
    const facts: string[] = [];
    if (declination !== undefined) facts.push(opts.labels.declination(angle(declination), when));
    facts.push(opts.labels.convergence(angle(convergence)));
    if (declination !== undefined) facts.push(opts.labels.gridMagnetic(angle(declination - convergence)));
    ctx.font = font(2.4);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const factsX = nx + 13 * mm;
    facts.forEach((line, i) => {
        ctx.fillText(fitText(ctx, line, columnWidth + columnWidth * 0.2 - 15 * mm), factsX, fy + 2 * mm + i * 3.6 * mm);
    });

    // Print details
    const rx = mx + mw;
    ctx.textAlign = 'right';
    ctx.font = font(2.4);
    const printed = new Intl.DateTimeFormat(opts.locale, { dateStyle: 'short', timeStyle: 'short' }).format(date);
    ctx.fillText(opts.labels.printed(printed), rx, fy + 2 * mm);
    ctx.font = font(2.4, 700);
    ctx.fillText('taklab.eu', rx, fy + 5.6 * mm);
    ctx.font = font(1.9);
    wrap(ctx, opts.attribution, columnWidth * 0.8).slice(0, 4).forEach((line, i) => {
        ctx.fillText(line, rx, fy + 9.6 * mm + i * 2.6 * mm);
    });

    return canvas;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
    if (ctx.measureText(text).width <= width) return text;
    let out = text;
    while (out.length > 1 && ctx.measureText(out + '…').width > width) out = out.slice(0, -1);
    return out + '…';
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
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
