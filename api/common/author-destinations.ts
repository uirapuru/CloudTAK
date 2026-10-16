import type Config from './config.js';
import TAKServerControl, { profileUid } from './control/takserver.js';

export type Endpoint = { uid: string; username: string };
export type RawApi = {
    url: URL;
    fetch(url: URL, opts: object, raw: boolean): Promise<{ status: number; text(): Promise<string>; json(): Promise<unknown> }>;
};
export type FetchEndpoints = (username: string, config: Config) => Promise<Endpoint[]>;

/** Domyślne pobranie: GET /Marti/api/clientEndPoints jako autor, czyta `data[]` */
export async function defaultFetchEndpoints(
    username: string,
    config: Config,
    // wstrzykiwane w testach; domyślnie klient TAK jako autor
    getApi: () => Promise<RawApi> = async () => await new TAKServerControl(config).asUser(username),
): Promise<Endpoint[]> {
    const api = await getApi();
    // raw=true zwraca obiekt {status, text, json} z APIAuthCertificate, bez pola `ok`
    const res = await api.fetch(new URL('/Marti/api/clientEndPoints', api.url), { method: 'GET' }, true);
    if (res.status < 200 || res.status >= 300) {
        await res.text().catch(() => '');
        throw new Error(`clientEndPoints: status ${res.status}`);
    }

    const body = await res.json() as { data?: Array<{ uid?: unknown; username?: unknown }> };
    return (body.data || [])
        .filter(e => typeof e.uid === 'string' && typeof e.username === 'string')
        .map(e => ({ uid: e.uid as string, username: e.username as string }));
}

/** Podmieniane w testach */
export const deps: { fetchEndpoints: FetchEndpoints } = { fetchEndpoints: defaultFetchEndpoints };

/**
 * UID urządzeń autora (bez połączenia CloudTAK). Pusta lista albo błąd
 * pobrania dają samo połączenie CloudTAK, żeby wysyłka nigdy nie poszła do grup.
 */
export async function authorDestinations(
    config: Config,
    username: string,
    fetchEndpoints?: (username: string) => Promise<Endpoint[]>,
): Promise<string[]> {
    const own = profileUid(username);

    try {
        const endpoints = await (fetchEndpoints ? fetchEndpoints(username) : deps.fetchEndpoints(username, config));
        const uids = endpoints
            .filter(e => e.username === username && e.uid !== own)
            .map(e => e.uid);
        return uids.length ? [...new Set(uids)] : [own];
    } catch (err) {
        console.warn('Warning: could not list author devices, sending to the CloudTAK connection only', err);
        return [own];
    }
}
