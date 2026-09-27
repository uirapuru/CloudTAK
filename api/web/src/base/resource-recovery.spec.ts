import { describe, expect, it } from 'vitest';
import { isRecoverableResource } from './resource-recovery.ts';

const ORIGIN = 'https://public-mapa.taklab.eu';

describe('isRecoverableResource', () => {
    it('accepts a same-origin asset', () => {
        expect(isRecoverableResource('https://public-mapa.taklab.eu/assets/map-abc.js', ORIGIN)).toBe(true);
    });

    it('accepts a relative asset URL', () => {
        expect(isRecoverableResource('/assets/map-abc.js', ORIGIN)).toBe(true);
    });

    it('ignores a cross-origin image such as a Cesium ion credit logo', () => {
        expect(isRecoverableResource('https://assets.ion.cesium.com/ion-credit.png', ORIGIN)).toBe(false);
    });

    it('ignores another subdomain of the same site', () => {
        expect(isRecoverableResource('https://public.taklab.eu/x.png', ORIGIN)).toBe(false);
    });

    it('ignores an empty URL', () => {
        expect(isRecoverableResource('', ORIGIN)).toBe(false);
    });

    it('ignores data and blob URLs', () => {
        expect(isRecoverableResource('data:image/png;base64,AAAA', ORIGIN)).toBe(false);
        expect(isRecoverableResource('blob:https://public-mapa.taklab.eu/1234', ORIGIN)).toBe(false);
    });
});
