import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import i18n from '../../i18n.ts';
import JournalNotice from './JournalNotice.vue';
import { journalNoticeState } from '../../base/journal-notice.ts';

const std = vi.fn();

vi.mock('../../std.ts', () => ({
    std: (...args: unknown[]) => std(...args),
}));

// The real TablerModal teleports to body; a plain slot keeps the content in the wrapper.
vi.mock('@tak-ps/vue-tabler', () => ({
    TablerModal: defineComponent({ setup: (_, { slots }) => () => h('div', { class: 'modal' }, slots.default?.()) }),
}));

function mountNotice() {
    return mount(JournalNotice, { global: { plugins: [i18n] } });
}

beforeEach(() => {
    std.mockReset();
    i18n.global.locale.value = 'pl';
});

describe('journalNoticeState', () => {
    it('shows only when the server says show with a version', async () => {
        std.mockResolvedValueOnce({ show: true, version: '2026-11-25' });
        expect(await journalNoticeState()).toEqual({ show: true, version: '2026-11-25' });
        expect(std).toHaveBeenCalledWith('/api/journal/notice');

        for (const answer of [{ show: false, version: '2026-11-25' }, { show: true }, null, 'x']) {
            std.mockResolvedValueOnce(answer);
            expect(await journalNoticeState()).toBeNull();
        }
    });

    it('a failed request shows nothing now', async () => {
        std.mockRejectedValueOnce(new Error('502'));
        expect(await journalNoticeState()).toBeNull();
    });
});

describe('JournalNotice', () => {
    it('shows the notice and sends the acknowledged version', async () => {
        std.mockResolvedValueOnce({ show: true, version: '2026-11-25' });
        std.mockResolvedValueOnce({ show: false, version: '2026-11-25' });
        const wrapper = mountNotice();
        await flushPromises();

        expect(wrapper.find('[data-test="journal-notice-title"]').text()).toBe('Ten serwer prowadzi dziennik zdarzeń');
        expect(wrapper.text()).toContain('również prywatne');
        expect(wrapper.text()).toContain('rolą administratora');

        await wrapper.find('[data-test="journal-notice-confirm"]').trigger('click');
        await flushPromises();

        expect(std).toHaveBeenLastCalledWith('/api/journal/notice', { method: 'PUT', body: { version: '2026-11-25' } });
        expect(wrapper.find('.modal').exists()).toBe(false);
    });

    it('stays hidden when the account already read it', async () => {
        std.mockResolvedValueOnce({ show: false, version: '2026-11-25' });
        const wrapper = mountNotice();
        await flushPromises();
        expect(wrapper.find('.modal').exists()).toBe(false);
    });

    it('a failed save says so, and the second click closes', async () => {
        std.mockResolvedValueOnce({ show: true, version: '2026-11-25' });
        std.mockRejectedValueOnce(new Error('500'));
        const wrapper = mountNotice();
        await flushPromises();

        await wrapper.find('[data-test="journal-notice-confirm"]').trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain('Nie udało się zapisać potwierdzenia');

        await wrapper.find('[data-test="journal-notice-confirm"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('.modal').exists()).toBe(false);
        expect(std).toHaveBeenCalledTimes(2);
    });

    it('has the English text', async () => {
        i18n.global.locale.value = 'en';
        std.mockResolvedValueOnce({ show: true, version: '2026-11-25' });
        const wrapper = mountNotice();
        await flushPromises();
        expect(wrapper.find('[data-test="journal-notice-title"]').text()).toBe('This server keeps an event journal');
    });
});
