import { describe, it, expect } from 'vitest';
import {
    angleDiff,
    bearing,
    destination,
    distance,
    conePolygon,
    coneTip,
    rankPhotos,
    panoramaWindow,
    needsRefetch,
    photoUrl,
    clampFov,
    type StreetPhoto,
    type Observer,
    type LngLat,
} from './street-photos.ts';

const ORIGIN: LngLat = [17.0268, 51.1104];

function photo(over: Partial<StreetPhoto> & { at: LngLat }): StreetPhoto {
    return {
        id: over.id ?? 'p',
        collection: 'c',
        lon: over.at[0],
        lat: over.at[1],
        azimuth: over.azimuth ?? null,
        panorama: over.panorama ?? false,
        fov: null,
        taken_at: null,
        author: null,
        license: null,
        provider: 'panoramax',
    };
}

function observer(azimuth: number, fov = 60): Observer {
    return { position: ORIGIN, azimuth, fov, range: 150 };
}

describe('geometry', () => {
    it('angleDiff wraps around north', () => {
        expect(angleDiff(350, 10)).toBe(20);
        expect(angleDiff(10, 350)).toBe(20);
        expect(angleDiff(0, 180)).toBe(180);
        expect(angleDiff(-90, 270)).toBe(0);
    });

    it('destination and back: distance and bearing agree', () => {
        for (const b of [0, 45, 133, 270, 359]) {
            const p = destination(ORIGIN, b, 100);
            expect(distance(ORIGIN, p)).toBeCloseTo(100, 3);
            expect(angleDiff(bearing(ORIGIN, p), b)).toBeLessThan(0.01);
        }
    });

    it('cone: closed ring, arc at range, tip on the azimuth', () => {
        const o = observer(90, 60);
        const ring = conePolygon(o, 6);
        expect(ring[0]).toEqual(ORIGIN);
        expect(ring[ring.length - 1]).toEqual(ORIGIN);
        expect(ring.length).toBe(6 + 1 + 2);
        for (const p of ring.slice(1, -1)) expect(distance(ORIGIN, p)).toBeCloseTo(150, 3);
        expect(angleDiff(bearing(ORIGIN, ring[1]), 60)).toBeLessThan(0.01);
        expect(angleDiff(bearing(ORIGIN, ring[ring.length - 2]), 120)).toBeLessThan(0.01);
        expect(angleDiff(bearing(ORIGIN, coneTip(o)), 90)).toBeLessThan(0.01);
    });

    it('clampFov keeps the cone sane', () => {
        expect(clampFov(1)).toBe(10);
        expect(clampFov(500)).toBe(120);
        expect(clampFov(Number.NaN)).toBe(60);
    });
});

describe('rankPhotos', () => {
    it('picks the flat photo looking where the cone looks', () => {
        const north = photo({ id: 'north', at: destination(ORIGIN, 180, 10), azimuth: 5 });
        const east = photo({ id: 'east', at: destination(ORIGIN, 180, 10), azimuth: 90 });
        expect(rankPhotos([north, east], observer(0)).map((r) => r.photo.id)).toEqual(['north']);
        expect(rankPhotos([north, east], observer(80)).map((r) => r.photo.id)).toEqual(['east', 'north']);
        expect(rankPhotos([north, east], observer(200)).map((r) => r.photo.id)).toEqual([]);
    });

    it('turning the cone across north keeps the match', () => {
        const p = photo({ id: 'n', at: ORIGIN, azimuth: 355 });
        expect(rankPhotos([p], observer(10))[0].offset).toBe(15);
    });

    it('leaves out far photos and flat photos without direction', () => {
        const far = photo({ id: 'far', at: destination(ORIGIN, 0, 500), azimuth: 0 });
        const blind = photo({ id: 'blind', at: ORIGIN, azimuth: null });
        expect(rankPhotos([far, blind], observer(0))).toEqual([]);
    });

    it('a panorama follows the cone in any direction', () => {
        const pano = photo({ id: 'pano', at: destination(ORIGIN, 0, 15), panorama: true, azimuth: 0 });
        for (const az of [0, 90, 200]) {
            const [r] = rankPhotos([pano], observer(az));
            expect(r.heading).toBe(az);
            expect(r.offset).toBe(0);
        }
    });

    it('prefers a nearer photo, and one along the view over one beside it', () => {
        const near = photo({ id: 'near', at: destination(ORIGIN, 180, 5), azimuth: 0 });
        const farther = photo({ id: 'farther', at: destination(ORIGIN, 180, 60), azimuth: 0 });
        expect(rankPhotos([farther, near], observer(0))[0].photo.id).toBe('near');

        const ahead = photo({ id: 'ahead', at: destination(ORIGIN, 0, 30), azimuth: 0 });
        const beside = photo({ id: 'beside', at: destination(ORIGIN, 90, 30), azimuth: 0 });
        expect(rankPhotos([beside, ahead], observer(0))[0].photo.id).toBe('ahead');
    });
});

describe('panoramaWindow', () => {
    it('centre of the image is the panorama azimuth', () => {
        expect(panoramaWindow(40, 40, 90)).toEqual({ centre: 0.5, width: 0.25 });
    });

    it('looking right of the azimuth moves the window right, wrapping', () => {
        expect(panoramaWindow(0, 90, 60).centre).toBeCloseTo(0.75);
        expect(panoramaWindow(0, 270, 60).centre).toBeCloseTo(0.25);
        expect(panoramaWindow(350, 10, 60).centre).toBeCloseTo(0.5 + 20 / 360);
    });
});

describe('helpers', () => {
    it('needsRefetch only after moving away', () => {
        expect(needsRefetch(null, ORIGIN)).toBe(true);
        expect(needsRefetch(ORIGIN, destination(ORIGIN, 0, 10))).toBe(false);
        expect(needsRefetch(ORIGIN, destination(ORIGIN, 0, 80))).toBe(true);
    });

    it('photoUrl escapes and adds the token', () => {
        expect(photoUrl({ collection: 'c', id: 'i' }, 'sd', 'a b')).toBe('/api/street-photos/c/i/sd?token=a%20b');
        expect(photoUrl({ collection: 'c', id: 'i' }, 'thumb', undefined)).toBe('/api/street-photos/c/i/thumb');
    });
});
