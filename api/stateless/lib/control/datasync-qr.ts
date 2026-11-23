import Err from '@openaddresses/batch-error';

/**
 * QR code that subscribes ATAK to a Data Sync feed.
 *
 * Format read by the ATAK Data Sync plugin 5.0.1 (atakplugin.datasync.j0):
 * the text is split on ",", the feed is looked up by field 0 (connect string
 * "host:port:proto" of the server the phone already knows) and field 2 (the
 * mission name); field 1 is not used. Upstream CloudTAK builds field 0 from
 * config.server.url, which in taklab is the in-cluster pod address, so the
 * phone never matched it. We use the public host and CoT port of the
 * environment (OTS_ACCOUNTS_HOST, OTS_ACCOUNTS_COT_PORT), the same values as
 * the ATAK enrollment code.
 */
export function dataSyncQr(host: string, cotPort: number, name: string): string {
    if (!name) throw new Err(400, null, 'Brak nazwy misji');
    if (name.includes(',')) {
        throw new Err(409, null, 'Nazwa misji zawiera przecinek, a ATAK dzieli kod QR po przecinkach. Zmień nazwę misji');
    }
    return `${host}:${cotPort}:ssl,${host}-ssl-${name},${name}`;
}

/** The string, or null when the environment does not say its public host and CoT port. */
export function dataSyncQrFromEnv(name: string): string | null {
    const host = (process.env.OTS_ACCOUNTS_HOST || '').trim();
    const port = Number((process.env.OTS_ACCOUNTS_COT_PORT || '').trim());
    if (!host || !Number.isInteger(port) || port <= 0 || port >= 65536) return null;
    return dataSyncQr(host, port, name);
}
