import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { LocationState } from '../../../utils/events.ts';

const GET = vi.fn();
const location = vi.fn();
const routeQuery: Record<string, string> = {};

vi.mock('../../../std.ts', () => ({
    server: { GET: (...args: unknown[]) => GET(...args) }
}));

vi.mock('../../../stores/map.ts', () => ({
    useMapStore: () => ({
        worker: {
            profile: { get location() { return location(); } },
            db: { add: async () => ({ id: 'route-1', flyTo: () => undefined }) }
        }
    })
}));

vi.mock('vue-router', async (importOriginal) => ({
    ...await importOriginal<typeof import('vue-router')>(),
    useRouter: () => ({ push: vi.fn() }),
    useRoute: () => ({ query: routeQuery })
}));

// Atrapa pola wyszukiwania: pokazuje initial-value w inpucie i pozwala wyemitować wybór
const SearchBoxStub = defineComponent({
    props: { label: { type: String, default: '' }, initialValue: { type: String, default: '' } },
    emits: ['select'],
    setup(props, { emit }) {
        // Jak prawdziwy SearchBox: wartość początkowa jest czytana tylko raz, przy montowaniu
        const value = props.initialValue;
        return () => h('div', { class: 'search-box', 'data-label': props.label }, [
            h('input', { value }),
            h('button', {
                class: 'pick',
                onClick: () => emit('select', { name: 'Cel', coordinates: [21, 52.4] })
            })
        ]);
    }
});

import MenuRoutesNew from './MenuRoutesNew.vue';

function mountMenu() {
    return mount(MenuRoutesNew, {
        global: {
            stubs: {
                SearchBox: SearchBoxStub,
                MenuTemplate: { template: '<div><slot /></div>' },
                TablerEnum: true
            }
        }
    });
}

function box(wrapper: ReturnType<typeof mountMenu>, label: string) {
    return wrapper.find(`.search-box[data-label="${label}"]`);
}

describe('CloudTAK/Menu/MenuRoutesNew', () => {
    beforeEach(() => {
        GET.mockImplementation(async (url: string) => {
            if (url === '/api/search') {
                return {
                    error: undefined,
                    data: {
                        route: {
                            enabled: true,
                            providers: [{ id: 'taklab', name: 'taklab', modes: [{ id: 'car', name: 'Samochód' }] }]
                        }
                    }
                };
            }
            return { error: undefined, data: { features: [{ type: 'Feature' }] } };
        });
    });

    afterEach(() => {
        GET.mockReset();
        location.mockReset();
        delete routeQuery.start;
    });

    it('fills the start with the known position and sends it to the route API', async () => {
        location.mockResolvedValue({ source: LocationState.Live, coordinates: [20.94, 52.29] });

        const wrapper = mountMenu();
        await flushPromises();

        expect(box(wrapper, 'Start Location').find('input').element.value).toBe('Moja pozycja');

        await box(wrapper, 'End Location').find('.pick').trigger('click');
        await wrapper.find('button.btn-primary').trigger('click');
        await flushPromises();

        const call = GET.mock.calls.find(c => c[0] === '/api/search/route');
        expect(call).toBeDefined();
        expect(call![1].params.query.start).toBe('20.94,52.29');
    });

    it('fills the start from a preset position', async () => {
        location.mockResolvedValue({ source: LocationState.Preset, coordinates: [19.5, 51.7] });

        const wrapper = mountMenu();
        await flushPromises();

        expect(box(wrapper, 'Start Location').find('input').element.value).toBe('Moja pozycja');
    });

    it('leaves the start empty when the location call rejects on open', async () => {
        location.mockRejectedValue(new Error('worker down'));

        const wrapper = mountMenu();
        await flushPromises();

        expect(box(wrapper, 'Start Location').find('input').element.value).toBe('');
        expect(wrapper.text()).not.toContain('Pozycja nieznana');
    });

    it('leaves the start empty without an error when the position is unknown on open', async () => {
        location.mockResolvedValue({ source: LocationState.Disabled, coordinates: [0, 0] });

        const wrapper = mountMenu();
        await flushPromises();

        expect(box(wrapper, 'Start Location').find('input').element.value).toBe('');
        expect(wrapper.text()).not.toContain('Pozycja nieznana');
    });

    it('shows a message when the button is clicked and the position is unknown', async () => {
        location.mockResolvedValue({ source: LocationState.Disabled, coordinates: [0, 0] });

        const wrapper = mountMenu();
        await flushPromises();

        await wrapper.find('button.my-location').trigger('click');
        await flushPromises();

        expect(wrapper.text()).toContain('Pozycja nieznana. Włącz GPS albo ustaw pozycję ręcznie na mapie.');
        expect(box(wrapper, 'Start Location').find('input').element.value).toBe('');
    });

    it('shows the message when the location call rejects on button click', async () => {
        location.mockResolvedValueOnce({ source: LocationState.Disabled, coordinates: [0, 0] });
        location.mockRejectedValueOnce(new Error('worker down'));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const wrapper = mountMenu();
        await flushPromises();

        await wrapper.find('button.my-location').trigger('click');
        await flushPromises();

        expect(wrapper.text()).toContain('Pozycja nieznana. Włącz GPS albo ustaw pozycję ręcznie na mapie.');
        spy.mockRestore();
    });

    it('resets the travel mode to the first mode of the newly selected provider', async () => {
        location.mockResolvedValue({ source: LocationState.Disabled, coordinates: [0, 0] });
        GET.mockImplementation(async (url: string) => {
            if (url === '/api/search') {
                return {
                    error: undefined,
                    data: {
                        route: {
                            enabled: true,
                            providers: [
                                { id: 'taklab', name: 'taklab', modes: [{ id: 'car', name: 'Samochód' }, { id: 'foot', name: 'Pieszo' }] },
                                { id: 'agol', name: 'ArcGIS Online', modes: [{ id: '1', name: 'Driving Time' }] },
                                { id: 'empty', name: 'Pusty', modes: [] }
                            ]
                        }
                    }
                };
            }
            return { error: undefined, data: { features: [{ type: 'Feature' }] } };
        });

        const wrapper = mountMenu();
        await flushPromises();

        // Prawdziwy TablerEnum renderuje <select>: pierwszy to dostawca, drugi tryb
        const selects = () => wrapper.findAll('select');
        const mode = () => selects()[1]?.element.value;

        expect(mode()).toBe('Samochód');

        await selects()[1].setValue('Pieszo');
        expect(mode()).toBe('Pieszo');

        await selects()[0].setValue('ArcGIS Online');
        await flushPromises();
        expect(mode()).toBe('Driving Time');

        await selects()[0].setValue('Pusty');
        await flushPromises();
        expect(selects()).toHaveLength(1);

        await selects()[0].setValue('taklab');
        await flushPromises();
        expect(mode()).toBe('Samochód');
    });

    it('does not overwrite a start given in the query', async () => {
        routeQuery.start = '21,52';
        location.mockResolvedValue({ source: LocationState.Live, coordinates: [20.94, 52.29] });

        const wrapper = mountMenu();
        await flushPromises();

        expect(box(wrapper, 'Start Location').find('input').element.value).toBe('');
    });
});
