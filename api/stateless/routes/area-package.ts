import path from 'node:path';
import { Type, Static } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import bboxPolygon from '@turf/bbox-polygon';
import { sql } from 'drizzle-orm';
import { GenericListOrder } from '@openaddresses/batch-generic';
import Auth from '../../common/auth.js';
import S3 from '../../common/aws/s3.js';
import { StandardResponse } from '../../common/types.js';
import { Basemap_Type } from '../../common/enums.js';
import type ConfigStateless from '../config.js';
import { profileAssetTileJSON } from '../lib/tilejson.js';
import { AreaPackage } from '../../common/schema.js';
import {
    type AreaPackageLayer,
    type AreaPackageFormat,
    type BBox,
    validateBounds,
    countTiles,
    estimateBytes,
    isGoogleUrl,
    limits,
    newToken,
} from '../../common/area-package.js';

const FEATURES_MAX_BYTES = 10 * 1024 * 1024;

const BoundsInput = Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()], {
    description: '[west, south, east, north] in EPSG:4326',
});

// A single object rather than a union: AJV's removeAdditional strips fields
// while trying the first branch of an anyOf, which breaks the second branch
const LayerRequest = Type.Object({
    source: Type.Union([Type.Literal('basemap'), Type.Literal('profile')]),
    id: Type.Optional(Type.Integer({ minimum: 1 })),
    file: Type.Optional(Type.String({ format: 'uuid' })),
    minzoom: Type.Optional(Type.Integer({ minimum: 0, maximum: 24 })),
    maxzoom: Type.Optional(Type.Integer({ minimum: 0, maximum: 24 })),
});

const FeatureInput = Type.Object({
    type: Type.Literal('Feature'),
    properties: Type.Record(Type.String(), Type.Unknown()),
    geometry: Type.Unknown(),
}, { additionalProperties: true });

const StoredLayer = Type.Object({
    source: Type.Union([Type.Literal('basemap'), Type.Literal('profile')]),
    id: Type.Optional(Type.Integer()),
    file: Type.Optional(Type.String()),
    name: Type.String(),
    format: Type.String(),
    host: Type.String(),
    minzoom: Type.Integer(),
    maxzoom: Type.Integer(),
});

export const AreaPackageResponse = Type.Object({
    id: Type.String(),
    created: Type.String(),
    updated: Type.String(),
    name: Type.String(),
    token: Type.String(),
    status: Type.String(),
    error: Type.Union([Type.Null(), Type.String()]),
    progress: Type.Integer(),
    bounds: Type.Unknown(),
    layers: Type.Array(StoredLayer),
    assets: Type.Array(Type.String()),
    size: Type.Number(),
});

const PreviewLayer = Type.Object({
    source: Type.String(),
    id: Type.Optional(Type.Integer()),
    file: Type.Optional(Type.String()),
    name: Type.String(),
    available: Type.Boolean(),
    reason: Type.Optional(Type.String()),
    format: Type.String(),
    host: Type.String(),
    minzoom: Type.Integer(),
    maxzoom: Type.Integer(),
    layer_minzoom: Type.Integer(),
    layer_maxzoom: Type.Integer(),
    tiles: Type.Integer(),
    bytes: Type.Number(),
});

type AreaPackageRow = typeof AreaPackage.$inferSelect;
type ResolvedLayer = Static<typeof PreviewLayer>;

/** Strip internal fields (the feature snapshot) before sending a row to its owner */
export function serialize(row: AreaPackageRow): Static<typeof AreaPackageResponse> {
    return {
        id: row.id,
        created: row.created,
        updated: row.updated,
        name: row.name,
        token: row.token,
        status: row.status,
        error: row.error,
        progress: row.progress,
        bounds: row.bounds,
        layers: row.layers,
        assets: row.assets,
        size: Number(row.size),
    };
}

function normalizeFormat(format: string): AreaPackageFormat {
    const f = format.toLowerCase();
    if (f === 'jpg' || f === 'jpeg') return 'jpeg';
    if (f === 'webp') return 'webp';
    return 'png';
}

function hostOf(url: string): string {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return '';
    }
}

function clampZoom(
    requested: { minzoom?: number; maxzoom?: number },
    layer_minzoom: number,
    layer_maxzoom: number,
): { minzoom: number; maxzoom: number } {
    return {
        minzoom: requested.minzoom ?? layer_minzoom,
        maxzoom: requested.maxzoom ?? layer_maxzoom,
    };
}

function unavailable(
    base: Pick<ResolvedLayer, 'source' | 'id' | 'file' | 'name'>,
    reason: 'google' | 'vector' | 'forbidden' | 'unsupported',
): ResolvedLayer {
    return {
        ...base,
        available: false,
        reason,
        format: 'png',
        host: '',
        minzoom: 0,
        maxzoom: 0,
        layer_minzoom: 0,
        layer_maxzoom: 0,
        tiles: 0,
        bytes: 0,
    };
}

