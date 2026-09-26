import test from 'node:test';
import assert from 'node:assert';
import CoT, { CoTParser } from '@tak-ps/node-cot';
import { buildTaklabMapCoT, xmlSafeJSON, TAKLAB_MAP_MAX_BYTES } from '../stateful/lib/taklab-map.js';

const SENDER = 'ANDROID-CloudTAK-kaszub';
const NOW = new Date('2026-09-26T16:40:00.000Z');

type TestDetail = {
    link: { _attributes: Record<string, string> };
    marti: { dest: { _attributes: Record<string, string> } };
    taklab_map: { _attributes: Record<string, string>; _text: string };
};

function detailOf(cot: CoT): TestDetail {
    return cot.raw.event.detail as unknown as TestDetail;
}

function snapshot(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        v: 1,
        t: '2026-09-26T16:40:00Z',
        view: { lat: 51.1, lon: 17.03, scale_m: 2400, bearing: 0, tilt: 0, bbox: [16.98, 51.08, 17.08, 51.12] },
        items: [{ name: 'PK1', kind: 'marker', type: 'a-f-G', lat: 51.105, lon: 17.02, remarks: 'punkt kontrolny', dist_m: 640 }],
        outside: { marker: 12 },
        ...extra,
    };
}

test('taklab_map: builds a y-taklab-map event addressed to the recipient', () => {
    const cot = buildTaklabMapCoT(SENDER, { to_uid: 'ANDROID-hal9000', snapshot: snapshot() }, { now: NOW, id: 'abc' });
    const event = cot.raw.event;

    assert.equal(event._attributes.type, 'y-taklab-map');
    assert.equal(event._attributes.how, 'h-g-i-g-o');
    assert.equal(event._attributes.uid, `${SENDER}.taklab-map.abc`);
    assert.equal(event._attributes.time, '2026-09-26T16:40:00.000Z');
    assert.equal(event._attributes.start, '2026-09-26T16:40:00.000Z');
    assert.equal(event._attributes.stale, '2026-09-26T16:45:00.000Z');

    assert.deepEqual(event.point._attributes, { lat: '0', lon: '0', hae: '0', ce: '9999999', le: '9999999' });

    const detail = detailOf(cot);
    assert.deepEqual(detail.link, { _attributes: { uid: SENDER, relation: 'p-p', type: 'a-f-G' } });
    assert.deepEqual(detail.marti, { dest: { _attributes: { uid: 'ANDROID-hal9000' } } });
    assert.equal(detail.taklab_map._attributes.v, '1');
    assert.deepEqual(JSON.parse(detail.taklab_map._text), snapshot());
});

test('taklab_map: serialises the custom detail to XML', () => {
    const cot = buildTaklabMapCoT(SENDER, {
        to_uid: 'ANDROID-hal9000',
        snapshot: snapshot({ items: [{ name: 'A & B', remarks: '<b>&amp;</b>' }] }),
    }, { now: NOW, id: 'abc' });

    const xml = CoTParser.to_xml(cot);

    assert.match(xml, /<event [^>]*type="y-taklab-map"/);
    assert.match(xml, /<point lat="0" lon="0" hae="0" ce="9999999" le="9999999"\/>/);
    assert.match(xml, /<link uid="ANDROID-CloudTAK-kaszub" relation="p-p" type="a-f-G"\/>/);
    assert.match(xml, /<marti><dest uid="ANDROID-hal9000"\/><\/marti>/);

    const text = xml.match(/<taklab_map v="1">(.*)<\/taklab_map>/);
    assert.ok(text, 'taklab_map element present');
    // No XML-significant characters inside the element: the JSON escapes them itself.
    assert.doesNotMatch(text[1], /[<>&]/);
    assert.deepEqual(JSON.parse(text[1]).items[0], { name: 'A & B', remarks: '<b>&amp;</b>' });
});

test('taklab_map: sender UID comes from the connection, not from the payload', () => {
    const cot = buildTaklabMapCoT(SENDER, {
        to_uid: 'ANDROID-hal9000',
        uid: 'ANDROID-CloudTAK-victim',
        from: { uid: 'ANDROID-CloudTAK-victim' },
        snapshot: snapshot(),
    }, { now: NOW, id: 'abc' });

    const detail = detailOf(cot);
    assert.equal(detail.link._attributes.uid, SENDER);
    assert.ok(cot.raw.event._attributes.uid.startsWith(`${SENDER}.taklab-map.`));
});

test('taklab_map: random event UID by default', () => {
    const a = buildTaklabMapCoT(SENDER, { to_uid: 'X', snapshot: snapshot() });
    const b = buildTaklabMapCoT(SENDER, { to_uid: 'X', snapshot: snapshot() });
    assert.notEqual(a.raw.event._attributes.uid, b.raw.event._attributes.uid);
});

