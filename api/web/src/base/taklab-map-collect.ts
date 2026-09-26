/**
 * Gather the current map state into a map snapshot ("Załącz mapę")
 */
import type { Remote } from 'comlink';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type Atlas from '../workers/atlas.ts';
import type Overlay from './overlay-class.ts';
import { LocationState } from '../utils/events.ts';
import { buildMapSnapshot } from './taklab-map-snapshot.ts';
import type { MapSnapshot, MapSnapshotSource } from './taklab-map-snapshot.ts';

export async function collectMapSnapshot(opts: {
    map: MapLibreMap;
    overlays: Array<Overlay>;
    worker: Remote<Atlas>;
    selfUid: string;
    callsign?: string;
    gpsCoordinates?: { lat: number; lng: number } | null;
}): Promise<MapSnapshot> {
    const { map, overlays, worker } = opts;

    const center = map.getCenter();
    const bounds = map.getBounds();

    const visible = overlays.filter((overlay) => overlay.visible);

    const basemap = visible.find((overlay) => overlay.mode === 'basemap');

    const layers = visible
        .filter((overlay) => !['basemap', 'internal'].includes(overlay.mode))
        .map((overlay) => overlay.name);

    const missions = visible
        .filter((overlay) => overlay.mode === 'mission' && overlay.mode_id)
        .map((overlay) => String(overlay.mode_id));

    let self: MapSnapshotSource['self'];

    const location = await worker.profile.location;
    if (
        location
        && [LocationState.Live, LocationState.Preset].includes(location.source)
        && location.coordinates.length >= 2
        && !(location.coordinates[0] === 0 && location.coordinates[1] === 0)
    ) {
        self = { lat: location.coordinates[1], lon: location.coordinates[0] };
    } else if (opts.gpsCoordinates) {
        self = { lat: opts.gpsCoordinates.lat, lon: opts.gpsCoordinates.lng };
    }

    if (self && opts.callsign) self.callsign = opts.callsign;

    return buildMapSnapshot({
        now: new Date(),
        selfUid: opts.selfUid,
        self,
        view: {
            lat: center.lat,
            lon: center.lng,
            bearing: map.getBearing(),
            tilt: map.getPitch(),
            bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        },
        basemap: basemap?.name,
        layers,
        features: await worker.db.snapshotFeatures(missions),
    });
}
