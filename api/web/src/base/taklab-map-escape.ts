/**
 * Escaping of the map snapshot JSON for the <taklab_map> CoT text node
 *
 * Keep identical to api/lib/taklab-map.ts - the server measures and sends
 * exactly this form, and api/test/taklab-map.test.ts checks both give the same output.
 */

// XML markup and the characters outside XML 1.0 that JSON.stringify leaves as
// they are (C0 controls are always escaped by JSON.stringify; lone surrogates
// too, listed to be safe)
const XML_UNSAFE_JSON = /[&<>\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * JSON with XML markup and characters outside XML 1.0 written as \u escapes,
 * so the text node needs no XML escaping and parses back to the same value.
 */
export function xmlSafeJSON(value: unknown): string {
    return JSON.stringify(value).replace(XML_UNSAFE_JSON, (char) => {
        return '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0');
    });
}
