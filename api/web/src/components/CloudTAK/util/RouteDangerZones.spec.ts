import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import RouteDangerZones from './RouteDangerZones.vue';
import type { RouteOptions } from '../../../base/route-plan.ts';

function mountToggle(modelValue?: RouteOptions) {
    return mount(RouteDangerZones, { props: { modelValue } });
}

const input = (wrapper: ReturnType<typeof mountToggle>) => wrapper.find('.avoid-danger-zones input');

describe('RouteDangerZones', () => {
    it('domyślnie omija strefy', () => {
        expect((input(mountToggle()).element as HTMLInputElement).checked).toBe(true);
    });

    it('plan z ignore_danger_zones pokazuje wyłączony przełącznik', () => {
        expect((input(mountToggle({ ignore_danger_zones: true })).element as HTMLInputElement).checked).toBe(false);
    });

    it('wyłączenie dopisuje opcję do pozostałych, włączenie ją zdejmuje', async () => {
        const wrapper = mountToggle({ avoid_wetland: true });
        await input(wrapper).setValue(false);
        expect(wrapper.emitted('update:modelValue')!.at(-1)![0]).toEqual({ avoid_wetland: true, ignore_danger_zones: true });

        const only = mountToggle({ ignore_danger_zones: true });
        await input(only).setValue(true);
        expect(only.emitted('update:modelValue')!.at(-1)![0]).toBeUndefined();
    });
});
