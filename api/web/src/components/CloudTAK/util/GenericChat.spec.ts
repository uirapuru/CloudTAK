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

    it('toggles the attached state with a notice', async () => {
        const wrapper = chat({ canAttachMap: true });
        expect(wrapper.text()).not.toContain(NOTICE);

        await attachButton(wrapper).trigger('click');
        expect(wrapper.text()).toContain(NOTICE);
        expect(attachButton(wrapper).attributes('aria-pressed')).toBe('true');

        await attachButton(wrapper).trigger('click');
        expect(wrapper.text()).not.toContain(NOTICE);
    });

    it('sends with the map attached once, then resets', async () => {
        const wrapper = chat({ canAttachMap: true });

        await attachButton(wrapper).trigger('click');
        await send(wrapper, 'co widzę na mapie?');
        expect(wrapper.text()).not.toContain(NOTICE);

        await send(wrapper, 'a teraz?');

        expect(wrapper.emitted('send')).toEqual([
            ['co widzę na mapie?', true],
            ['a teraz?', false],
        ]);
    });

    it('shows the attach error', () => {
        expect(chat({ canAttachMap: true, attachError: 'Nie udało się dołączyć mapy' }).text())
            .toContain('Nie udało się dołączyć mapy');
    });
});
