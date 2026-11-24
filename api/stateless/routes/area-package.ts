import path from 'node:path';
import { Type, Static } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import bboxPolygon from '@turf/bbox-polygon';
import qr from 'qr-image';
import { sql } from 'drizzle-orm';
import { GenericListOrder } from '@openaddresses/batch-generic';
import Auth, { AuthResourceAccess } from '../../common/auth.js';
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
    safeFileName,
    tileExtension,
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

// batch-schema runs AJV with removeAdditional: 'all', which drops every key not
// listed here even with additionalProperties: true. The id becomes the CoT UID
// in the ATAK package, so it has to be declared or ATAK sees new objects.
const FeatureInput = Type.Object({
    id: Type.Optional(Type.Union([Type.String(), Type.Number()])),
    type: Type.Literal('Feature'),
    path: Type.Optional(Type.String()),
    properties: Type.Record(Type.String(), Type.Unknown()),
    geometry: Type.Unknown(),
});

const StoredLayer = Type.Object({
    source: Type.Union([Type.Literal('basemap'), Type.Literal('profile')]),
    id: Type.Optional(Type.Integer()),
    file: Type.Optional(Type.String()),
    name: Type.String(),
    format: Type.String(),
    ext: Type.Optional(Type.String()),
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
    ext: Type.Optional(Type.String()),
    host: Type.String(),
    minzoom: Type.Integer(),
    maxzoom: Type.Integer(),
    layer_minzoom: Type.Integer(),
    layer_maxzoom: Type.Integer(),
    tiles: Type.Integer(),
    bytes: Type.Number(),
});

type AreaPackageRow = typeof AreaPackage.$inferSelect;

export const AreaPackageJob = Type.Composite([AreaPackageResponse, Type.Object({
    username: Type.String(),
    attempts: Type.Integer(),
    features: Type.Array(Type.Unknown()),
})]);

function serializeJob(row: AreaPackageRow): Static<typeof AreaPackageJob> {
    return {
        ...serialize(row),
        username: row.username,
        attempts: row.attempts,
        features: row.features,
    };
}