async function resolveLayer(
    config: ConfigStateless,
    user: { email: string },
    bounds: BBox,
    layer: Static<typeof LayerRequest>,
): Promise<ResolvedLayer> {
    if (layer.source === 'basemap') {
        if (layer.id === undefined) throw new Err(400, null, 'Basemap layer requires an id');
        let basemap;
        try {
            basemap = await config.models.Basemap.from(layer.id);
        } catch {
            return unavailable({ source: 'basemap', id: layer.id, name: String(layer.id) }, 'forbidden');
        }

        const base = { source: 'basemap', id: basemap.id, name: basemap.name };

        if (basemap.username && basemap.username !== user.email) return unavailable(base, 'forbidden');
        if (isGoogleUrl(basemap.url)) return unavailable(base, 'google');
        if (basemap.type === Basemap_Type.VECTOR) return unavailable(base, 'vector');
        if (basemap.type !== Basemap_Type.RASTER) return unavailable(base, 'unsupported');

        const zoom = clampZoom(layer, basemap.minzoom, basemap.maxzoom);
        const format = normalizeFormat(basemap.format);
        const tiles = zoom.minzoom <= zoom.maxzoom ? countTiles(bounds, zoom.minzoom, zoom.maxzoom) : 0;

        return {
            ...base,
            available: true,
            format,
            host: hostOf(basemap.url),
            ...zoom,
            layer_minzoom: basemap.minzoom,
            layer_maxzoom: basemap.maxzoom,
            tiles,
            bytes: estimateBytes(tiles, format),
        };
    } else {
        if (layer.file === undefined) throw new Err(400, null, 'Profile layer requires a file');
        let file;
        try {
            file = await config.models.ProfileFile.from(layer.file);
        } catch {
            return unavailable({ source: 'profile', file: layer.file, name: layer.file }, 'forbidden');
        }

        const base = { source: 'profile', file: file.id, name: path.parse(file.name).name };

        if (file.username !== user.email || !file.artifacts.some((a) => a.ext === '.pmtiles')) {
            return unavailable(base, 'forbidden');
        }

        let tilejson;
        try {
            tilejson = await profileAssetTileJSON(config, { email: user.email, owner: user.email, asset: file.id });
        } catch {
            return unavailable(base, 'forbidden');
        }

        if (tilejson.vector_layers && tilejson.vector_layers.length) return unavailable(base, 'vector');

        const ext = path.extname(new URL(tilejson.tiles[0], 'http://localhost').pathname).slice(1);
        if (['mvt', 'pbf'].includes(ext)) return unavailable(base, 'vector');

        const layer_minzoom = tilejson.minzoom ?? 0;
        const layer_maxzoom = tilejson.maxzoom ?? 22;
        const zoom = clampZoom(layer, layer_minzoom, layer_maxzoom);
        const format = normalizeFormat(ext || 'png');
        const tiles = zoom.minzoom <= zoom.maxzoom ? countTiles(bounds, zoom.minzoom, zoom.maxzoom) : 0;

        return {
            ...base,
            available: true,
            format,
            host: 'profile',
            ...zoom,
            layer_minzoom,
            layer_maxzoom,
            tiles,
            bytes: estimateBytes(tiles, format),
        };
    }
}

async function deleteProfileAssets(config: ConfigStateless, username: string, assets: string[]): Promise<void> {
    for (const asset of assets) {
        try {
            const file = await config.models.ProfileFile.from(asset);
            if (file.username !== username) continue;
            await config.models.ProfileFile.delete(asset);
        } catch {
            // Already removed by the owner from the file list
        }

        await S3.del(`profile/${username}/${asset}`, { recurse: true });
    }
}

export async function ownedPackage(config: ConfigStateless, id: string, username: string): Promise<AreaPackageRow> {
    let row: AreaPackageRow;
    try {
        row = await config.models.AreaPackage.from(id);
    } catch {
        throw new Err(404, null, 'Area Package Not Found');
    }

    if (row.username !== username) throw new Err(404, null, 'Area Package Not Found');

    return row;
}

