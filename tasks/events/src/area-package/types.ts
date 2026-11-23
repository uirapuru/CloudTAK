/** [west, south, east, north] in EPSG:4326 */
export type BBox = [number, number, number, number];

export type AreaPackageFormat = 'png' | 'jpeg' | 'webp';

// Mirrors AreaPackageLayer in api/common/area-package.ts
export type AreaPackageLayer = {
    source: 'basemap';
    id: number;
    name: string;
    format: AreaPackageFormat;
    host: string;
    minzoom: number;
    maxzoom: number;
} | {
    source: 'profile';
    file: string;
    name: string;
    format: AreaPackageFormat;
    host: 'profile';
    minzoom: number;
    maxzoom: number;
};

// Mirrors AreaPackageJob in api/stateless/routes/area-package.ts
export type AreaPackageJob = {
    id: string;
    created: string;
    updated: string;
    username: string;
    name: string;
    token: string;
    status: 'Pending' | 'Running' | 'Success' | 'Fail';
    error: string | null;
    progress: number;
    bounds: { type: 'Polygon'; coordinates: number[][][] };
    layers: AreaPackageLayer[];
    features: Array<GeoJSON.Feature>;
    assets: string[];
    size: number;
};
