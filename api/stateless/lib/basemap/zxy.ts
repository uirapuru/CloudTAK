import undici from 'undici';
import { isSafeUrl } from '@tak-ps/node-safeurl';
import type { Response } from 'express';
import Err from '@openaddresses/batch-error';
import { BasemapProtocol, TileOpts } from '../interface-basemap.js';

/**
 * @class
 *
 * ZXY / Quadkey basemap protocol.
 * Proxies standard slippy-map tile requests ({z}/{x}/{y} or {q} quadkey URLs)
 * by streaming the upstream response directly to the client.
 *
 * WMS GetMap endpoints are supported through the MapLibre {bbox-epsg-3857}
 * variable, replaced with the Web Mercator extent of the requested tile.
 * WMS services without EPSG:3857 can use {bbox-epsg-4326-latlon}; the image is then stretched into the Mercator tile, which is accurate from about zoom 11.
 */
export default class ZXYBasemap extends BasemapProtocol {
    isValidURL(str: string): void {
        super.isValidURL(str);

        // Consistent Mapbox Style XYZ Endpoints: {z} vs TAK: {$z}
        const pathname = decodeURIComponent(str).replace(/\{\$/g, '{');

        if (
            !(pathname.includes('{z}') && pathname.includes('{x}') && pathname.includes('{y}'))
            && !pathname.includes('{q}')
            && !pathname.includes('{bbox-epsg-3857}')
            && !pathname.includes('{bbox-epsg-4326-latlon}')
        ) {
            throw new Err(400, null, 'ZXY protocol requires {z}/{x}/{y} tile variables, a {q} quadkey variable or a {bbox-epsg-3857} / {bbox-epsg-4326-latlon} variable');
        }
    }

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

    /** Time limit for one upstream tile request */
    static readonly TIMEOUT_MS = 15_000;

    /** Overridable in tests: resolves whether the tile URL may be fetched */
    protected async checkUrl(href: string): Promise<void> {
        const { safe, reason } = await isSafeUrl(href);
        if (!safe) throw new Err(400, null, `Blocked tile URL: ${reason}`);
    }

    /** Overridable in tests: the single upstream request */
    protected pipeline: typeof undici.pipeline = (url, opts, handler) => undici.pipeline(url, opts, handler);

    private async attempt(url: URL, res: Response, opts: Required<TileOpts>): Promise<void> {
        const stream = await this.pipeline(url, {
            method: 'GET',
            headers: opts.headers as Record<string, string>,
            signal: AbortSignal.timeout(ZXYBasemap.TIMEOUT_MS),
        }, ({ statusCode, headers, body }) => {
            if (headers) {
                for (const key in headers) {
                    if (
                        ![
                            'content-type',
                            'content-length',
                            'cache-control',
                            'content-encoding',
                            'last-modified',
                        ].includes(key.toLowerCase())
                    ) {
                        delete headers[key];
                    }
                }
            }

            res.writeHead(statusCode, headers);
            return body;
        });

        await new Promise((resolve, reject) => {
            stream
                .on('data', (buf) => {
                    res.write(buf);
                })
                .on('error', (err) => {
                    return reject(err);
                })
                .on('end', () => {
                    res.end();
                    return resolve(undefined);
                })
                .on('close', () => {
                    res.end();
                    return resolve(undefined);
                })
                .end();
        });
    }

    protected async _tile(
        z: number, x: number, y: number,
        res: Response,
        opts: Required<TileOpts>,
    ): Promise<void> {
        const url = new URL(ZXYBasemap.tileURL(this.basemap!.url, z, x, y));

        try {
            await this.checkUrl(url.href);

            try {
                await this.attempt(url, res, opts);
            } catch (err) {
                // One retry on timeout / network error, only while nothing was sent to the client.
                // An HTTP status from the source is a response, not an error, and never retried.
                if (res.headersSent) throw err;
                await this.attempt(url, res, opts);
            }
        } catch (err) {
            throw new Err(400, err instanceof Error ? err : new Error(String(err)), 'Failed to fetch tile');
        }
    }
}
