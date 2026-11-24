import test from 'node:test';
import assert from 'node:assert';
import {
    tileRange,
    countTiles,
    validateBounds,
    isGoogleUrl,
    estimateBytes,
    safeFileName,
    newToken,
    tileExtension,
} from '../common/area-package.js';

test('tileRange - whole world at zoom 0 is a single tile', () => {
    assert.deepEqual(tileRange([0, 0, 1, 1], 0), { minX: 0, maxX: 0, minY: 0, maxY: 0 });
});

test('tileRange - small area around Warsaw at zoom 10', () => {
    assert.deepEqual(tileRange([20.9, 52.1, 21.1, 52.3], 10), { minX: 571, maxX: 572, minY: 336, maxY: 337 });
});

test('countTiles - single zoom level', () => {
    assert.equal(countTiles([20.9, 52.1, 21.1, 52.3], 10, 10), 4);
});

test('countTiles - sums every zoom level in the range', () => {
    const b: [number, number, number, number] = [20.9, 52.1, 21.1, 52.3];
    const sum = countTiles(b, 10, 10) + countTiles(b, 11, 11) + countTiles(b, 12, 12);
    assert.equal(countTiles(b, 10, 12), sum);
    assert.ok(countTiles(b, 12, 12) > countTiles(b, 11, 11));
});

test('tileRange - clamps latitude to the Web Mercator limit', () => {
    assert.equal(tileRange([-10, -89, 10, 89], 2).maxY, 3);
    assert.equal(tileRange([-10, -89, 10, 89], 2).minY, 0);
});

test('tileRange - east edge at 180 stays inside the grid', () => {
    assert.equal(tileRange([170, 0, 180, 10], 3).maxX, 7);
});

test('validateBounds - rejects an antimeridian crossing', () => {
    assert.throws(() => validateBounds([170, 0, -170, 10]), (err: { status: number }) => err.status === 400);
});

test('validateBounds - rejects an empty rectangle', () => {
    assert.throws(() => validateBounds([0, 0, 0, 1]), (err: { status: number }) => err.status === 400);
});

test('validateBounds - rejects out of range coordinates', () => {
    assert.throws(() => validateBounds([0, -91, 1, 1]), (err: { status: number }) => err.status === 400);
    assert.throws(() => validateBounds([0, 0, 181, 1]), (err: { status: number }) => err.status === 400);
});

test('validateBounds - accepts a normal rectangle', () => {
    assert.doesNotThrow(() => validateBounds([20.9, 52.1, 21.1, 52.3]));
});

test('isGoogleUrl - matches Google tile hosts', () => {
    assert.equal(isGoogleUrl('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'), true);
    assert.equal(isGoogleUrl('https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}'), true);
    assert.equal(isGoogleUrl('https://khms0.gstatic.com/kh/v=1'), true);
    assert.equal(isGoogleUrl('https://google.com/x'), true);
});

test('isGoogleUrl - does not match other hosts', () => {
    assert.equal(isGoogleUrl('https://tile.openstreetmap.de/{z}/{x}/{y}.png'), false);
    assert.equal(isGoogleUrl('https://notgoogle.com.evil.pl/{z}/{x}/{y}'), false);
    assert.equal(isGoogleUrl('https://evilgoogle.com/{z}/{x}/{y}'), false);
    assert.equal(isGoogleUrl('not a url'), false);
});

test('estimateBytes - uses the average tile size of the format', () => {
    assert.equal(estimateBytes(10, 'png'), 150000);
    assert.equal(estimateBytes(10, 'jpeg'), 250000);
    assert.equal(estimateBytes(10, 'webp'), 120000);
});

test('safeFileName - strips path and quote characters but keeps Polish letters', () => {
    const name = safeFileName('../Wyjście "A"/23');
    assert.ok(!name.includes('/'));
    assert.ok(!name.includes('..'));
    assert.ok(!name.includes('"'));
    assert.ok(name.includes('Wyjście'));
});

test('safeFileName - empty result falls back to a default', () => {
    assert.equal(safeFileName('///'), 'paczka');
    assert.equal(safeFileName(''), 'paczka');
});

test('safeFileName - truncates to 100 characters', () => {
    assert.equal(safeFileName('a'.repeat(300)).length, 100);
});

test('newToken - 32 random bytes in base64url', () => {
    const a = newToken();
    const b = newToken();
    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(a, b);
});

test('tileExtension - keeps the tile server extension and maps it to the MBTiles format', () => {
    assert.deepEqual(tileExtension('https://t/tiles/profile/u/f/tiles/{z}/{x}/{y}.jpg?token=x'), { ext: 'jpg', format: 'jpeg' });
    assert.deepEqual(tileExtension('https://t/tiles/profile/u/f/tiles/{z}/{x}/{y}.png'), { ext: 'png', format: 'png' });
    assert.deepEqual(tileExtension('https://t/tiles/profile/u/f/tiles/{z}/{x}/{y}.webp'), { ext: 'webp', format: 'webp' });
});

test('tileExtension - formats ATAK and MBTiles cannot carry are unsupported', () => {
    assert.equal(tileExtension('https://t/x/{z}/{x}/{y}.avif'), null);
    assert.equal(tileExtension('https://t/x/{z}/{x}/{y}.mvt'), null);
    assert.equal(tileExtension('https://t/x/{z}/{x}/{y}'), null);
});
