/**
 * taklab: turns a composed page into a PDF or PNG file and hands it to the
 * browser, and keeps the sheet frame on the live map.
 */
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { PRINT_FRAME_LAYERS, PRINT_FRAME_SOURCE } from './render.ts';
import { pageMm, sheetFilename, sheetPolygon, type PrintFormat, type PrintSheet } from './sheet.ts';

export async function pageBlob(page: HTMLCanvasElement, sheet: PrintSheet, format: PrintFormat): Promise<Blob> {
    if (format === 'png') {
        return await new Promise<Blob>((resolve, reject) => {
            page.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png');
        });
    }

    const { jsPDF } = await import('jspdf');
    const size = pageMm(sheet.paper, sheet.orientation);
    const pdf = new jsPDF({
        orientation: sheet.orientation,
        unit: 'mm',
        format: [size.width, size.height],
        compress: true,
    });
    // JPEG keeps a 200 dpi A4 page around 2 MB instead of 10+ MB as PNG.
    pdf.addImage(page.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, size.width, size.height, undefined, 'FAST');
    pdf.setProperties({ title: sheetFilename(sheet, 'pdf'), creator: 'CloudTAK taklab.eu' });
    return pdf.output('blob');
}

export function saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Draws (or moves) the outline of the sheet on the live map. */
export function showSheetFrame(map: MapLibreMap, sheet: PrintSheet): void {
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [sheetPolygon(sheet)] };
    const source = map.getSource(PRINT_FRAME_SOURCE) as GeoJSONSource | undefined;
    if (source) {
        source.setData(data);
    } else {
        map.addSource(PRINT_FRAME_SOURCE, { type: 'geojson', data });
    }
    if (!map.getLayer(PRINT_FRAME_LAYERS[0])) {
        map.addLayer({
            id: PRINT_FRAME_LAYERS[0],
            type: 'fill',
            source: PRINT_FRAME_SOURCE,
            paint: { 'fill-color': '#d63939', 'fill-opacity': 0.06 },
        });
    }
    if (!map.getLayer(PRINT_FRAME_LAYERS[1])) {
        map.addLayer({
            id: PRINT_FRAME_LAYERS[1],
            type: 'line',
            source: PRINT_FRAME_SOURCE,
            paint: { 'line-color': '#d63939', 'line-width': 2.5, 'line-dasharray': [3, 2] },
        });
    }
    // CloudTAK slots basemaps and overlays in below what exists, so lift the
    // frame back to the top whenever something lands above it.
    if (!sheetFrameOnTop(map)) {
        for (const id of PRINT_FRAME_LAYERS) map.moveLayer(id);
    }
}

export function sheetFrameOnTop(map: MapLibreMap): boolean {
    const ids = map.getStyle().layers.map((layer) => layer.id);
    return ids.slice(-PRINT_FRAME_LAYERS.length).join() === PRINT_FRAME_LAYERS.join();
}

export function hideSheetFrame(map: MapLibreMap): void {
    for (const id of PRINT_FRAME_LAYERS) {
        if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(PRINT_FRAME_SOURCE)) map.removeSource(PRINT_FRAME_SOURCE);
}
