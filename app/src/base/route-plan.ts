/**
 * Plan trasy taklab: punkty usera i granice odcinków zapisane w
 * properties.metadata.taklab_route przez dostawcę tras `taklab` (API CloudTAK,
 * stateless/lib/routing/taklab.ts). Ten moduł nie zna mapy ani sieci.
 */
import nearestPointOnLine from '@turf/nearest-point-on-line';
import { distance } from '@turf/distance';
import { lineString, point } from '@turf/helpers';

export type LngLat = [number, number];

export type RouteLeg = {
    start: number;
    end: number;
    distance_m: number;
    duration_s: number;
    ascent_m?: number;
    descent_m?: number;
    offpath_ratio?: number;
    steps?: string[];
};

/** Opcje trasy (API: RouteOptions w stateless/lib/routing/taklab.ts). */
export type RouteOptions = {
    avoid_wetland?: boolean;
    avoid_streams?: boolean;
    max_slope_deg?: number;
    exposure?: 'allow' | 'medium' | 'avoid';
    avoid_observation?: boolean;
    /** Wszystkie tryby: nie omijaj stref niebezpiecznych z mapy (domyślnie omijane). */
    ignore_danger_zones?: boolean;
};

/** Zagrożenia z mapy dla liczenia trasy (API: threats w POST /api/search/route/plan i /legs). */
export type RouteThreats = {
    observers?: Array<[number, number]>;
    closed_areas?: Array<Array<[number, number]>>;
};

/** Analiza trasy z API (stateless/lib/routing/taklab.ts): osłona, widoczność ze wzgórz, zagrożenia. */
export type RouteAnalysis = {
    cover?: { concealed: number; exposed: number; unknown: number };
    observed_ratio?: number;
    danger?: Array<{ kind: string; from_m: number; to_m: number }>;
};

export type RoutePlan = {
    version: 1;
    mode: string;
    mode_name: string;
    waypoints: LngLat[];
    legs: RouteLeg[];
    options?: RouteOptions;
    analysis?: RouteAnalysis;
};

/**
 * Zmiana listy punktów usera: odcinki first..first+count-1 starego planu
 * zastępuje count+added nowych (zgodnie z POST /api/search/route/legs).
 */
export type LegChange = {
    waypoints: LngLat[];
    first: number;
    count: number;
    added: -1 | 0 | 1;
};

type FeatureLike = {
    properties: Record<string, unknown>;
    geometry?: { type: string; coordinates?: unknown };
};

/** Ta sama reguła co validPlan w API: plan pasuje do linii o vertexCount wierzchołkach. */
export function validPlan(plan: unknown, vertexCount: number): plan is RoutePlan {
    if (!plan || typeof plan !== 'object') return false;
    const p = plan as Partial<RoutePlan>;
    if (p.version !== 1 || typeof p.mode !== 'string' || !Array.isArray(p.waypoints) || !Array.isArray(p.legs)) return false;
    if (p.waypoints.length < 2 || p.legs.length !== p.waypoints.length - 1) return false;
    if (!p.waypoints.every((w) => Array.isArray(w) && w.length >= 2 && w.every((n) => typeof n === 'number' && Number.isFinite(n)))) return false;

    let previousEnd = -1;
    for (const leg of p.legs) {
        if (!leg || !Number.isInteger(leg.start) || !Number.isInteger(leg.end) || leg.start > leg.end) return false;
        if (previousEnd === -1 ? leg.start !== 0 : (leg.start !== previousEnd && leg.start !== previousEnd + 1)) return false;
        previousEnd = leg.end;
    }

    return previousEnd === vertexCount - 1;
}

/** Plan trasy obiektu albo null, gdy go nie ma albo nie pasuje do linii. */
export function readRoutePlan(feature: FeatureLike): RoutePlan | null {
    if (!feature.geometry || feature.geometry.type !== 'LineString' || !Array.isArray(feature.geometry.coordinates)) return null;

    const metadata = feature.properties.metadata;
    if (!metadata || typeof metadata !== 'object') return null;

    const plan = (metadata as Record<string, unknown>).taklab_route;
    return validPlan(plan, feature.geometry.coordinates.length) ? plan : null;
}

