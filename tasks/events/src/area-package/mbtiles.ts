import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BBox } from './types.ts';

const execFileAsync = promisify(execFile);

const BATCH = 500;

/**
 * Minimal raster MBTiles 1.1 writer (TMS row order, as ATAK expects)
 */
export class MBTilesWriter {
    #db: DatabaseSync;
    #insert: StatementSync;
    #pending = 0;

    constructor(path: string, meta: {
        name: string;
        format: string;
        bounds: BBox;
        minzoom: number;
        maxzoom: number;
    }) {
        this.#db = new DatabaseSync(path);
        this.#db.exec(`
            CREATE TABLE metadata (name TEXT, value TEXT);
            CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
            CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
        `);

        const setMeta = this.#db.prepare('INSERT INTO metadata (name, value) VALUES (?, ?)');
        for (const [name, value] of Object.entries({
            name: meta.name,
            format: meta.format,
            bounds: meta.bounds.join(','),
            minzoom: String(meta.minzoom),
            maxzoom: String(meta.maxzoom),
            type: 'baselayer',
            version: '1.1',
        })) {
            setMeta.run(name, value);
        }

        this.#insert = this.#db.prepare('INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)');
        this.#db.exec('BEGIN');
    }

    put(z: number, x: number, y: number, data: Buffer): void {
        this.#insert.run(z, x, (2 ** z) - 1 - y, data);

        if (++this.#pending >= BATCH) {
            this.#db.exec('COMMIT');
            this.#db.exec('BEGIN');
            this.#pending = 0;
        }
    }

    close(): void {
        this.#db.exec('COMMIT');
        this.#db.close();
    }
}

export async function toPMTiles(mbtiles: string, out: string): Promise<void> {
    await execFileAsync('pmtiles', ['convert', mbtiles, out], { maxBuffer: 100 * 1024 * 1024 });
}
