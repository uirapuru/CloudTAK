import Err from '@openaddresses/batch-error';
import { BasemapProtocol } from '../interface-basemap.js';

/**
 * @class
 *
 * ZXY / Quadkey basemap protocol - standard slippy-map tile URLs
 * ({z}/{x}/{y} or {q} quadkey).
 *
 * taklab: WMS GetMap templates with {bbox-epsg-3857} or
 * {bbox-epsg-4326-latlon} are accepted too; the tile server fills them in.
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
}
