/**
 * Przesuwanie figur przytrzymaniem na mapie (base/shape-move.ts) i przeliczanie tras
 * po przesunięciu strefy niebezpiecznej (base/zone-reroute.ts), podpięte pod sklep mapy.
 */
import type * as mapgl from 'maplibre-gl';
import ShapeMover from '../../base/shape-move.ts';
import type { MovableFeature } from '../../base/shape-move.ts';
import { collectThreats } from '../../base/route-threats.ts';
import type { ThreatSource } from '../../base/route-threats.ts';
import { routesNearZones, rerouteRoutes } from '../../base/zone-reroute.ts';
import type { RouteFeature, RerouteResult } from '../../base/zone-reroute.ts';
import OverlayManager from '../../base/overlay.ts';
import Subscription from '../../base/subscription.ts';
import TAKNotification from '../../base/notification.ts';
import { NotificationType } from '../../database.ts';
import { OriginMode } from '../../base/cot.ts';
import type COT from '../../base/cot.ts';
import { DrawToolMode } from './draw.ts';
import { std } from '../../std.ts';
import router from '../../router.ts';
import type { Feature } from '../../types.ts';

const ROUTE_FILTER = 'properties.type = "b-m-r" and geometry.type = "LineString"';

type Db = {
    get(id: string, opts?: { mission?: boolean }): Promise<COT | undefined>;
    filter(expression: string, opts?: { mission?: boolean }): Promise<Iterable<COT>>;
    add(feature: Feature, opts?: { authored?: boolean }): Promise<unknown>;
};

type Store = {
    worker: { db: Db };
    draw: { mode: string; editing: unknown };
    radial: { mode?: unknown; cot?: unknown };
    refresh(): Promise<void>;
    loadMission(guid: string): Promise<unknown>;
};

let mover: ShapeMover | null = null;

/** Czy figurę wolno zmieniać: jak w CoTView (misja wymaga MISSION_WRITE). */
async function canEdit(cot: COT): Promise<boolean> {
    if (!cot.is_editable || cot.is_self) return false;
    if (cot.origin.mode !== OriginMode.MISSION || !cot.origin.mode_id) return true;
    const sub = await Subscription.from(cot.origin.mode_id);
    return !!sub?.role?.permissions.includes('MISSION_WRITE');
}

async function save(store: Store, cot: COT | undefined, feature: Feature): Promise<void> {
    const properties = feature.properties as Record<string, unknown>;
    // Środek (także koła) baza mapy liczy z nowej geometrii
    delete properties.center;
    await store.worker.db.add(feature, { authored: true });
    await store.refresh();
    if (cot && cot.origin.mode === OriginMode.MISSION && cot.origin.mode_id) {
        await store.loadMission(cot.origin.mode_id);
    }
}

async function rerouteNear(store: Store, zones: number[][][][]): Promise<RerouteResult> {
    const db = store.worker.db;
    const routes: RouteFeature[] = [];
    const cots = new Map<string, COT>();
    for (const cot of await db.filter(ROUTE_FILTER, { mission: true })) {
        if (!await canEdit(cot)) continue;
        cots.set(cot.id, cot);
        routes.push(cot.as_feature({ clone: true }) as unknown as RouteFeature);
    }

    return await rerouteRoutes(routesNearZones(routes, zones), {
        plan: async (body) => {
            const fc = await std('/api/search/route/plan', {
                method: 'POST',
                body: {
                    provider: 'taklab',
                    ...body,
                    threats: await collectThreats(db as unknown as ThreatSource, body.waypoints),
                },
            }) as { features: RouteFeature[] };
            if (!fc.features?.length) throw new Error('Usługa tras nie zwróciła trasy.');
            return fc.features[0];
        },
        save: async (route) => {
            await save(store, cots.get(route.id), route as unknown as Feature);
        },
    });
}

