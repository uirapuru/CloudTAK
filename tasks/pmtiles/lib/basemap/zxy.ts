import type { Response } from 'express';
import { BasemapProtocol, ResolvedTileOpts, TileBuffer } from './protocol.js';

/**
 * ZXY / Quadkey basemap protocol.
 * Proxies standard slippy-map tile requests ({z}/{x}/{y} or {q} quadkey URLs)
 * by streaming the upstream response directly to the client.
 *
 * taklab: WMS GetMap endpoints are supported through the MapLibre {bbox-epsg-3857}
 * variable, replaced with the Web Mercator extent of the requested tile.
 * WMS services without EPSG:3857 can use {bbox-epsg-4326-latlon}; the image is
 * then stretched into the Mercator tile, which is accurate from about zoom 11.
 */
export default class ZXYBasemap extends BasemapProtocol {
    /**
     * Web Mercator (EPSG:3857) extent of a ZXY tile as minx,miny,maxx,maxy
     */
    static mercatorExtent(z: number, x: number, y: number): string {
        const half = Math.PI * 6378137;
        const size = (2 * half) / Math.pow(2, z);

        return [
            -half + x * size,
            half - (y + 1) * size,
            -half + (x + 1) * size,
            half - y * size,
        ].join(',');
    }

    /**
     * WGS84 extent of a ZXY tile as minLat,minLon,maxLat,maxLon - the axis
     * order WMS 1.3.0 uses for EPSG:4326
     */
    static latLonExtent(z: number, x: number, y: number): string {
        const [west, south, east, north] = BasemapProtocol.extent(z, x, y);
        return [south, west, north, east].join(',');
    }

    /**
     * Fill a tile URL template with the coordinates of a single tile
     */
    static tileURL(template: string, z: number, x: number, y: number): string {
        return template
            .replace(/\{\$?z\}/, String(z))
            .replace(/\{\$?x\}/, String(x))
            .replace(/\{\$?y\}/, String(y))
            .replace(/\{\$?q\}/, String(BasemapProtocol.quadkey(z, x, y)))
            .replace(/\{bbox-epsg-3857\}/, ZXYBasemap.mercatorExtent(z, x, y))
            .replace(/\{bbox-epsg-4326-latlon\}/, ZXYBasemap.latLonExtent(z, x, y));
    }

    url(z: number, x: number, y: number): URL {
        return new URL(ZXYBasemap.tileURL(this.basemap.url, z, x, y));
    }

    protected async _tile(
        z: number, x: number, y: number,
        res: Response,
        opts: ResolvedTileOpts,
    ): Promise<void> {
        return this.pipe(this.url(z, x, y), res, opts);
    }

    protected async _buffer(
        z: number, x: number, y: number,
        opts: ResolvedTileOpts,
    ): Promise<TileBuffer | null> {
        return this.fetchBuffer(this.url(z, x, y), opts);
    }
}
