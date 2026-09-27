import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import GenericChat from './GenericChat.vue';

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
        },
    });
}

function attachButton(wrapper: ReturnType<typeof chat>) {
    return wrapper.find('[aria-pressed]');
}

async function send(wrapper: ReturnType<typeof chat>, text: string) {
    await wrapper.find('input').setValue(text);
    await wrapper.find('input').trigger('keyup.enter');
}

describe('GenericChat attach map', () => {
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
