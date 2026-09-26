import { randomUUID } from 'node:crypto';
import CoT from '@tak-ps/node-cot';

/**
 * Map snapshot ("Attach map" in a direct chat) sent to a chat bot as a
 * dedicated y-taklab-map CoT event with a <taklab_map v="1"> JSON detail.
 *
 * The event is built by hand instead of through CoTParser.from_geojson, which
 * strips every detail element that is not in the node-cot schema.
 */

export const TAKLAB_MAP_TYPE = 'y-taklab-map';
export const TAKLAB_MAP_VERSION = 1;
// Limit for the escaped JSON: the bot drops events over 32 KB and the rest of
// the event (attributes, point, link, dest, element tags) needs well under 1 KB
export const TAKLAB_MAP_MAX_BYTES = 32 * 1024 - 1024;
export const TAKLAB_MAP_MAX_UID = 128;
export const TAKLAB_MAP_STALE_MS = 5 * 60 * 1000;

// xml-js only escapes double quotes in attribute values, so UIDs with XML
// markup or characters outside XML 1.0 (U+FFFE, U+FFFF, lone surrogates) are refused
const UNSAFE_UID = /["'<>&\p{Cc}\uFFFE\uFFFF]|\p{Cs}/u;

// Characters written as \u escapes in the JSON text node: XML markup and the
// characters outside XML 1.0 that JSON.stringify leaves as they are (C0 controls
// are always escaped by JSON.stringify; lone surrogates too, listed to be safe)
const XML_UNSAFE_JSON = /[&<>\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * JSON with XML markup and characters outside XML 1.0 written as \u escapes,
 * so the text node needs no XML escaping and parses back to the same value.
 *
 * Keep identical to api/web/src/base/taklab-map-escape.ts (tested in test/taklab-map.test.ts)
 */
export function xmlSafeJSON(value: unknown): string {
    return JSON.stringify(value).replace(XML_UNSAFE_JSON, (char) => {
        return '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0');
    });
}

/**
 * Validate a taklab_map websocket message and build the CoT event for it
 *
 * @param senderUid UID of the authenticated connection - never taken from the payload
 * @param data      `data` of the websocket message: { to_uid, snapshot }
 *
 * @throws Error when the message is rejected - nothing should be sent then
 */
export function buildTaklabMapCoT(
    senderUid: string,
    data: unknown,
    opts: { now?: Date; id?: string } = {},
): CoT {
    if (!senderUid || UNSAFE_UID.test(senderUid)) {
        throw new Error('taklab_map: sender UID of the connection contains invalid characters');
    }

    const to_uid = isObject(data) ? data.to_uid : undefined;

    if (typeof to_uid !== 'string' || !to_uid.length) {
        throw new Error('taklab_map: to_uid is required');
    }
    else if (to_uid.length > TAKLAB_MAP_MAX_UID) {
        throw new Error(`taklab_map: to_uid is longer than ${TAKLAB_MAP_MAX_UID} characters`);
    }
    else if (UNSAFE_UID.test(to_uid)) {
        throw new Error('taklab_map: to_uid contains invalid characters');
    }

    const snapshot = isObject(data) ? data.snapshot : undefined;

    if (!isObject(snapshot)) {
        throw new Error('taklab_map: snapshot must be an object');
    }

    const json = xmlSafeJSON(snapshot);

    if (Buffer.byteLength(json, 'utf8') > TAKLAB_MAP_MAX_BYTES) {
        throw new Error(`taklab_map: snapshot is too large (over ${TAKLAB_MAP_MAX_BYTES} bytes of escaped JSON)`);
    }

    if (snapshot.v !== TAKLAB_MAP_VERSION) {
        throw new Error(`taklab_map: unsupported snapshot version, expected ${TAKLAB_MAP_VERSION}`);
    }

    const now = opts.now || new Date();

    return new CoT({
        event: {
            _attributes: {
                version: '2.0',
                uid: `${senderUid}.taklab-map.${opts.id || randomUUID()}`,
                type: TAKLAB_MAP_TYPE,
                how: 'h-g-i-g-o',
                time: now.toISOString(),
                start: now.toISOString(),
                stale: new Date(now.getTime() + TAKLAB_MAP_STALE_MS).toISOString(),
            },
            // The position travels in the JSON, not in the event point
            point: {
                _attributes: { lat: '0', lon: '0', hae: '0', ce: '9999999', le: '9999999' },
            },
            detail: {
                link: {
                    _attributes: { uid: senderUid, relation: 'p-p', type: 'a-f-G' },
                },
                marti: {
                    dest: { _attributes: { uid: to_uid } },
                },
                taklab_map: {
                    _attributes: { v: String(TAKLAB_MAP_VERSION) },
                    _text: json,
                },
            },
        },
    } as unknown as ConstructorParameters<typeof CoT>[0]);
}
