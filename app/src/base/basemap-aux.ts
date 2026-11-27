/*
* taklab: a style layer of a vector basemap may read raster tiles from another
* basemap, e.g. the TakLab Topo hillshade under its vector layers. The layer
* names that basemap in `metadata["taklab:basemap"]` (basemap id). The overlay
* adds one extra raster source per referenced basemap and points the layer at
* it; the persisted style keeps `source` = overlay id like every other layer.
*/

import type { LayerSpecification } from 'maplibre-gl';

export const AUX_BASEMAP_KEY = 'taklab:basemap';

/** Basemap id an overlay style layer reads its raster tiles from, if any */
export function auxBasemapId(layer: LayerSpecification): number | undefined {
    if (layer.type !== 'raster' && layer.type !== 'hillshade') return undefined;

    const metadata = (layer as { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== 'object') return undefined;

    const id = Number((metadata as Record<string, unknown>)[AUX_BASEMAP_KEY]);
    return Number.isInteger(id) && id > 0 ? id : undefined;
}

/** MapLibre source id of a basemap borrowed by an overlay */
export function auxSourceId(overlayId: number, basemapId: number): string {
    return `${overlayId}-basemap-${basemapId}`;
}

/**
 * Key of the borrowed basemap in the cloudtak-tilejson protocol. Overlay ids
 * are positive and -1 is the CoT layer, so borrowed sources live below -1e6.
 */
export function auxTileJSONKey(overlayId: number, basemapId: number): number {
    return -(1_000_000 + overlayId * 10_000 + basemapId);
}
