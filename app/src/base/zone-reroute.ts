/**
 * Przeliczanie tras po przesunięciu strefy niebezpiecznej: trasy taklab z planem,
 * które przecinają strefę w nowym miejscu i nie mają wyłączonego omijania
 * (ignore_danger_zones), są liczone od nowa przez te same punkty usera, w tym
 * samym trybie i z tymi samymi opcjami. Nazwa, styl i id trasy zostają.
 */
import { readRoutePlan } from './route-plan.ts';
import type { LngLat, RouteOptions } from './route-plan.ts';

export type RouteFeature = {
    id: string;
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry: { type: string; coordinates: number[][] };
};

export type RerouteDeps = {
    /** POST /api/search/route/plan z zagrożeniami z mapy; zwraca pierwszą trasę */
    plan(body: { travelMode: string; waypoints: LngLat[]; options?: RouteOptions }): Promise<RouteFeature>;
    save(feature: RouteFeature): Promise<void>;
};

export type RerouteResult = {
    rerouted: string[];
    failed: Array<{ name: string; error: string }>;
};

type Point = [number, number];

function inside(p: Point, ring: Point[]): boolean {
    let result = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) result = !result;
    }
    return result;
}

function cross(o: Point, a: Point, b: Point): number {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Linia ma wierzchołek w zewnętrznym pierścieniu wielokąta albo przecina jego krawędź. */
export function lineCrossesPolygon(line: number[][], rings: number[][][]): boolean {
    const ring = (rings[0] ?? []).map((p) => [p[0], p[1]] as Point);
    if (ring.length < 4) return false;
    const points = line.map((p) => [p[0], p[1]] as Point);
    if (points.some((p) => inside(p, ring))) return true;
    for (let i = 1; i < points.length; i++) {
        for (let j = 1; j < ring.length; j++) {
            if (segmentsIntersect(points[i - 1], points[i], ring[j - 1], ring[j])) return true;
        }
    }
    return false;
}

export function routesToReroute(routes: RouteFeature[], rings: number[][][]): RouteFeature[] {
    return routes.filter((route) => {
        if (route.geometry?.type !== 'LineString') return false;
        const plan = readRoutePlan(route);
        if (!plan || plan.options?.ignore_danger_zones) return false;
        return lineCrossesPolygon(route.geometry.coordinates, rings);
    });
}

export async function rerouteRoutes(routes: RouteFeature[], deps: RerouteDeps): Promise<RerouteResult> {
    const result: RerouteResult = { rerouted: [], failed: [] };

    for (const route of routes) {
        const plan = readRoutePlan(route);
        if (!plan) continue;
        const name = String(route.properties.callsign ?? route.id);

        try {
            const fresh = await deps.plan({
                travelMode: plan.mode,
                waypoints: plan.waypoints.map((w) => [w[0], w[1]] as LngLat),
                ...(plan.options ? { options: plan.options } : {}),
            });
            const freshPlan = readRoutePlan(fresh);
            if (!freshPlan) throw new Error('Usługa tras zwróciła trasę bez planu.');

            const properties: Record<string, unknown> = {
                ...route.properties,
                remarks: fresh.properties.remarks,
                metadata: { ...((route.properties.metadata as Record<string, unknown>) ?? {}), taklab_route: freshPlan },
            };
            // Środek liczy baza mapy z nowej geometrii
            delete properties.center;

            await deps.save({ ...route, properties, geometry: structuredClone(fresh.geometry) });
            result.rerouted.push(name);
        } catch (err) {
            result.failed.push({ name, error: err instanceof Error ? err.message : String(err) });
        }
    }

    return result;
}