async function report(result: RerouteResult): Promise<void> {
    if (!result.rerouted.length && !result.failed.length) return;
    const lines = [
        ...(result.rerouted.length ? [`Przeliczone: ${result.rerouted.join(', ')}.`] : []),
        ...result.failed.map((f) => `Nie udało się przeliczyć „${f.name}”: ${f.error}`),
    ];
    await TAKNotification.create(NotificationType.Alert, 'Strefa zmieniona: trasy', lines.join('\n'), '', true);
}

export function attachShapeMover(store: Store, map: mapgl.Map): ShapeMover {
    mover?.destroy();

    mover = new ShapeMover(map as never, {
        enabled: () => store.draw.mode === DrawToolMode.STATIC && !store.draw.editing,
        pick: async (point) => {
            const clickMap = OverlayManager.clickableLayerMap();
            const ids = new Set(map.queryRenderedFeatures([point.x, point.y])
                .filter((feat) => clickMap.has(feat.layer.id))
                .map((feat) => String(feat.properties.id || feat.id)));
            // Pierwsza figura pod punktem, którą wolno przesunąć (trasa nad strefą jej nie zasłania)
            for (const id of ids) {
                const cot = await store.worker.db.get(id, { mission: true });
                if (cot && cot.geometry.type === 'Polygon' && await canEdit(cot)) {
                    return cot.as_feature({ clone: true }) as unknown as MovableFeature;
                }
            }
            return null;
        },
        onStart: (feature) => {
            // Na telefonie przytrzymanie (ok. 0,5 s) najpierw otwiera menu radialne
            store.radial.mode = undefined;
            store.radial.cot = undefined;
            // Widok przesuwanej figury: otwiera się albo przełącza z innego obiektu
            if (router.currentRoute.value.path !== `/cot/${feature.id}`) {
                router.push(`/cot/${feature.id}`).catch((err) => console.error('Failed to open feature view', err));
            }
        },
        commit: async (id, feature) => {
            try {
                const cot = await store.worker.db.get(id, { mission: true });
                // Przeliczenie tras przy strefie odpala baza mapy (Danger_Zone_Changed)
                await save(store, cot, feature as unknown as Feature);
            } catch (err) {
                console.error('Failed to move feature', err);
            }
        },
    });

    return mover;
}

type ZoneGeometry = { type: 'Polygon'; coordinates: number[][][] } | null;

// Kilka zmian jednej strefy w krótkim odstępie (np. kolejne poprawki kształtu)
// daje jedno przeliczenie: najstarsze położenie przed zmianą i najnowsze po niej
const ZONE_SETTLE_MS = 800;
const pendingZones = new Map<string, { before: ZoneGeometry; after: ZoneGeometry; timer: ReturnType<typeof setTimeout> }>();
let rerouting: Promise<void> = Promise.resolve();

/** Komunikat Danger_Zone_Changed z bazy mapy: przelicza trasy w pobliżu strefy. */
export function onDangerZoneChanged(store: Store, body: { id: string; before: ZoneGeometry; after: ZoneGeometry }): void {
    const pending = pendingZones.get(body.id);
    if (pending) clearTimeout(pending.timer);
    const entry = {
        before: pending ? pending.before : body.before,
        after: body.after,
        timer: setTimeout(() => {
            pendingZones.delete(body.id);
            const zones = [entry.before, entry.after].filter((g): g is NonNullable<ZoneGeometry> => !!g).map((g) => g.coordinates);
            // Po kolei, żeby dwie strefy nie przeliczały tej samej trasy naraz
            rerouting = rerouting
                .then(async () => await report(await rerouteNear(store, zones)))
                .catch((err) => console.error('Failed to reroute near danger zone', err));
        }, ZONE_SETTLE_MS),
    };
    pendingZones.set(body.id, entry);
}

/** true raz, dla kliknięcia wysłanego przez przeglądarkę po upuszczeniu figury */
export function consumeShapeMoveClick(): boolean {
    return mover?.consumeClick() ?? false;
}
