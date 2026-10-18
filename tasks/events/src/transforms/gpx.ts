import fs from 'node:fs/promises';
import path from 'node:path';
import type { Message, LocalMessage, Transform, ConvertResponse } from '../types.ts';
import { gpx } from '../togeojson/index.ts';

/**
 * GPX tracks, routes and waypoints to line delimited GeoJSON.
 *
 * The parser (togeojson/gpx.ts) was already part of the worker, but no
 * transform registered the extension, so every .gpx import failed with
 * "Unsupported Input Format".
 */
export default class GPX implements Transform {
    static register() {
        return {
            inputs: ['.gpx'],
        };
    }

    msg: Message;
    local: LocalMessage;

    constructor(
        msg: Message,
        local: LocalMessage,
    ) {
        this.msg = msg;
        this.local = local;
    }

    async convert(): Promise<ConvertResponse> {
        const features = gpx(String(await fs.readFile(this.local.raw))).features;

        if (!features.length) {
            throw new Error('GPX file contains no tracks, routes or waypoints');
        }

        console.error('ok - converted to GeoJSON');

        const output = path.resolve(this.local.tmpdir, this.local.id + '.geojsonld');

        await fs.writeFile(output, features.map((feat) => {
            return JSON.stringify(feat);
        }).join('\n'));

        return {
            asset: output,
        };
    }
}
