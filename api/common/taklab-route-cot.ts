import { createHash } from 'node:crypto';
import type CoT from '@tak-ps/node-cot';
import type { RoutePlan } from '../stateless/lib/routing/taklab.js';

export const ROUTE_PLAN_ELEMENT = '__taklab_route';
export const MAX_PLAN_BYTES = 16384;

/**
 * Odcisk geometrii: SHA-256 (hex, małe litery) z `lon,lat` do 6 miejsc
 * dla każdego wierzchołka, połączonych średnikiem. Ta sama definicja jest w bocie Pythona.
 */
export function routeFingerprint(coordinates: number[][]): string {
    const text = coordinates.map(c => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(';');
    return createHash('sha256').update(text).digest('hex');
}

/**
 * Czy plan pasuje do linii o podanej liczbie wierzchołków.
 * Kopia z taklab.ts (gałąź v13.109.0); API nie może importować z app/.
 * Ta sama logika jest w Pythonie: taklab.routeplan.geometry.valid_plan.
 */
function validPlan(plan: unknown, vertexCount: number): plan is RoutePlan {
    if (!plan || typeof plan !== 'object') return false;
    const p = plan as Partial<RoutePlan>;
    if (p.version !== 1 || typeof p.mode !== 'string' || !Array.isArray(p.waypoints) || !Array.isArray(p.legs)) return false;
    if (p.waypoints.length < 2 || p.legs.length !== p.waypoints.length - 1) return false;
    if (!p.waypoints.every(w => Array.isArray(w) && w.length >= 2 && w.every(n => typeof n === 'number' && Number.isFinite(n)))) return false;

    let previousEnd = -1;
    for (const leg of p.legs) {
        if (!leg || !Number.isInteger(leg.start) || !Number.isInteger(leg.end)) return false;
        if (leg.start > leg.end) return false;
        // pierwszy od zera, kolejne zaczynają się na końcu poprzedniego albo tuż za nim
        if (previousEnd === -1 ? leg.start !== 0 : (leg.start !== previousEnd && leg.start !== previousEnd + 1)) return false;
        previousEnd = leg.end;
    }

    return previousEnd === vertexCount - 1;
}

/** Dopisuje plan trasy do `<detail>`; zwraca true, gdy dopisał. */
export function attachRoutePlan(
    cot: CoT,
    feature: { geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> },
): boolean {
    if (feature.properties.type !== 'b-m-r' || feature.geometry.type !== 'LineString') return false;

    const coordinates = feature.geometry.coordinates as number[][];
    const metadata = feature.properties.metadata as Record<string, unknown> | undefined;
    const plan = metadata?.taklab_route;
    if (!validPlan(plan, coordinates.length)) return false;

    // Analiza terenu jest duża i liczona na nowo, więc nie jedzie w CoT
    const copy: Record<string, unknown> = { ...plan };
    delete copy.analysis;
    const json = JSON.stringify(copy);

    const escaped = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (Buffer.byteLength(escaped) > MAX_PLAN_BYTES) {
        console.warn(`taklab-route-cot: plan trasy ponad ${MAX_PLAN_BYTES} B, pomijam`);
        return false;
    }

    const detail = cot.raw.event.detail as Record<string, unknown>;
    detail[ROUTE_PLAN_ELEMENT] = { _attributes: { v: '1', fp: routeFingerprint(coordinates) }, _text: json };
    return true;
}

/** Odczytuje plan z `<detail>`; null, gdy brak, zła wersja, zły JSON, inna geometria albo plan nie pasuje. */
export function readRoutePlan(cot: CoT, coordinates: number[][]): Record<string, unknown> | null {
    const detail = cot.raw.event.detail as Record<string, { _attributes?: Record<string, string>; _text?: string }> | undefined;
    const element = detail?.[ROUTE_PLAN_ELEMENT];
    if (!element || typeof element !== 'object') return null;
    if (element._attributes?.v !== '1') return null;
    if (element._attributes?.fp !== routeFingerprint(coordinates)) return null;

    let plan: unknown;
    try {
        plan = JSON.parse(String(element._text));
    } catch {
        return null;
    }

    return validPlan(plan, coordinates.length) ? plan as unknown as Record<string, unknown> : null;
}

/** Zastępuje `<marti>` jednym elementem z `<dest uid>` dla każdego uid, bez duplikatów. */
export function setMartiDestinations(cot: CoT, uids: string[]): void {
    const unique = [...new Set(uids)];
    const detail = cot.raw.event.detail as Record<string, unknown>;
    detail.marti = { dest: unique.map(uid => ({ _attributes: { uid } })) };
}