/**
 * Najbliższy punkt trasy: odcinek (między dwoma punktami usera) o najmniejszej
 * odległości od `target`, rzut na linię tego odcinka i najbliższy rzutowi wierzchołek.
 * Przy remisie (wspólny wierzchołek graniczny) wygrywa wcześniejszy odcinek.
 */
export function nearestOnRoute(
    plan: RoutePlan,
    coordinates: number[][],
    target: LngLat,
): { leg: number; position: LngLat; vertex: number; distance_m: number } {
    let best: { leg: number; position: LngLat; vertex: number; distance_m: number } | null = null;

    plan.legs.forEach((leg, i) => {
        const slice = coordinates.slice(leg.start, leg.end + 1).map((c) => [c[0], c[1]]);

        let candidate: { leg: number; position: LngLat; vertex: number; distance_m: number };
        if (slice.length < 2) {
            candidate = {
                leg: i,
                position: [slice[0][0], slice[0][1]],
                vertex: leg.start,
                distance_m: distance(target, slice[0], { units: 'meters' }),
            };
        } else {
            const hit = nearestPointOnLine(lineString(slice), point(target), { units: 'meters' });
            const position: LngLat = [hit.geometry.coordinates[0], hit.geometry.coordinates[1]];
            const segment = hit.properties.index ?? 0;
            const a = slice[segment];
            const b = slice[Math.min(segment + 1, slice.length - 1)];
            const closer = distance(position, a) <= distance(position, b) ? segment : Math.min(segment + 1, slice.length - 1);
            candidate = { leg: i, position, vertex: leg.start + closer, distance_m: hit.properties.dist ?? 0 };
        }

        if (!best || candidate.distance_m < best.distance_m) best = candidate;
    });

    if (!best) throw new Error('Route plan has no legs');
    return best;
}

function copyWaypoints(plan: RoutePlan): LngLat[] {
    return plan.waypoints.map((w) => [w[0], w[1]] as LngLat);
}

/** Przesunięcie punktu usera: przeliczane są odcinki, które się na nim kończą lub zaczynają. */
export function moveChange(plan: RoutePlan, index: number, position: LngLat): LegChange {
    const waypoints = copyWaypoints(plan);
    waypoints[index] = [position[0], position[1]];
    const last = waypoints.length - 1;

    if (index === 0) return { waypoints, first: 0, count: 1, added: 0 };
    if (index === last) return { waypoints, first: last - 1, count: 1, added: 0 };
    return { waypoints, first: index - 1, count: 2, added: 0 };
}

/** Wstawienie punktu usera do odcinka `leg`: odcinek dzieli się na dwa. */
export function insertChange(plan: RoutePlan, leg: number, position: LngLat): LegChange {
    const waypoints = copyWaypoints(plan);
    waypoints.splice(leg + 1, 0, [position[0], position[1]]);
    return { waypoints, first: leg, count: 1, added: 1 };
}

/** Dopisanie punktu na koniec: nowy cel, nowy odcinek od dotychczasowego celu. */
export function appendChange(plan: RoutePlan, position: LngLat): LegChange {
    const waypoints = copyWaypoints(plan);
    waypoints.push([position[0], position[1]]);
    return { waypoints, first: plan.legs.length, count: 0, added: 1 };
}

/** Usunięcie punktu usera; null, gdy zostałby jeden punkt. */
export function removeChange(plan: RoutePlan, index: number): LegChange | null {
    if (plan.waypoints.length <= 2) return null;

    const waypoints = copyWaypoints(plan);
    waypoints.splice(index, 1);
    const last = plan.waypoints.length - 1;

    if (index === 0) return { waypoints, first: 0, count: 1, added: -1 };
    if (index === last) return { waypoints, first: last - 1, count: 1, added: -1 };
    return { waypoints, first: index - 1, count: 2, added: -1 };
}

/** Etykieta markera jak na mapa-turystyczna.pl: A (start), 1, 2, … (pośrednie), B (cel). */
export function waypointLabel(index: number, count: number): string {
    if (index === 0) return 'A';
    if (index === count - 1) return 'B';
    return String(index);
}
