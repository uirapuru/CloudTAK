import { fetch } from '@tak-ps/node-safeurl';
import Err from '@openaddresses/batch-error';

export const ELEVATION_TIMEOUT = 5000;

/**
 * Wysokość punktu w metrach z usługi terenu taklab (POST /elevation).
 * null = usługa nie ma danych dla punktu; wyjątek = błąd usługi, timeout albo zła odpowiedź.
 */
export async function taklabElevation(
    terrainUrl: string,
    lon: number,
    lat: number,
    timeout = ELEVATION_TIMEOUT,
): Promise<number | null> {
    const base = terrainUrl.replace(/\/+$/, '');

    const res = await fetch(new URL(base + '/elevation'), {
        method: 'POST',
        safeUrlAllow: [base],
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ points: [[lon, lat]] }),
        signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) throw new Err(502, null, `Terrain service returned ${res.status}`);

    let body: unknown;
    try {
        body = await res.json();
    } catch {
        throw new Err(502, null, 'Terrain service returned invalid JSON');
    }

    const elevations = (body as { elevations?: unknown } | null)?.elevations;
    if (!Array.isArray(elevations) || elevations.length !== 1) {
        throw new Err(502, null, 'Terrain service returned an unexpected body');
    }

    const value = elevations[0];
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Err(502, null, 'Terrain service returned a non-numeric elevation');
    }

    return value;
}

/**
 * Z usługą terenu: jej wartość (null = brak danych, bez cofania się do klienta).
 * Bez ustawienia albo przy błędzie usługi: wartość od klienta, w metrach bez przewyższenia.
 */
export async function resolveElevation(
    terrainUrl: string,
    lon: number,
    lat: number,
    clientElevation: number | undefined,
    timeout = ELEVATION_TIMEOUT,
): Promise<number | null> {
    if (terrainUrl) {
        try {
            return await taklabElevation(terrainUrl, lon, lat, timeout);
        } catch (err) {
            console.error('Terrain elevation error, using client value', err);
        }
    }

    return clientElevation === undefined ? null : clientElevation;
}

export function formatElevation(metres: number | null, unit: string): string | null {
    if (metres === null) return null;
    return unit === 'feet' || unit === 'FEET'
        ? (metres * 3.28084).toFixed(2) + ' ft'
        : metres.toFixed(2) + ' m';
}
