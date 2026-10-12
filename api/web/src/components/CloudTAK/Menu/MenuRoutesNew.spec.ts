import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { LocationState } from '../../../utils/events.ts';

const GET = vi.fn();
const location = vi.fn();
const routeQuery: Record<string, string> = {};

vi.mock('../../../std.ts', () => ({
    server: { GET: (...args: unknown[]) => GET(...args) }
}));

const draw = reactive({
    mode: 'static',
    routeWaypoints: [] as Array<[number, number]>,
    get canFinish() { return draw.routeWaypoints.length >= 2; },
    buildRoute: vi.fn(async (opts: { start: [number, number] }) => {
        draw.mode = 'route';
        draw.routeWaypoints = [opts.start];
    }),
    setRouteCallsign: vi.fn(),
    setRouteTravelMode: vi.fn<(travelMode: string) => Promise<boolean>>(async () => true),
    setRouteOptions: vi.fn<(options: unknown) => Promise<boolean>>(async () => true),
    removeRouteWaypoint: vi.fn(),
    finish: vi.fn(async () => { draw.mode = 'static'; }),
    stop: vi.fn(async () => { draw.mode = 'static'; }),
});

vi.mock('../../../stores/map.ts', () => ({
    useMapStore: () => ({
        draw,
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
            }),
            h('button', {
                class: 'pick-map',
                onClick: () => emit('select', { name: '52.10000, 21.00000', coordinates: [21, 52.1], source: 'map' })
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
        draw.mode = 'static';
        draw.routeWaypoints = [];
        vi.clearAllMocks();
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

    describe('zmiana trybu w czasie budowania', () => {
        beforeEach(() => {
            GET.mockImplementation(async (url: string) => {
                if (url === '/api/search') {
                    return {
                        error: undefined,
                        data: {
                            route: {
                                enabled: true,
                                providers: [{ id: 'taklab', name: 'taklab', modes: [{ id: 'car', name: 'Samochód' }, { id: 'foot', name: 'Pieszo' }] }]
                            }
                        }
                    };
                }
                return { error: undefined, data: { features: [{ type: 'Feature' }] } };
            });
        });

        async function building() {
            location.mockResolvedValue({ source: LocationState.Disabled, coordinates: [0, 0] });
            const wrapper = mountMenu();
            await flushPromises();
            await box(wrapper, 'Start Location').find('.pick-map').trigger('click');
            await flushPromises();
            const select = () => wrapper.findAll('select')[1];
            return { wrapper, select };
        }

        it('pole trybu jest aktywne, a zmiana idzie do edytora trasy', async () => {
            const { select } = await building();
            expect(select().attributes('disabled')).toBeUndefined();

            await select().setValue('Pieszo');
            await flushPromises();
            expect(draw.setRouteTravelMode).toHaveBeenCalledWith('foot');
            expect(select().element.value).toBe('Pieszo');
        });

        it('gdy edytor odrzuci zmianę, pole wraca do poprzedniego trybu', async () => {
            const { select } = await building();
            draw.setRouteTravelMode.mockImplementationOnce(async () => false);

            await select().setValue('Pieszo');
            await flushPromises();
            expect(select().element.value).toBe('Samochód');
        });

        it('poza budowaniem zmiana trybu nie woła edytora', async () => {
            location.mockResolvedValue({ source: LocationState.Disabled, coordinates: [0, 0] });
            const wrapper = mountMenu();
            await flushPromises();
            await wrapper.findAll('select')[1].setValue('Pieszo');
            await flushPromises();
            expect(draw.setRouteTravelMode).not.toHaveBeenCalled();
        });
    });

    describe('opcje przełaju', () => {
        beforeEach(() => {
            GET.mockImplementation(async (url: string) => {
                if (url === '/api/search') {
                    return {
                        error: undefined,
                        data: {
                            route: {
                                enabled: true,
                                providers: [{ id: 'taklab', name: 'taklab', modes: [{ id: 'foot', name: 'Pieszo' }, { id: 'foot_cross_country', name: 'Pieszo na przełaj' }] }]
                            }
                        }
                    };
                }
                return { error: undefined, data: { features: [{ type: 'Feature' }] } };
            });
        });

        async function crossCountry() {
            location.mockResolvedValue({ source: LocationState.Disabled, coordinates: [0, 0] });
            const wrapper = mountMenu();
            await flushPromises();
            await wrapper.findAll('select')[1].setValue('Pieszo na przełaj');
            await flushPromises();
            return wrapper;
        }

        const wetland = (wrapper: ReturnType<typeof mountMenu>) => wrapper.find('.route-options .avoid-wetland input');

        it('panel opcji jest tylko przy przełaju', async () => {
            location.mockResolvedValue({ source: LocationState.Disabled, coordinates: [0, 0] });
            const wrapper = mountMenu();
            await flushPromises();
            expect(wrapper.find('.route-options').exists()).toBe(false);

            await wrapper.findAll('select')[1].setValue('Pieszo na przełaj');
            await flushPromises();
            expect(wrapper.find('.route-options').exists()).toBe(true);
        });

        it('formularz wysyła opcje w zapytaniu o trasę', async () => {
            const wrapper = await crossCountry();
            await wetland(wrapper).setValue(true);
            await wrapper.find('.route-options .max-slope select').setValue('20°');
            for (const b of wrapper.findAll('.search-box').map((x) => x.find('.pick'))) await b.trigger('click');
            await wrapper.find('button.btn-primary').trigger('click');
            await flushPromises();

            const call = GET.mock.calls.find(c => c[0] === '/api/search/route');
            expect(call![1].params.query).toMatchObject({ travelMode: 'foot_cross_country', avoidWetland: true, maxSlope: 20 });
            expect(call![1].params.query.avoidStreams).toBeUndefined();
            expect(call![1].params.query.exposure).toBeUndefined();
        });

        it('ekspozycja trafia do zapytania, a domyślna nie', async () => {
            const wrapper = await crossCountry();
            const exposure = () => wrapper.find('.route-options .exposure select');
            expect((exposure().element as HTMLSelectElement).value).toBe('może być');
            await exposure().setValue('unikaj');
            for (const b of wrapper.findAll('.search-box').map((x) => x.find('.pick'))) await b.trigger('click');
            await wrapper.find('button.btn-primary').trigger('click');
            await flushPromises();

            const call = GET.mock.calls.find(c => c[0] === '/api/search/route');
            expect(call![1].params.query.exposure).toBe('avoid');
        });

        it('bez przełaju zapytanie nie ma opcji', async () => {
            location.mockResolvedValue({ source: LocationState.Live, coordinates: [20.94, 52.29] });
            const wrapper = mountMenu();
            await flushPromises();
            await box(wrapper, 'End Location').find('.pick').trigger('click');
            await wrapper.find('button.btn-primary').trigger('click');
            await flushPromises();

            const call = GET.mock.calls.find(c => c[0] === '/api/search/route');
            expect(call![1].params.query.avoidWetland).toBeUndefined();
            expect(call![1].params.query.maxSlope).toBeUndefined();
        });

        it('budowanie startuje z opcjami, a zmiana opcji idzie do edytora', async () => {
            const wrapper = await crossCountry();
            await wetland(wrapper).setValue(true);
            await box(wrapper, 'Start Location').find('.pick-map').trigger('click');
            await flushPromises();
            expect(draw.buildRoute).toHaveBeenCalledWith(expect.objectContaining({ travelMode: 'foot_cross_country', options: { avoid_wetland: true } }));

            await wrapper.find('.route-options .avoid-streams input').setValue(true);
            await flushPromises();
            expect(draw.setRouteOptions).toHaveBeenLastCalledWith({ avoid_wetland: true, avoid_streams: true });
        });

        it('gdy edytor odrzuci opcje, przełącznik wraca', async () => {
            const wrapper = await crossCountry();
            await box(wrapper, 'Start Location').find('.pick-map').trigger('click');
            await flushPromises();
            draw.setRouteOptions.mockImplementationOnce(async () => false);

            await wetland(wrapper).setValue(true);
            await flushPromises();
            expect((wetland(wrapper).element as HTMLInputElement).checked).toBe(false);
        });
    });

    it('does not overwrite a start given in the query', async () => {
        routeQuery.start = '21,52';
        location.mockResolvedValue({ source: LocationState.Live, coordinates: [20.94, 52.29] });

        const wrapper = mountMenu();
        await flushPromises();

        expect(box(wrapper, 'Start Location').find('input').element.value).toBe('');
    });

    it('dodaje punkt pośredni i wysyła go jako via', async () => {
        location.mockResolvedValue({ source: LocationState.Live, coordinates: [20.94, 52.29] });
        const wrapper = mountMenu();
        await flushPromises();

        await wrapper.find('button.add-via').trigger('click');
        expect(box(wrapper, 'Punkt pośredni 1').exists()).toBe(true);
        await box(wrapper, 'Punkt pośredni 1').find('.pick').trigger('click');
        await box(wrapper, 'End Location').find('.pick').trigger('click');
        await wrapper.find('button.btn-primary').trigger('click');
        await flushPromises();

        const call = GET.mock.calls.find(c => c[0] === '/api/search/route');
        expect(call![1].params.query.via).toBe('21,52.4');
    });

    it('pusty punkt pośredni blokuje generowanie, usunięcie go odblokowuje', async () => {
        location.mockResolvedValue({ source: LocationState.Live, coordinates: [20.94, 52.29] });
        const wrapper = mountMenu();
        await flushPromises();

        await box(wrapper, 'End Location').find('.pick').trigger('click');
        await wrapper.find('button.add-via').trigger('click');
        expect(wrapper.find('button.btn-primary').attributes('disabled')).toBeDefined();

        await wrapper.find('button.remove-via').trigger('click');
        expect(box(wrapper, 'Punkt pośredni 1').exists()).toBe(false);
        expect(wrapper.find('button.btn-primary').attributes('disabled')).toBeUndefined();
    });

    it('start wskazany na mapie uruchamia budowanie trasy kliknięciami', async () => {
        location.mockResolvedValue({ source: LocationState.Disabled, coordinates: [0, 0] });
        const wrapper = mountMenu();
        await flushPromises();

        await box(wrapper, 'Start Location').find('.pick-map').trigger('click');
        await flushPromises();

        expect(draw.buildRoute).toHaveBeenCalledWith(expect.objectContaining({ travelMode: 'car', start: [21, 52.1] }));
        expect(wrapper.find('.route-build-list').exists()).toBe(true);
        expect(wrapper.findAll('.route-build-point').map(r => r.find('.route-build-label').text())).toEqual(['A']);
    });

    it('lista budowania pokazuje punkty edytora w kolejności A, 1, B i usuwa wskazany', async () => {
        location.mockResolvedValue({ source: LocationState.Disabled, coordinates: [0, 0] });
        const wrapper = mountMenu();
        await flushPromises();
        await box(wrapper, 'Start Location').find('.pick-map').trigger('click');
        await flushPromises();

        draw.routeWaypoints = [[21, 52.1], [21.1, 52.1], [21.2, 52.2]];
        await flushPromises();
        expect(wrapper.findAll('.route-build-label').map(l => l.text())).toEqual(['A', '1', 'B']);

        await wrapper.findAll('.route-build-remove')[1].trigger('click');
        expect(draw.removeRouteWaypoint).toHaveBeenCalledWith(1);
    });

    it('w budowaniu Generate Route zapisuje trasę z edytora', async () => {
        location.mockResolvedValue({ source: LocationState.Disabled, coordinates: [0, 0] });
        const wrapper = mountMenu();
        await flushPromises();
        await box(wrapper, 'Start Location').find('.pick-map').trigger('click');
        await flushPromises();
        draw.routeWaypoints = [[21, 52.1], [21.2, 52.2]];
        await flushPromises();

        await wrapper.find('button.btn-primary').trigger('click');
        await flushPromises();

        expect(draw.setRouteCallsign).toHaveBeenCalled();
        expect(draw.finish).toHaveBeenCalled();
        expect(GET.mock.calls.find(c => c[0] === '/api/search/route')).toBeUndefined();
    });

    it('zamknięcie menu w trakcie budowania zamyka edytor', async () => {
        location.mockResolvedValue({ source: LocationState.Disabled, coordinates: [0, 0] });
        const wrapper = mountMenu();
        await flushPromises();
        await box(wrapper, 'Start Location').find('.pick-map').trigger('click');
        await flushPromises();

        wrapper.unmount();
        expect(draw.stop).toHaveBeenCalled();
    });

    it('anulowanie edytora na pasku wraca do zwykłego formularza', async () => {
        location.mockResolvedValue({ source: LocationState.Disabled, coordinates: [0, 0] });
        const wrapper = mountMenu();
        await flushPromises();
        await box(wrapper, 'Start Location').find('.pick-map').trigger('click');
        await flushPromises();

        draw.mode = 'static';
        await flushPromises();
        expect(wrapper.find('.route-build-list').exists()).toBe(false);
        expect(box(wrapper, 'Start Location').exists()).toBe(true);
    });
});
