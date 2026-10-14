import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import RouteCrossCountryOptions from './RouteCrossCountryOptions.vue';
import type { RouteOptions } from '../../../base/route-plan.ts';

function mountOptions(modelValue?: RouteOptions, disabled = false) {
    return mount(RouteCrossCountryOptions, { props: { modelValue, disabled } });
}

function lastEmitted(wrapper: ReturnType<typeof mountOptions>): RouteOptions | undefined {
    const events = wrapper.emitted('update:modelValue') ?? [];
    return events[events.length - 1]?.[0] as RouteOptions | undefined;
}

describe('RouteCrossCountryOptions', () => {
    it('bez opcji wszystko wyłączone i bez limitu nachylenia', () => {
        const wrapper = mountOptions();
        for (const name of ['avoid-wetland', 'avoid-streams', 'avoid-observation']) {
            expect((wrapper.find(`.${name} input`).element as HTMLInputElement).checked).toBe(false);
        }
        expect((wrapper.find('.max-slope select').element as HTMLSelectElement).value).toBe('bez limitu (35°)');
        expect((wrapper.find('.exposure select').element as HTMLSelectElement).value).toBe('może być');
    });

    it('pokazuje opcje zapisane w planie trasy', () => {
        const wrapper = mountOptions({ avoid_wetland: true, max_slope_deg: 20, exposure: 'avoid', avoid_observation: true });
        expect((wrapper.find('.avoid-wetland input').element as HTMLInputElement).checked).toBe(true);
        expect((wrapper.find('.avoid-observation input').element as HTMLInputElement).checked).toBe(true);
        expect((wrapper.find('.max-slope select').element as HTMLSelectElement).value).toBe('20°');
        expect((wrapper.find('.exposure select').element as HTMLSelectElement).value).toBe('unikaj');
    });

    it('limit nachylenia spoza listy też da się pokazać', () => {
        const wrapper = mountOptions({ max_slope_deg: 30 });
        expect((wrapper.find('.max-slope select').element as HTMLSelectElement).value).toBe('30°');
    });

    it('zmiana pola emituje znormalizowane opcje', async () => {
        const wrapper = mountOptions({ avoid_wetland: true });
        await wrapper.find('.avoid-streams input').setValue(true);
        expect(lastEmitted(wrapper)).toEqual({ avoid_wetland: true, avoid_streams: true });

        await wrapper.setProps({ modelValue: { avoid_wetland: true, avoid_streams: true } });
        await wrapper.find('.max-slope select').setValue('15°');
        expect(lastEmitted(wrapper)).toEqual({ avoid_wetland: true, avoid_streams: true, max_slope_deg: 15 });
    });

    it('powrót do wartości domyślnych daje undefined', async () => {
        const wrapper = mountOptions({ exposure: 'medium' });
        await wrapper.find('.exposure select').setValue('może być');
        expect(lastEmitted(wrapper)).toBeUndefined();
    });

    it('disabled blokuje pola', () => {
        const wrapper = mountOptions(undefined, true);
        expect(wrapper.find('.avoid-wetland input').attributes('disabled')).toBeDefined();
        expect(wrapper.find('.max-slope select').attributes('disabled')).toBeDefined();
    });
});