/** RFC 6266 Content-Disposition with an ASCII fallback and a UTF-8 filename */
function disposition(name: string): string {
    const file = `${safeFileName(name)}.zip`;
    // eslint-disable-next-line no-control-regex
    const ascii = file.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file)}`;
}

const NOT_FOUND = { status: 404, message: 'Not Found', messages: [] };

const MAX_ACTIVE_PER_USER = 3;
const MAX_ATTEMPTS = 3;
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

        const ext = path.extname(new URL(tilejson.tiles[0], 'http://localhost').pathname).slice(1).toLowerCase();
        if (['mvt', 'pbf'].includes(ext)) return unavailable(base, 'vector');

        const tile = tileExtension(new URL(tilejson.tiles[0], 'http://localhost').toString());
        if (!tile) return unavailable(base, 'unsupported');

        const layer_minzoom = tilejson.minzoom ?? 0;
        const layer_maxzoom = tilejson.maxzoom ?? 22;
        const zoom = clampZoom(layer, layer_minzoom, layer_maxzoom);
        const format = tile.format;
        const tiles = zoom.minzoom <= zoom.maxzoom ? countTiles(bounds, zoom.minzoom, zoom.maxzoom) : 0;

        return {
            ...base,
            available: true,
            format,
            ext: tile.ext,
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

            const active = await config.models.AreaPackage.count({
                where: sql`username = ${user.email} AND status IN ('Pending', 'Running')`,
            });

            if (active >= MAX_ACTIVE_PER_USER) {
                throw new Err(400, null, `Możesz mieć naraz najwyżej ${MAX_ACTIVE_PER_USER} paczki w kolejce. Poczekaj, aż któraś się złoży.`);
            } else if (!req.body.layers.length && !req.body.features.length) {
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
                    layers.push({ source: 'profile', file: requested.file as string, ext: layer.ext ?? layer.format, host: 'profile', ...common });
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

    await schema.get('/profile/area-package/:id/qr', {
        name: 'Area Package QR',
        group: 'AreaPackage',
        description: 'Public download link of a finished area package and a QR code that imports it into ATAK',
        params: Type.Object({
            id: Type.String({ format: 'uuid' }),
        }),
        res: Type.Object({
            url: Type.String(),
            uri: Type.String(),
            svg: Type.String(),
        }),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            const row = await ownedPackage(config, req.params.id, user.email);

            if (row.status !== 'Success') throw new Err(409, null, 'Paczka nie jest jeszcze gotowa');

            const url = `${config.API_URL.replace(/\/$/, '')}/api/public/area-package/${row.token}.zip`;
            const uri = `tak://com.atakmap.app/import?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(`${safeFileName(row.name)}.zip`)}`;

            res.json({ url, uri, svg: String(qr.imageSync(uri, { type: 'svg' })) });
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
    await schema.get('/public/area-package/:token.zip', {
        name: 'Download Area Package',
        group: 'AreaPackage',
        description: 'Public, unauthenticated download of a finished area package by its link token',
        params: Type.Object({
            token: Type.String(),
        }),
        security: Auth.security({ optional: true }),
    }, async (req, res) => {
        try {
            const rows = await config.models.AreaPackage.list({
                limit: 1,
                where: sql`token = ${req.params.token} AND status = 'Success'`,
            });

            if (rows.items.length !== 1) {
                res.status(404).json(NOT_FOUND);
                return;
            }

            const row = rows.items[0];

            let object;
            try {
                object = await S3.getObject(`area-package/${row.id}/package.zip`);
            } catch {
                res.status(404).json(NOT_FOUND);
                return;
            }

            res.set('Content-Type', 'application/zip');
            if (object.contentLength !== undefined) res.set('Content-Length', String(object.contentLength));
            res.set('Content-Disposition', disposition(row.name));

            object.body.pipe(res);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/area-package', {
        name: 'List Area Package Jobs',
        group: 'AreaPackage',
        description: 'Internal: list area package jobs for the worker',
        query: Type.Object({
            status: Type.Optional(Type.Union([Type.Literal('Pending'), Type.Literal('Running'), Type.Literal('Success'), Type.Literal('Fail')])),
            limit: Type.Integer({ minimum: 1, maximum: 100, default: 1 }),
        }),
        res: Type.Object({
            items: Type.Array(AreaPackageJob),
        }),
        security: Auth.security({ resources: [AuthResourceAccess.AREA_PACKAGE] }),
    }, async (req, res) => {
        try {
            await Auth.as_resource(config, req, { resources: [{ access: AuthResourceAccess.AREA_PACKAGE }] });

            const list = await config.models.AreaPackage.list({
                limit: req.query.limit,
                order: GenericListOrder.ASC,
                sort: 'created',
                where: req.query.status ? sql`status = ${req.query.status}` : undefined,
            });

            res.json({ items: list.items.map(serializeJob) });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/area-package/requeue', {
        name: 'Requeue Area Package Jobs',
        group: 'AreaPackage',
        description: 'Internal: put Running jobs without a recent heartbeat back to Pending, or fail them after repeated interruptions',
        body: Type.Object({
            stale_minutes: Type.Optional(Type.Integer({ minimum: 1 })),
        }),
        res: Type.Object({
            count: Type.Integer(),
        }),
        security: Auth.security({ resources: [AuthResourceAccess.AREA_PACKAGE] }),
    }, async (req, res) => {
        try {
            await Auth.as_resource(config, req, { resources: [{ access: AuthResourceAccess.AREA_PACKAGE }] });

            const stale = req.body.stale_minutes
                ? sql`AND updated < Now() - make_interval(mins => ${req.body.stale_minutes})`
                : sql``;

            await config.pg.update(AreaPackage)
                .set({
                    status: 'Fail',
                    error: `Składanie paczki przerwano ${MAX_ATTEMPTS} razy`,
                    updated: sql`Now()`,
                })
                .where(sql`status = 'Running' AND attempts >= ${MAX_ATTEMPTS} ${stale}`);

            const rows = await config.pg.update(AreaPackage)
                .set({ status: 'Pending', progress: 0, updated: sql`Now()` })
                .where(sql`status = 'Running' ${stale}`)
                .returning({ id: AreaPackage.id });

            res.json({ count: rows.length });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/area-package/:id/claim', {
        name: 'Claim Area Package Job',
        group: 'AreaPackage',
        description: 'Internal: atomically move a Pending job to Running for one worker',
        params: Type.Object({
            id: Type.String({ format: 'uuid' }),
        }),
        res: AreaPackageJob,
        security: Auth.security({ resources: [AuthResourceAccess.AREA_PACKAGE] }),
    }, async (req, res) => {
        try {
            await Auth.as_resource(config, req, { resources: [{ access: AuthResourceAccess.AREA_PACKAGE }] });

            const rows = await config.pg.update(AreaPackage)
                .set({
                    status: 'Running',
                    progress: 0,
                    attempts: sql`${AreaPackage.attempts} + 1`,
                    updated: sql`Now()`,
                })
                .where(sql`id = ${req.params.id} AND status = 'Pending'`)
                .returning();

            if (rows.length !== 1) {
                const exists = await config.models.AreaPackage.count({ where: sql`id = ${req.params.id}` });
                throw new Err(exists ? 409 : 404, null, exists ? 'Area Package is not Pending' : 'Area Package Not Found');
            }

            res.json(serializeJob(rows[0]));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.patch('/area-package/:id', {
        name: 'Update Area Package Job',
        group: 'AreaPackage',
        description: 'Internal: worker reports status, progress and results',
        params: Type.Object({
            id: Type.String({ format: 'uuid' }),
        }),
        body: Type.Object({
            status: Type.Optional(Type.Union([Type.Literal('Pending'), Type.Literal('Running'), Type.Literal('Success'), Type.Literal('Fail')])),
            progress: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
            error: Type.Optional(Type.String()),
            size: Type.Optional(Type.Integer({ minimum: 0 })),
            assets: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
        }),
        res: AreaPackageJob,
        security: Auth.security({ resources: [AuthResourceAccess.AREA_PACKAGE] }),
    }, async (req, res) => {
        try {
            await Auth.as_resource(config, req, { resources: [{ access: AuthResourceAccess.AREA_PACKAGE }] });

            try {
                await config.models.AreaPackage.from(req.params.id);
            } catch {
                throw new Err(404, null, 'Area Package Not Found');
            }

            const row = await config.models.AreaPackage.commit(req.params.id, {
                ...req.body,
                updated: sql`Now()`,
            });

            res.json(serializeJob(row));
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
