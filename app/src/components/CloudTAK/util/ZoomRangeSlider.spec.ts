import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ZoomRangeSlider from './ZoomRangeSlider.vue';

function mountSlider(props: Record<string, unknown> = {}) {
    return mount(ZoomRangeSlider, {
        props: {
            modelValue: [10, 16],
            min: 0,
            max: 18,
            ...props,
        },
    });
}

function last(wrapper: ReturnType<typeof mountSlider>): [number, number] | undefined {
    const events = wrapper.emitted('update:modelValue') as Array<[[number, number]]> | undefined;
    return events?.at(-1)?.[0];
}

describe('ZoomRangeSlider', () => {
    it('shows the selected range as a label', () => {
        const wrapper = mountSlider();
        expect(wrapper.text()).toContain('10–16');
    });

    it('has two range inputs with the layer bounds and a step of one', () => {
        const inputs = mountSlider().findAll('input[type="range"]');
        expect(inputs).toHaveLength(2);
        for (const input of inputs) {
            expect(input.attributes('min')).toBe('0');
            expect(input.attributes('max')).toBe('18');
            expect(input.attributes('step')).toBe('1');
        }
        expect(inputs[0].attributes('aria-label')).toBeTruthy();
        expect(inputs[1].attributes('aria-label')).toBeTruthy();
        expect(inputs[0].attributes('aria-label')).not.toBe(inputs[1].attributes('aria-label'));
    });

    it('moving the lower handle above the upper one pins both to the upper', async () => {
        const wrapper = mountSlider();
        await wrapper.findAll('input[type="range"]')[0].setValue('17');
        expect(last(wrapper)).toEqual([16, 16]);
    });

    it('moving the upper handle below the lower one pins both to the lower', async () => {
        const wrapper = mountSlider();
        await wrapper.findAll('input[type="range"]')[1].setValue('5');
        expect(last(wrapper)).toEqual([10, 10]);
    });

    it('moves the upper handle within the range', async () => {
        const wrapper = mountSlider();
        await wrapper.findAll('input[type="range"]')[1].setValue('17');
        expect(last(wrapper)).toEqual([10, 17]);
    });

    it('clamps a model value outside of the bounds', () => {
        const wrapper = mountSlider({ modelValue: [-3, 30] });
        const inputs = wrapper.findAll('input[type="range"]');
        expect((inputs[0].element as HTMLInputElement).value).toBe('0');
        expect((inputs[1].element as HTMLInputElement).value).toBe('18');
        expect(wrapper.text()).toContain('0–18');
    });

    it('arrow right on the upper handle raises it by one', async () => {
        const wrapper = mountSlider();
        await wrapper.findAll('input[type="range"]')[1].trigger('keydown', { key: 'ArrowRight' });
        expect(last(wrapper)).toEqual([10, 17]);
    });

    it('disabled blocks both handles', () => {
        const inputs = mountSlider({ disabled: true }).findAll('input[type="range"]');
        expect(inputs[0].attributes('disabled')).toBeDefined();
        expect(inputs[1].attributes('disabled')).toBeDefined();
    });
});
