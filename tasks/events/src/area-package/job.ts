import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { fetch } from '@tak-ps/node-safeurl';
import { countTiles, safeFileName } from './tiles.ts';
import { fetchLayerTiles } from './fetch-tiles.ts';
import { MBTilesWriter, toPMTiles } from './mbtiles.ts';
import { buildDataPackage, type PackageAttachment } from './build.ts';
import type { AreaPackageJob, BBox } from './types.ts';

export type JobDeps = {
    /** Upload a local file to the asset bucket under the given key */
    upload: (key: string, file: string) => Promise<void>;
    /** Fetch an attachment by its hash, or null when it no longer exists */
    attachment: (hash: string) => Promise<PackageAttachment | null>;
    toPMTiles: (mbtiles: string, out: string) => Promise<void>;
};

export type JobContext = {
    api: string;
    tiles: string;
    secret: string;
    tmpdir: string;
    /** Minimum milliseconds between progress reports */
    progressInterval?: number;
};

/** The package was deleted while it was being built */
class PackageDeleted extends Error {}

export function maxBytes(): number {
    return Number(process.env.AREA_PACKAGE_MAX_BYTES || 2147483648);
}

export function etlToken(secret: string): string {
    return `etl.${jwt.sign({ access: 'area_package', internal: true }, secret)}`;
}

export function boundsOf(job: AreaPackageJob): BBox {
    const ring = job.bounds.coordinates[0];
    const lons = ring.map((c) => c[0]);
    const lats = ring.map((c) => c[1]);
    return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

/** PATCH the job; false when the package no longer exists */
async function report(ctx: JobContext, job: AreaPackageJob, body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(new URL(`/api/area-package/${job.id}`, ctx.api), {
        safeUrlAllow: [ctx.api],
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${etlToken(ctx.secret)}`,
        },
        body: JSON.stringify(body),
    });

    if (res.status === 404) {
        await res.body?.cancel();
        return false;
    } else if (!res.ok) {
        throw new Error(`Failed to update area package: ${await res.text()}`);
    }

    await res.body?.cancel();
    return true;
}

async function createAsset(ctx: JobContext, job: AreaPackageJob, id: string, name: string): Promise<void> {
    const res = await fetch(new URL('/api/profile/asset', ctx.api), {
        safeUrlAllow: [ctx.api],
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwt.sign({ access: 'user', email: job.username }, ctx.secret)}`,
        },
        body: JSON.stringify({ id, name, artifacts: [{ ext: '.pmtiles' }] }),
    });

    if (!res.ok) throw new Error(`Failed to create offline tiles asset: ${await res.text()}`);
    await res.body?.cancel();
}

/**
 * Build one area package: tiles of every layer into MBTiles and PMTiles,
 * PMTiles as offline profile assets, MBTiles and objects into an ATAK data package.
 * Always ends with a Success or Fail report, unless the package was deleted.
 */
export async function runJob(job: AreaPackageJob, ctx: JobContext, deps: JobDeps): Promise<void> {
    const dir = fs.mkdtempSync(path.join(ctx.tmpdir, `${job.id}-`));
    const controller = new AbortController();
    const interval = ctx.progressInterval ?? 2000;
    const assets: string[] = [];

    const ensure = async (body: Record<string, unknown>): Promise<void> => {
        if (!await report(ctx, job, body)) {
            controller.abort();
            throw new PackageDeleted();
        }
    };

    try {
        const bounds = boundsOf(job);
        const total = job.layers.reduce((sum, l) => sum + countTiles(bounds, l.minzoom, l.maxzoom), 0) || 1;
        let done = 0;
        let lastReport = 0;

        const mbtiles: Array<{ path: string; fileName: string }> = [];

        for (const [index, layer] of job.layers.entries()) {
            const file = path.join(dir, `${index}.mbtiles`);
            const writer = new MBTilesWriter(file, {
                name: layer.name,
                format: layer.format,
                bounds,
                minzoom: layer.minzoom,
                maxzoom: layer.maxzoom,
            });

            try {
                for await (const tile of fetchLayerTiles({
                    tilesBase: ctx.tiles,
                    secret: ctx.secret,
                    username: job.username,
                    layer,
                    bounds,
                    signal: controller.signal,
                })) {
                    writer.put(tile.z, tile.x, tile.y, tile.data);
                    done++;

                    if (Date.now() - lastReport >= interval) {
                        lastReport = Date.now();
                        await ensure({ progress: Math.min(99, Math.floor(done / total * 100)) });
                    }
                }
            } finally {
                writer.close();
            }

            const pmtiles = path.join(dir, `${index}.pmtiles`);
            await deps.toPMTiles(file, pmtiles);

            await ensure({ progress: Math.min(99, Math.floor(done / total * 100)) });

            const asset = crypto.randomUUID();
            await deps.upload(`profile/${job.username}/${asset}.pmtiles`, pmtiles);
            await createAsset(ctx, job, asset, `${safeFileName(job.name)} – ${layer.name}.pmtiles`);
            assets.push(asset);
            fs.rmSync(pmtiles, { force: true });

            mbtiles.push({ path: file, fileName: `${safeFileName(layer.name)}.mbtiles` });
        }

        const zip = await buildDataPackage({
            id: job.id,
            name: job.name,
            mbtiles,
            features: job.features,
            attachments: deps.attachment,
            workdir: path.join(dir, 'package'),
        });

        const size = fs.statSync(zip).size;

        try {
            if (size > maxBytes()) throw new Error('Paczka przekracza limit rozmiaru');

            await ensure({ progress: 99, assets });
            await deps.upload(`area-package/${job.id}/package.zip`, zip);
        } finally {
            fs.rmSync(zip, { force: true });
        }

        await ensure({ status: 'Success', progress: 100, size, assets });
    } catch (err) {
        if (err instanceof PackageDeleted) {
            console.log(`ok - area package ${job.id} was deleted while building`);
            return;
        }

        console.error(`error - area package ${job.id}:`, err);

        try {
            await report(ctx, job, {
                status: 'Fail',
                error: err instanceof Error ? err.message : String(err),
                assets,
            });
        } catch (reportErr) {
            console.error(`error - area package ${job.id}: failed to report failure`, reportErr);
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

export { toPMTiles };
