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
export const TAKLAB_MAP_MAX_BYTES = 32 * 1024;
export const TAKLAB_MAP_MAX_UID = 128;
export const TAKLAB_MAP_STALE_MS = 5 * 60 * 1000;

// xml-js only escapes double quotes in attribute values
const UNSAFE_UID = /["'<>&\p{Cc}]/u;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * JSON with the XML-significant characters written as \u escapes, so the text
 * node needs no XML escaping and still parses back to the same value.
 */
function xmlSafeJSON(value: unknown): string {
    return JSON.stringify(value)
        .replace(/&/g, '\\u0026')
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e');
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

    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > TAKLAB_MAP_MAX_BYTES) {
        throw new Error('taklab_map: snapshot is larger than 32 KB');
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
                    _text: xmlSafeJSON(snapshot),
                },
            },
        },
    } as unknown as ConstructorParameters<typeof CoT>[0]);
}
