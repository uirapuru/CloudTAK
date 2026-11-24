import type { Feature, LineString } from 'geojson';
import type { Map as MapLibreMap } from 'maplibre-gl';

/** Temporary track of one recording ("Pokaż na mapie"), not stored anywhere. */
export const RECORDING_TRACK_SOURCE = 'taklab-recording-track';
export const RECORDING_TRACK_LAYER = 'taklab-recording-track-line';
export const RECORDING_START_LAYER = 'taklab-recording-track-start';

const COLOR = '#e8590c';

type TrackMap = Pick<MapLibreMap, 'addSource' | 'addLayer' | 'getSource' | 'getLayer' | 'removeLayer' | 'removeSource'>;

/** show() replaces the previous track; hide() is idempotent. */
export class RecordingTrack {
    shown: string | null = null;

    show(map: TrackMap, track: Feature<LineString>): void {
        this.hide(map);
        const start = track.geometry.coordinates[0];
        map.addSource(RECORDING_TRACK_SOURCE, {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: [
                    track,
                    { type: 'Feature', properties: { start: true }, geometry: { type: 'Point', coordinates: start } },
                ],
            },
        });
        map.addLayer({
            id: RECORDING_TRACK_LAYER,
            type: 'line',
            source: RECORDING_TRACK_SOURCE,
            filter: ['==', ['geometry-type'], 'LineString'],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': COLOR, 'line-width': 4, 'line-opacity': 0.85 },
        });
        map.addLayer({
            id: RECORDING_START_LAYER,
            type: 'circle',
            source: RECORDING_TRACK_SOURCE,
            filter: ['==', ['geometry-type'], 'Point'],
            paint: { 'circle-radius': 6, 'circle-color': COLOR, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
        });
        this.shown = String(track.properties?.recording ?? '');
    }

    hide(map: TrackMap): void {
        for (const id of [RECORDING_START_LAYER, RECORDING_TRACK_LAYER]) {
            if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(RECORDING_TRACK_SOURCE)) map.removeSource(RECORDING_TRACK_SOURCE);
        this.shown = null;
    }
}

export const recordingTrack = new RecordingTrack();