test('taklab_map: rejects a missing to_uid', () => {
    assert.throws(() => buildTaklabMapCoT(SENDER, { snapshot: snapshot() }), /to_uid/);
    assert.throws(() => buildTaklabMapCoT(SENDER, { to_uid: '', snapshot: snapshot() }), /to_uid/);
    assert.throws(() => buildTaklabMapCoT(SENDER, { to_uid: 42, snapshot: snapshot() }), /to_uid/);
});

test('taklab_map: rejects a to_uid longer than 128 characters', () => {
    assert.doesNotThrow(() => buildTaklabMapCoT(SENDER, { to_uid: 'a'.repeat(128), snapshot: snapshot() }));
    assert.throws(() => buildTaklabMapCoT(SENDER, { to_uid: 'a'.repeat(129), snapshot: snapshot() }), /to_uid/);
});

test('taklab_map: rejects a to_uid with XML-significant characters', () => {
    for (const bad of ['a"b', 'a<b', 'a>b', 'a&b', 'a\nb']) {
        assert.throws(() => buildTaklabMapCoT(SENDER, { to_uid: bad, snapshot: snapshot() }), /to_uid/);
    }
});

test('taklab_map: rejects a snapshot that is not an object', () => {
    for (const bad of [undefined, null, 'x', 5, [], [snapshot()]]) {
        assert.throws(() => buildTaklabMapCoT(SENDER, { to_uid: 'X', snapshot: bad }), /snapshot/);
    }
});

test('taklab_map: rejects data that is not an object', () => {
    assert.throws(() => buildTaklabMapCoT(SENDER, null), /to_uid/);
    assert.throws(() => buildTaklabMapCoT(SENDER, 'x'), /to_uid/);
});

function escapedBytes(value: unknown): number {
    return Buffer.byteLength(xmlSafeJSON(value), 'utf8');
}

// Snapshot whose escaped JSON is exactly `bytes` long, padded with `char`
function padded(bytes: number, char: string): Record<string, unknown> {
    const base = escapedBytes(snapshot({ pad: '' }));
    const per = escapedBytes(char) - 2; // without the quotes
    return snapshot({ pad: char.repeat(Math.floor((bytes - base) / per)) + 'x'.repeat((bytes - base) % per) });
}

test('taklab_map: the escaped JSON limit leaves 1 KB for the XML wrapper', () => {
    assert.equal(TAKLAB_MAP_MAX_BYTES, 32 * 1024 - 1024);
});

test('taklab_map: rejects escaped JSON over the limit', () => {
    const fits = padded(TAKLAB_MAP_MAX_BYTES, 'x');
    assert.equal(escapedBytes(fits), TAKLAB_MAP_MAX_BYTES);
    assert.doesNotThrow(() => buildTaklabMapCoT(SENDER, { to_uid: 'X', snapshot: fits }));

    const tooBig = padded(TAKLAB_MAP_MAX_BYTES + 1, 'x');
    assert.throws(() => buildTaklabMapCoT(SENDER, { to_uid: 'X', snapshot: tooBig }), /too large/);
});

test('taklab_map: measures the size after escaping', () => {
    // "&" is 1 byte raw but 6 bytes escaped: raw JSON fits easily, escaped does not
    const ampersands = snapshot({ items: [{ name: 'A', remarks: '&'.repeat(6000) }] });
    assert.ok(Buffer.byteLength(JSON.stringify(ampersands)) < TAKLAB_MAP_MAX_BYTES);
    assert.ok(escapedBytes(ampersands) > TAKLAB_MAP_MAX_BYTES);
    assert.throws(() => buildTaklabMapCoT(SENDER, { to_uid: 'X', snapshot: ampersands }), /too large/);

    const fits = padded(TAKLAB_MAP_MAX_BYTES, '&');
    assert.equal(escapedBytes(fits), TAKLAB_MAP_MAX_BYTES);
    assert.doesNotThrow(() => buildTaklabMapCoT(SENDER, { to_uid: 'X', snapshot: fits }));
});

test('taklab_map: counts the size in UTF-8 bytes', () => {
    // "ą" is two bytes in UTF-8
    const tooBig = padded(TAKLAB_MAP_MAX_BYTES + 2, 'ą');
    assert.ok(JSON.stringify(tooBig).length < TAKLAB_MAP_MAX_BYTES);
    assert.throws(() => buildTaklabMapCoT(SENDER, { to_uid: 'X', snapshot: tooBig }), /too large/);
});

test('taklab_map: the whole event stays under 32 KB', () => {
    const cot = buildTaklabMapCoT(SENDER, { to_uid: 'a'.repeat(128), snapshot: padded(TAKLAB_MAP_MAX_BYTES, '&') });
    assert.ok(Buffer.byteLength(CoTParser.to_xml(cot), 'utf8') <= 32 * 1024);
});

