/**
 * taklab: renders the map area of a print sheet with a second, hidden
 * MapLibre map built from the style of the live map.
 *
 * The hidden map is sized in CSS pixels to the map area on paper and drawn
 * with pixelRatio = dpi / 96, so labels and icons keep the size they have on
 * screen while the picture gets print resolution.
 */
import * as mapgl from 'maplibre-gl';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { PRINT_DPI, sheetFrame, type PrintSheet, type SheetFrame } from './sheet.ts';

/** Layers of the live map that only make sense on screen. */
export const PRINT_FRAME_LAYERS = ['taklab-print-sheet-fill', 'taklab-print-sheet-line'];
export const PRINT_FRAME_SOURCE = 'taklab-print-sheet';

const RENDER_TIMEOUT_MS = 90_000;

export type RenderedMap = {
    canvas: HTMLCanvasElement;
    frame: SheetFrame;
    /** Attribution of the sources on the sheet, as plain text. */
    attribution: string;
};

/**
 * Style of the live map without what cannot or should not be printed:
 * the sheet frame itself, terrain and globe. Custom (deck.gl, 3D tiles)
 * layers never reach getStyle(), so they drop out on their own.
 */
export function printableStyle(style: StyleSpecification): StyleSpecification {
    const copy: StyleSpecification = JSON.parse(JSON.stringify(style));
    copy.layers = copy.layers.filter((layer) => {
        if (PRINT_FRAME_LAYERS.includes(layer.id)) return false;
        return true;
    });
    if (copy.sources[PRINT_FRAME_SOURCE]) delete copy.sources[PRINT_FRAME_SOURCE];
    delete copy.terrain;
    copy.projection = { type: 'mercator' };
    return copy;
}

function attributionOf(map: MapLibreMap): string {
    const seen = new Set<string>();
    const style = map.getStyle();
    for (const id of Object.keys(style.sources)) {
        const source = map.getSource(id) as { attribution?: string } | undefined;
        const html = source?.attribution;
        if (!html) continue;
        const div = document.createElement('div');
        div.innerHTML = html;
        const text = (div.textContent || '').trim();
        if (text) seen.add(text);
    }
    return [...seen].join(' · ');
}

export async function renderSheetMap(
    live: MapLibreMap,
    sheet: PrintSheet,
    opts: { dpi?: number; signal?: AbortSignal } = {}
): Promise<RenderedMap> {
    const dpi = opts.dpi ?? PRINT_DPI;
    const frame = sheetFrame(sheet);

    const container = document.createElement('div');
    container.setAttribute('aria-hidden', 'true');
    Object.assign(container.style, {
        position: 'fixed',
        left: '-100000px',
        top: '0',
        width: `${frame.cssWidth}px`,
        height: `${frame.cssHeight}px`,
        visibility: 'hidden',
        pointerEvents: 'none',
    });
    document.body.appendChild(container);

    const map = new mapgl.Map({
        container,
        style: printableStyle(live.getStyle()),
        center: [sheet.lng, sheet.lat],
        zoom: frame.zoom,
        bearing: 0,
        pitch: 0,
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
        pixelRatio: dpi / 96,
        maxCanvasSize: [16384, 16384],
        canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    });

    // Icons added at runtime (CoT markers, iconsets) are not part of the
    // style JSON - borrow them from the live map on demand.
    map.on('styleimagemissing', (e) => {
        if (map.hasImage(e.id) || !live.hasImage(e.id)) return;
        const image = live.getImage(e.id);
        if (!image) return;
        map.addImage(e.id, image.data, { pixelRatio: image.pixelRatio, sdf: image.sdf });
    });

    try {
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('timeout')), RENDER_TIMEOUT_MS);
            const abort = () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
            };
            opts.signal?.addEventListener('abort', abort, { once: true });
            map.once('idle', () => {
                clearTimeout(timer);
                opts.signal?.removeEventListener('abort', abort);
                resolve();
            });
        });

        const source = map.getCanvas();
        const canvas = document.createElement('canvas');
        canvas.width = source.width;
        canvas.height = source.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D is not available');
        ctx.drawImage(source, 0, 0);

        return { canvas, frame, attribution: attributionOf(map) };
    } finally {
        map.remove();
        container.remove();
    }
}
