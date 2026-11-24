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
    /** Remove an object from the asset bucket */
    remove: (key: string) => Promise<void>;
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
    /** Base delay between retries of API calls and tiles (doubles each attempt) */
    retryDelayMs?: number;
};

const REPORT_ATTEMPTS = 5;

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

function wait(ms: number): Promise<void> {
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * PATCH the job; false when the package no longer exists. Other failures
 * (API restarting, 502 from a rolling deploy) are retried with backoff.
 */
async function report(ctx: JobContext, job: AreaPackageJob, body: Record<string, unknown>): Promise<boolean> {
    const delay = ctx.retryDelayMs ?? 2000;
    let lastError: unknown;

    for (let attempt = 0; attempt < REPORT_ATTEMPTS; attempt++) {
        if (attempt) await wait(delay * 2 ** (attempt - 1));

        try {
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
            } else if (res.ok) {
                await res.body?.cancel();
                return true;
            }

            lastError = new Error(`Failed to update area package: ${res.status} ${await res.text()}`);
        } catch (err) {
            lastError = err;
        }
    }

    throw lastError;
}

/** Remove a profile asset this job created, as its owner */
async function deleteAsset(ctx: JobContext, job: AreaPackageJob, id: string): Promise<void> {
    try {
        const res = await fetch(new URL(`/api/profile/asset/${id}`, ctx.api), {
            safeUrlAllow: [ctx.api],
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${jwt.sign({ access: 'user', email: job.username }, ctx.secret)}`,
            },
        });
        await res.body?.cancel();
    } catch (err) {
        console.error(`error - area package ${job.id}: failed to remove asset ${id}`, err);
    }
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
    const zipKey = `area-package/${job.id}/package.zip`;
    let zipUploaded = false;

    const ensure = async (body: Record<string, unknown>): Promise<void> => {
        if (!await report(ctx, job, body)) {
            controller.abort();
            throw new PackageDeleted();
        }
    };

    // Progress is informative: a report that keeps failing must not fail an
    // hours long build, but a deleted package still stops it
    const progress = async (value: number): Promise<void> => {
        try {
            await ensure({ progress: value });
        } catch (err) {
            if (err instanceof PackageDeleted) throw err;
            console.error(`error - area package ${job.id}: progress report failed`, err);
        }
    };

    try {
        // Files left by an interrupted earlier attempt of this job
        for (const id of job.assets ?? []) await deleteAsset(ctx, job, id);

        const bounds = boundsOf(job);
        const total = job.layers.reduce((sum, l) => sum + countTiles(bounds, l.minzoom, l.maxzoom), 0) || 1;
        const max = maxBytes();
        let done = 0;
        let bytes = 0;
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
                    retryDelayMs: ctx.retryDelayMs,
                })) {
                    bytes += tile.data.length;
                    if (bytes > max) throw new Error('Paczka przekracza limit rozmiaru');

                    writer.put(tile.z, tile.x, tile.y, tile.data);
                    done++;

                    if (Date.now() - lastReport >= interval) {
                        lastReport = Date.now();
                        await progress(Math.min(99, Math.floor(done / total * 100)));
                    }
                }
            } finally {
                writer.close();
            }

            const pmtiles = path.join(dir, `${index}.pmtiles`);
            await deps.toPMTiles(file, pmtiles);

            await progress(Math.min(99, Math.floor(done / total * 100)));

            const asset = crypto.randomUUID();
            await deps.upload(`profile/${job.username}/${asset}.pmtiles`, pmtiles);
            await createAsset(ctx, job, asset, `${safeFileName(job.name)} – ${safeFileName(layer.name)}.pmtiles`);
            assets.push(asset);
            fs.rmSync(pmtiles, { force: true });

            // On the row at once, so deleting the package meanwhile removes it
            await ensure({ assets });

            mbtiles.push({ path: file, fileName: `${safeFileName(layer.name)}.mbtiles` });
        }

        const zip = await buildDataPackage({
            id: job.id,
            name: job.name,
            mbtiles,
            features: job.features,
            attachments: deps.attachment,
            workdir: path.join(dir, 'package'),
            removeSources: true,
        });

        const size = fs.statSync(zip).size;

        try {
            if (size > max) throw new Error('Paczka przekracza limit rozmiaru');

            await ensure({ progress: 99, assets });
            await deps.upload(zipKey, zip);
            zipUploaded = true;
        } finally {
            fs.rmSync(zip, { force: true });
        }

        await ensure({ status: 'Success', progress: 100, size, assets });
    } catch (err) {
        if (err instanceof PackageDeleted) {
            console.log(`ok - area package ${job.id} was deleted while building, removing what it produced`);
            for (const id of assets) await deleteAsset(ctx, job, id);
            if (zipUploaded) {
                await deps.remove(zipKey).catch((removeErr) => {
                    console.error(`error - area package ${job.id}: failed to remove ${zipKey}`, removeErr);
                });
            }
            return;
        }

        console.error(`error - area package ${job.id}:`, err);

        try {
            if (!await report(ctx, job, {
                status: 'Fail',
                error: err instanceof Error ? err.message : String(err),
                assets,
            })) {
                for (const id of assets) await deleteAsset(ctx, job, id);
            }
        } catch (reportErr) {
            // The row stays Running; the pool's stale requeue picks it up again
            console.error(`error - area package ${job.id}: failed to report failure`, reportErr);
        }
    } finally {
        controller.abort();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

export { toPMTiles };
