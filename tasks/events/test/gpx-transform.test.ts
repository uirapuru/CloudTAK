import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import GPX from '../src/transforms/gpx.js';
import type { Message, LocalMessage } from '../src/types.js';

const fixtures = fileURLToPath(new URL('./fixtures/togeojson/', import.meta.url));

async function convert(tmpdir: string, fixture: string): Promise<Array<{ geometry: { type: string } }>> {
    const id = path.basename(fixture, '.gpx');
    const raw = path.join(tmpdir, `${id}.gpx`);
    await fs.promises.copyFile(path.join(fixtures, fixture), raw);

    const transform = new GPX({} as Message, {
        tmpdir,
        name: fixture,
        ext: '.gpx',
        id,
        raw,
    } as LocalMessage);

    const result = await transform.convert();
    const content = await fs.promises.readFile(result.asset, 'utf8');
    return content.trim().split('\n').map(line => JSON.parse(line));
}

test('GPX Transform', async (t) => {
    const tmpdir = await fs.promises.mkdtemp('/tmp/gpx-test-');

    await t.test('Registers the .gpx extension', () => {
        assert.deepStrictEqual(GPX.register().inputs, ['.gpx']);
    });

    await t.test('Converts a track to a line', async () => {
        const features = await convert(tmpdir, 'run.gpx');
        assert.ok(features.length >= 1);
        assert.ok(['LineString', 'MultiLineString'].includes(features[0].geometry.type));
    });

    await t.test('Converts waypoints to points', async () => {
        const features = await convert(tmpdir, 'wpt.gpx');
        assert.ok(features.length >= 1);
        assert.ok(features.every(f => f.geometry.type === 'Point'));
    });

    await t.test('Rejects a file without tracks, routes or waypoints', async () => {
        await assert.rejects(() => convert(tmpdir, 'empty_trk.gpx'), /no tracks, routes or waypoints/);
    });

    await fs.promises.rm(tmpdir, { recursive: true, force: true });
});
