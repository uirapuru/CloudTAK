import test from 'node:test';
import assert from 'node:assert';
import { parseStops } from '../stateless/lib/routing/stops.js';

function status(code: number) {
    return (err: { status: number }) => err.status === code;
}

test('parseStops: start i cel', () => {
    assert.deepEqual(parseStops('21,52', '21.1,52.1'), [[21, 52], [21.1, 52.1]]);
});

test('parseStops: punkty pośrednie po średniku, w kolejności', () => {
    assert.deepEqual(parseStops('21,52', '21.3,52.3', '21.1,52.1;21.2,52.2'),
        [[21, 52], [21.1, 52.1], [21.2, 52.2], [21.3, 52.3]]);
});

test('parseStops: puste via = bez punktów pośrednich', () => {
    assert.deepEqual(parseStops('21,52', '21.1,52.1', ''), [[21, 52], [21.1, 52.1]]);
});

test('parseStops: zły format = 400', () => {
    assert.throws(() => parseStops('abc', '21,52'), status(400));
    assert.throws(() => parseStops('21,52', '21.1,52.1', '21;52'), status(400));
    assert.throws(() => parseStops('21,52,3,4', '21.1,52.1'), status(400));
});

test('parseStops: współrzędne poza zakresem = 400', () => {
    assert.throws(() => parseStops('200,10', '21,52'), status(400));
    assert.throws(() => parseStops('21,95', '21,52'), status(400));
});

test('parseStops: więcej niż 25 punktów pośrednich = 400', () => {
    const via = Array.from({ length: 26 }, (_, i) => `21.${i},52`).join(';');
    assert.throws(() => parseStops('21,52', '22,53', via), status(400));
    assert.equal(parseStops('21,52', '22,53', via.split(';').slice(0, 25).join(';')).length, 27);
});
