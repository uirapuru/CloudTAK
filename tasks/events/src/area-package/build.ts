import type { Feature } from 'geojson';

import fs from 'node:fs';
import { CoTParser, DataPackage } from '@tak-ps/node-cot';

export type PackageAttachment = { name: string; body: Buffer };

type ManifestContent = {
    Parameter: Array<{ _attributes: { name: string; value: string } }>;
};

/**
 * Remove the uid parameter of the content added last. ATAK's
 * MissionPackageFileAttachmentHandler2 compares a file's uid with itself, so
 * in a package that also holds CoT every file with a uid is unpacked into
 * atak/attachments; without it the file goes through the import sorters and
 * MBTiles land in the map layers.
 */
function dropContentUid(pkg: DataPackage): void {
    const contents = (pkg as unknown as { contents: ManifestContent[] }).contents;
    const last = contents[contents.length - 1];
    last.Parameter = last.Parameter.filter((p) => p._attributes.name !== 'uid');
}

/**
 * Compile an ATAK data package from MBTiles files and a GeoJSON snapshot of
 * map objects. Objects the CoT parser rejects and attachments that no longer
 * exist are skipped, so one bad object never sinks the whole package.
 *
 * @returns path of the finished zip
 */
export async function buildDataPackage(opts: {
    id: string;
    name: string;
    mbtiles: Array<{ path: string; fileName: string }>;
    features: Array<Feature>;
    attachments: (hash: string) => Promise<PackageAttachment | null>;
    /** Directory for the package build files and the zip; defaults to a new one in the OS temp dir */
    workdir?: string;
}): Promise<string> {
    const pkg = new DataPackage(opts.id, opts.name, opts.workdir ? { path: opts.workdir } : {});
    pkg.setPermanent();

    for (const file of opts.mbtiles) {
        await pkg.addFile(fs.createReadStream(file.path), { name: file.fileName });
        dropContentUid(pkg);
    }

    let skipped = 0;
    for (const feature of opts.features) {
        let cot;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cot = await CoTParser.from_geojson(feature as any);
        } catch {
            skipped++;
            continue;
        }

        await pkg.addCoT(cot);

        const hashes = (feature.properties?.attachments ?? []) as unknown;
        if (!Array.isArray(hashes)) continue;

        for (const hash of hashes) {
            if (typeof hash !== 'string') continue;
            const attachment = await opts.attachments(hash);
            if (!attachment) continue;

            await pkg.addFile(attachment.body, {
                name: attachment.name,
                attachment: cot.uid(),
            });
        }
    }

    if (skipped) console.log(`ok - area package ${opts.id}: skipped ${skipped} objects the CoT parser rejected`);

    return await pkg.finalize();
}