// XML 1.0 Char production without markup: #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
function isXmlText(text: string): boolean {
    for (const char of text) {
        const code = char.codePointAt(0) as number;
        if ('<>&'.includes(char)) return false;
        if (code === 0x9 || code === 0xA || code === 0xD) continue;
        if (code >= 0x20 && code <= 0xD7FF) continue;
        if (code >= 0xE000 && code <= 0xFFFD) continue;
        if (code >= 0x10000 && code <= 0x10FFFF) continue;
        return false;
    }
    return true;
}

test('taklab_map: escapes characters that are not valid in XML 1.0', () => {
    const tricky = '\uFFFE|\uFFFF|\uD800|\uDFFF|\uD83D\uDE00|\u0001|&<>';
    const text = xmlSafeJSON({ s: tricky });

    // Only XML 1.0 characters remain, and none of < > &
    assert.ok(isXmlText(text), text);
    assert.match(text, /\\ufffe/);
    assert.match(text, /\\uffff/);
    // A valid surrogate pair (emoji) passes through unchanged
    assert.ok(text.includes('\uD83D\uDE00'));
    assert.equal(JSON.parse(text).s, tricky);

    const xml = CoTParser.to_xml(buildTaklabMapCoT(SENDER, { to_uid: 'X', snapshot: snapshot({ s: tricky }) }));
    const inner = xml.match(/<taklab_map v="1">(.*)<\/taklab_map>/);
    assert.ok(inner && isXmlText(inner[1]));
});

test('taklab_map: rejects a to_uid with characters not valid in XML 1.0', () => {
    for (const bad of ['a\uFFFEb', 'a\uFFFFb', 'a\uD800b', 'a\uDC00b']) {
        assert.throws(() => buildTaklabMapCoT(SENDER, { to_uid: bad, snapshot: snapshot() }), /to_uid/);
    }
    assert.doesNotThrow(() => buildTaklabMapCoT(SENDER, { to_uid: 'ANDROID-\uD83D\uDE00', snapshot: snapshot() }));
});

test('taklab_map: rejects an unsafe sender UID from the connection', () => {
    for (const bad of ['a"b', 'a<b', 'a&b', 'a\nb', 'a\uFFFFb', '']) {
        assert.throws(() => buildTaklabMapCoT(bad, { to_uid: 'X', snapshot: snapshot() }), /sender/);
    }
});

test('taklab_map: browser and server escape the JSON identically', async () => {
    // Imported by path so the API type-check does not pull in the web sources
    const webModule = '../web/src/base/taklab-map-escape.ts';
    const web = await import(webModule) as { xmlSafeJSON: (value: unknown) => string };

    for (const value of [
        snapshot(),
        { s: '&<>"\'\\/' },
        { s: '\uFFFE\uFFFF\uD800\uDFFF\uD83D\uDE00\u0001\u2028' },
        { s: 'zażółć gęślą jaźń', n: [1.5, -0, 1e21], b: null },
    ]) {
        assert.equal(web.xmlSafeJSON(value), xmlSafeJSON(value));
    }
});

test('taklab_map: rejects a version other than 1', () => {
    for (const v of [undefined, 2, '1', 0]) {
        assert.throws(() => buildTaklabMapCoT(SENDER, { to_uid: 'X', snapshot: snapshot({ v }) }), /version/);
    }
});

test('taklab_map: websocket branch writes the event and persists nothing', async () => {
    const { EventEmitter } = await import('node:events');
    const { ConnectionWebSocket } = await import('../stateful/lib/connection-web.js');

    const ws = Object.assign(new EventEmitter(), {
        sent: [] as string[],
        send(msg: string) { this.sent.push(msg); },
        close() {},
    });
    const written: CoT[][] = [];
    const client = {
        // No models: touching the database would throw
        config: { uid: () => SENDER, config: {} },
        tak: { write: async (cots: never[]) => { written.push(cots); } },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new ConnectionWebSocket(ws as any, 'raw', undefined, client as any);

    const settle = () => new Promise(resolve => setImmediate(resolve));

    ws.emit('message', JSON.stringify({
        type: 'taklab_map',
        data: { to_uid: 'ANDROID-hal9000', from: { uid: 'ANDROID-CloudTAK-victim' }, snapshot: snapshot() },
    }));
    await settle();

    assert.equal(ws.sent.length, 0, ws.sent.join('\n'));
    assert.equal(written.length, 1);
    const event = written[0][0].raw.event;
    assert.equal(event._attributes.type, 'y-taklab-map');
    assert.equal(detailOf(written[0][0]).link._attributes.uid, SENDER);

    ws.emit('message', JSON.stringify({ type: 'taklab_map', data: { snapshot: snapshot() } }));
    await settle();

    assert.equal(written.length, 1, 'rejected snapshot is not sent');
    assert.equal(ws.sent.length, 1);
    assert.equal(JSON.parse(ws.sent[0]).type, 'Error');
    assert.match(JSON.parse(ws.sent[0]).properties.message, /to_uid/);
});
