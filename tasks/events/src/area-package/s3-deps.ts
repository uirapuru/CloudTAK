import fs from 'node:fs';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import s3client from '../s3.ts';
import { toPMTiles } from './mbtiles.ts';
import type { JobDeps } from './job.ts';

export function s3Deps(bucket: string): JobDeps {
    return {
        upload: async (key: string, file: string): Promise<void> => {
            const upload = new Upload({
                client: s3client(),
                params: {
                    Bucket: bucket,
                    Key: key,
                    Body: fs.createReadStream(file),
                },
            });
            await upload.done();
        },
        remove: async (key: string): Promise<void> => {
            await s3client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        },
        attachment: async (hash: string) => {
            const s3 = s3client();
            const list = await s3.send(new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: `attachment/${hash}/`,
                MaxKeys: 1,
            }));

            const key = list.Contents?.[0]?.Key;
            if (!key) return null;

            const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            if (!object.Body) return null;

            return {
                name: path.basename(key),
                body: Buffer.from(await object.Body.transformToByteArray()),
            };
        },
        toPMTiles,
    };
}
