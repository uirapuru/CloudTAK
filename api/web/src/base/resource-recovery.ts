/**
 * Decide whether a failed resource load should trigger the service worker
 * cache recovery (evict + reload) in main.ts.
 *
 * Only our own http(s) assets live in the service worker cache. Recovering
 * on a cross-origin failure (e.g. a Cesium ion credit logo blocked by CSP or
 * down upstream) cannot help, and because the recovery guard is cleared on
 * every successful mount, it turns into an endless reload loop.
 */
export function isRecoverableResource(url: string, origin: string): boolean {
    if (!url) return false;

    let parsed: URL;
    try {
        parsed = new URL(url, origin);
    } catch {
        return false;
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;

    return parsed.origin === origin;
}
