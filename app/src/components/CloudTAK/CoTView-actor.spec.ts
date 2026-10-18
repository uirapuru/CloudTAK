import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();
vi.mock('../../base/contact.ts', () => ({ default: { from: (...args: unknown[]) => from(...args) } }));

import RouteActorNote from './util/RouteActorNote.vue';

const actor = { uid: 'ai_buddy', on_behalf: 'ANDROID-1', log: 'a1' };

describe('RouteActorNote', () => {
    beforeEach(() => from.mockReset());

    it('pokazuje znak kontaktu o uid równym on_behalf', async () => {
        from.mockResolvedValue({ uid: 'ANDROID-1', callsign: 'Wilk' });
        const wrapper = mount(RouteActorNote, { props: { actor } });
        await flushPromises();
        expect(wrapper.text()).toBe('Zmieniona przez ai-buddy na prośbę Wilk');
        expect(from).toHaveBeenCalledWith('ANDROID-1');
    });

    it('bez kontaktu pokazuje on_behalf', async () => {
        from.mockResolvedValue(undefined);
        const wrapper = mount(RouteActorNote, { props: { actor } });
        await flushPromises();
        expect(wrapper.text()).toBe('Zmieniona przez ai-buddy na prośbę ANDROID-1');
    });

    it('nie interpretuje HTML w znaku', async () => {
        from.mockResolvedValue({ uid: 'ANDROID-1', callsign: '<b>x</b>' });
        const wrapper = mount(RouteActorNote, { props: { actor } });
        await flushPromises();
        expect(wrapper.find('b').exists()).toBe(false);
        expect(wrapper.text()).toContain('<b>x</b>');
    });
});