export default async function router(schema: Schema, config: ConfigStateless) {
    await schema.post('/profile/area-package/preview', {
        name: 'Preview Area Package',
        group: 'AreaPackage',
        description: 'Tile counts, size estimate and availability of each layer for an offline area package',
        body: Type.Object({
            bounds: BoundsInput,
            layers: Type.Array(LayerRequest),
        }),
        res: Type.Object({
            layers: Type.Array(PreviewLayer),
            tiles: Type.Integer(),
            bytes: Type.Number(),
            limits: Type.Object({
                tiles: Type.Integer(),
                bytes: Type.Number(),
                features: Type.Integer(),
            }),
        }),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            const bounds = req.body.bounds as BBox;
            validateBounds(bounds);

            const layers: ResolvedLayer[] = [];
            for (const layer of req.body.layers) {
                layers.push(await resolveLayer(config, user, bounds, layer));
            }

            res.json({
                layers,
                tiles: layers.reduce((sum, l) => sum + l.tiles, 0),
                bytes: layers.reduce((sum, l) => sum + l.bytes, 0),
                limits: limits(),
            });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/profile/area-package', {
        name: 'Create Area Package',
        group: 'AreaPackage',
        description: 'Queue an offline area package (ATAK data package and offline tiles) for the given area',
        body: Type.Object({
            name: Type.String({ minLength: 1, maxLength: 100 }),
            bounds: BoundsInput,
            layers: Type.Array(LayerRequest),
            features: Type.Array(FeatureInput),
        }),
        res: AreaPackageResponse,
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            const bounds = req.body.bounds as BBox;
            validateBounds(bounds);

            const max = limits();

            if (!req.body.layers.length && !req.body.features.length) {
                throw new Err(400, null, 'Area package must contain at least one layer or feature');
            } else if (req.body.features.length > max.features) {
                throw new Err(400, null, `Area package can contain at most ${max.features} features`);
            } else if (Buffer.byteLength(JSON.stringify(req.body.features)) > FEATURES_MAX_BYTES) {
                throw new Err(400, null, 'Area package features exceed 10 MB');
            }

            const layers: AreaPackageLayer[] = [];
            let tiles = 0;
            let bytes = 0;

            for (const requested of req.body.layers) {
                if (requested.minzoom === undefined || requested.maxzoom === undefined) {
                    throw new Err(400, null, 'Layer requires minzoom and maxzoom');
                } else if (requested.minzoom > requested.maxzoom) {
                    throw new Err(400, null, 'Layer minzoom must not be greater than maxzoom');
                }

                const layer = await resolveLayer(config, user, bounds, requested);

                if (!layer.available) {
                    throw new Err(400, null, `Layer ${layer.name} cannot be saved offline (${layer.reason})`);
                } else if (requested.minzoom < layer.layer_minzoom || requested.maxzoom > layer.layer_maxzoom) {
                    throw new Err(400, null, `Layer ${layer.name} supports zoom ${layer.layer_minzoom}-${layer.layer_maxzoom}`);
                }

                tiles += layer.tiles;
                bytes += layer.bytes;

                const common = {
                    name: layer.name,
                    format: layer.format as AreaPackageFormat,
                    minzoom: layer.minzoom,
                    maxzoom: layer.maxzoom,
                };

                if (requested.source === 'basemap') {
                    layers.push({ source: 'basemap', id: requested.id as number, host: layer.host, ...common });
                } else {
                    layers.push({ source: 'profile', file: requested.file as string, host: 'profile', ...common });
                }
            }

            if (tiles > max.tiles) {
                throw new Err(400, null, `Area package exceeds the limit of ${max.tiles} tiles (${tiles})`);
            } else if (bytes > max.bytes) {
                throw new Err(400, null, 'Area package exceeds the size limit');
            }

            const row = await config.models.AreaPackage.generate({
                username: user.email,
                name: req.body.name.trim(),
                token: newToken(),
                bounds: bboxPolygon(bounds).geometry,
                layers,
                features: req.body.features as AreaPackageRow['features'],
            });

            res.json(serialize(row));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/profile/area-package', {
        name: 'List Area Packages',
        group: 'AreaPackage',
        description: 'List your offline area packages',
        res: Type.Object({
            total: Type.Integer(),
            items: Type.Array(AreaPackageResponse),
        }),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);

            const list = await config.models.AreaPackage.list({
                limit: 1000,
                order: GenericListOrder.DESC,
                sort: 'created',
                where: sql`username = ${user.email}`,
            });

            res.json({
                total: list.total,
                items: list.items.map(serialize),
            });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/profile/area-package/:id', {
        name: 'Get Area Package',
        group: 'AreaPackage',
        description: 'Get one of your offline area packages',
        params: Type.Object({
            id: Type.String({ format: 'uuid' }),
        }),
        res: AreaPackageResponse,
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            res.json(serialize(await ownedPackage(config, req.params.id, user.email)));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.delete('/profile/area-package/:id', {
        name: 'Delete Area Package',
        group: 'AreaPackage',
        description: 'Delete an offline area package, its download link and its offline tiles',
        params: Type.Object({
            id: Type.String({ format: 'uuid' }),
        }),
        res: StandardResponse,
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            const row = await ownedPackage(config, req.params.id, user.email);

            await config.models.AreaPackage.delete(row.id);
            await S3.del(`area-package/${row.id}/`, { recurse: true });
            await deleteProfileAssets(config, user.email, row.assets);

            res.json({ status: 200, message: 'Area Package Deleted' });
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
