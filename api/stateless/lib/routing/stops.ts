import Err from '@openaddresses/batch-error';
import { MAX_VIA_POINTS } from './taklab.js';

function parsePoint(value: string, label: string): [number, number] {
    const parts = value.split(',').map(part => part.trim());
    if (parts.length !== 2 || parts.some(part => part === '')) {
        throw new Err(400, null, `${label}: oczekiwano „lon,lat”.`);
    }

    const [lon, lat] = parts.map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        throw new Err(400, null, `${label}: współrzędne poza zakresem.`);
    }

    return [lon, lat];
}

/**
 * Punkty trasy z parametrów zapytania: start, punkty pośrednie (via, „lon,lat;lon,lat”) i cel.
 * Klient wysyła współrzędne w kolejności lon,lat.
 */
export function parseStops(start: string, end: string, via?: string): Array<[number, number]> {
    const middle = via ? via.split(';').filter(part => part.trim() !== '') : [];
    if (middle.length > MAX_VIA_POINTS) {
        throw new Err(400, null, `Najwyżej ${MAX_VIA_POINTS} punktów pośrednich.`);
    }

    return [
        parsePoint(start, 'Start'),
        ...middle.map((point, i) => parsePoint(point, `Punkt pośredni ${i + 1}`)),
        parsePoint(end, 'Cel'),
    ];
}
