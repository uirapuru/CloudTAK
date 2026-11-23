import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../../i18n.ts';
import GenericChat from './GenericChat.vue';

// The composer (v14) needs Pinia; the tests only need its input, slot and 'send'
const MessageComposer = defineComponent({
    emits: ['send'],
    setup(_props, { emit, slots, expose }) {
        const text = ref('');
        expose({ reset: () => { text.value = ''; } });
        return () => h('div', [
            slots.default?.(),
            h('input', {
                value: text.value,
                onInput: (ev: Event) => { text.value = (ev.target as HTMLInputElement).value; },
                onKeyup: (ev: KeyboardEvent) => { if (ev.key === 'Enter' || ev.keyCode === 13) emit('send', text.value); },
            }),
        ]);
    },
});

const NOTICE = 'Mapa zostanie dołączona do wiadomości';

function chat(props: Record<string, unknown> = {}) {
    return mount(GenericChat, {
        props: {
            chats: [],
            myUID: 'ANDROID-CloudTAK-kaszub',
            canSend: true,
            ...props,
        },
        global: {
            directives: { tooltip: () => {} },
            stubs: { MessageComposer },
        },
    });
}

function attachButton(wrapper: ReturnType<typeof chat>) {
    return wrapper.find('[aria-pressed]');
}

async function send(wrapper: ReturnType<typeof chat>, text: string) {
    await wrapper.find('input').setValue(text);
    await wrapper.find('input').trigger('keyup', { key: 'Enter' });
}

describe('GenericChat attach map', () => {
    beforeEach(() => { i18n.global.locale.value = 'pl' });
    afterEach(() => { i18n.global.locale.value = 'en' });

    it('hides the attach button unless enabled', () => {
        expect(attachButton(chat()).exists()).toBe(false);
        expect(attachButton(chat({ canAttachMap: true })).exists()).toBe(true);
    });

    it('defaults to attached with a notice, and can be toggled off', async () => {
        const wrapper = chat({ canAttachMap: true });
        expect(wrapper.text()).toContain(NOTICE);
        expect(attachButton(wrapper).attributes('aria-pressed')).toBe('true');

        await attachButton(wrapper).trigger('click');
        expect(wrapper.text()).not.toContain(NOTICE);
        expect(attachButton(wrapper).attributes('aria-pressed')).toBe('false');

        await attachButton(wrapper).trigger('click');
        expect(wrapper.text()).toContain(NOTICE);
    });

    it('sends attached by default, and resets to attached after a one-off toggle-off', async () => {
        const wrapper = chat({ canAttachMap: true });

        // Default is ON: sending without touching the button attaches the map.
        await send(wrapper, 'co widzę na mapie?');

        // Turn it off for a single message.
        await attachButton(wrapper).trigger('click');
        expect(wrapper.text()).not.toContain(NOTICE);
        await send(wrapper, 'bez mapy tym razem');

        // It comes back ON for the next message automatically.
        expect(wrapper.text()).toContain(NOTICE);
        await send(wrapper, 'a teraz?');

        expect(wrapper.emitted('send')).toEqual([
            ['co widzę na mapie?', true],
            ['bez mapy tym razem', false],
            ['a teraz?', true],
        ]);
    });

    it('shows the attach error', () => {
        expect(chat({ canAttachMap: true, attachError: 'Nie udało się dołączyć mapy' }).text())
            .toContain('Nie udało się dołączyć mapy');
    });
});
