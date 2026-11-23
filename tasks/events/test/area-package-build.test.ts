import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import CP from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { DataPackage } from '@tak-ps/node-cot';
import type { Feature, Geometry } from 'geojson';
import { MBTilesWriter, toPMTiles } from '../src/area-package/mbtiles.ts';
import { buildDataPackage } from '../src/area-package/build.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'area-package-build-'));

test.after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

// Smallest valid PNG (1x1, transparent)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function writeMBTiles(file: string): void {
    const writer = new MBTilesWriter(file, {
        name: 'OSM',
        format: 'png',
        bounds: [20.9, 52.1, 21.1, 52.3],
        minzoom: 1,
        maxzoom: 1,
    });
    writer.put(1, 0, 0, PNG);
    writer.put(1, 1, 0, PNG);
    writer.close();
}

test('MBTilesWriter - TMS rows and metadata', () => {
    const file = path.join(tmp, 'tms.mbtiles');
    writeMBTiles(file);

    const db = new DatabaseSync(file, { readOnly: true });
    try {
        const row = db.prepare('SELECT tile_row FROM tiles WHERE zoom_level = 1 AND tile_column = 0').get() as { tile_row: number };
        assert.equal(row.tile_row, 1);

        const meta = Object.fromEntries((db.prepare('SELECT name, value FROM metadata').all() as Array<{ name: string; value: string }>).map((r) => [r.name, r.value]));
        assert.equal(meta.bounds, '20.9,52.1,21.1,52.3');
        assert.equal(meta.type, 'baselayer');
        assert.equal(meta.format, 'png');
        assert.equal(meta.minzoom, '1');
        assert.equal(meta.maxzoom, '1');
        assert.equal(meta.name, 'OSM');

        const count = db.prepare('SELECT count(*) AS n FROM tiles').get() as { n: number };
        assert.equal(count.n, 2);
    } finally {
        db.close();
    }
});

test('MBTilesWriter - writing the same tile twice keeps one row', () => {
    const file = path.join(tmp, 'dupe.mbtiles');
    const writer = new MBTilesWriter(file, { name: 'x', format: 'png', bounds: [0, 0, 1, 1], minzoom: 0, maxzoom: 0 });
    writer.put(0, 0, 0, PNG);
    writer.put(0, 0, 0, PNG);
    writer.close();

    const db = new DatabaseSync(file, { readOnly: true });
    try {
        assert.equal((db.prepare('SELECT count(*) AS n FROM tiles').get() as { n: number }).n, 1);
    } finally {
        db.close();
    }
});

function feature(id: string, geometry: Geometry | null, extra: Record<string, unknown> = {}): Feature {
    return {
        id,
        type: 'Feature',
        properties: {
            id,
            type: geometry && geometry.type === 'Point' ? 'u-d-p' : 'u-d-f',
            how: 'h-g-i-g-o',
            callsign: id,
            time: '2026-11-23T18:00:00Z',
            start: '2026-11-23T18:00:00Z',
            stale: '2026-11-24T18:00:00Z',
            center: [21, 52.2],
            ...extra,
        },
        geometry: geometry as Geometry,
    };
}

test('buildDataPackage - MBTiles and CoT in a TAK data package', async () => {
    const mbtiles = path.join(tmp, 'pkg.mbtiles');
    writeMBTiles(mbtiles);

    const zip = await buildDataPackage({
        id: '6c4c4b5e-3c7a-4d7c-9e55-0b8f0e6f6a11',
        name: 'Wyjście 23 XI',
        mbtiles: [{ path: mbtiles, fileName: 'OSM.mbtiles' }],
        features: [
            feature('marker-1', { type: 'Point', coordinates: [21, 52.2] }),
            feature('line-1', { type: 'LineString', coordinates: [[21, 52.2], [21.05, 52.25]] }),
        ],
        attachments: async () => null,
    });

    const pkg = await DataPackage.parse(zip);

    const files = [...await pkg.files()];
    assert.ok(files.some((f) => f.endsWith('OSM.mbtiles')), JSON.stringify(files));

    const cots = await pkg.cots();
    assert.equal(cots.length, 2);

    const manifest = pkg.manifest();
    assert.ok(manifest.includes('Wyjście 23 XI'), manifest);
    assert.ok(manifest.includes('6c4c4b5e-3c7a-4d7c-9e55-0b8f0e6f6a11'), manifest);
});

test('buildDataPackage - a missing attachment does not stop the package', async () => {
    let asked = '';
    const zip = await buildDataPackage({
        id: '0b1c2d3e-0000-4000-8000-000000000001',
        name: 'att',
        mbtiles: [],
        features: [feature('marker-2', { type: 'Point', coordinates: [21, 52.2] }, { attachments: ['abc123'] })],
        attachments: async (hash) => {
            asked = hash;
            return null;
        },
    });

    assert.equal(asked, 'abc123');
    const pkg = await DataPackage.parse(zip);
    assert.equal((await pkg.cots()).length, 1);
});

test('buildDataPackage - an attachment that exists is linked to its CoT', async () => {
    const zip = await buildDataPackage({
        id: '0b1c2d3e-0000-4000-8000-000000000002',
        name: 'att2',
        mbtiles: [],
        features: [feature('marker-3', { type: 'Point', coordinates: [21, 52.2] }, { attachments: ['def456'] })],
        attachments: async () => ({ name: 'photo.jpg', body: Buffer.from('jpeg') }),
    });

    const pkg = await DataPackage.parse(zip);
    const attachments = await pkg.attachments();
    assert.equal(attachments.get('marker-3')?.length, 1);
});

test('buildDataPackage - a feature the CoT parser rejects is skipped', async () => {
    const zip = await buildDataPackage({
        id: '0b1c2d3e-0000-4000-8000-000000000003',
        name: 'bad',
        mbtiles: [],
        features: [
            feature('ok', { type: 'Point', coordinates: [21, 52.2] }),
            feature('broken', null),
        ],
        attachments: async () => null,
    });

    const pkg = await DataPackage.parse(zip);
    assert.equal((await pkg.cots()).length, 1);
});

let hasPMTiles = true;
try {
    CP.execSync('which pmtiles', { stdio: 'ignore' });
} catch {
    hasPMTiles = false;
}

test('toPMTiles - converts MBTiles to a PMTiles archive', { skip: !hasPMTiles && 'pmtiles CLI not installed' }, async () => {
    const mbtiles = path.join(tmp, 'convert.mbtiles');
    const out = path.join(tmp, 'convert.pmtiles');
    writeMBTiles(mbtiles);

    await toPMTiles(mbtiles, out);

    const head = fs.readFileSync(out).subarray(0, 7).toString();
    assert.equal(head, 'PMTiles');
});
