import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { DrawToolMode } from '../../../stores/modules/draw.ts';

const draw = reactive({
    mode: DrawToolMode.ROUTE,
    routeEditorKind: 'edit' as 'edit' | 'build',
    canFinish: true,
    routeBusy: false,
    routeError: '',
    routeSummary: 'Punkty: 3 · 12,3 km · 2 h 5 min',
    routeWaypointCount: 3,
    routeMenu: null as null | { index: number; x: number; y: number },
    finish: vi.fn(),
    stop: vi.fn(),
    removeRouteWaypoint: vi.fn(),
    populateSnappingLayers: vi.fn(),
    routeTravelMode: 'foot',
    routeOptions: undefined as undefined | Record<string, unknown>,
    setRouteTravelMode: vi.fn<(travelMode: string) => Promise<boolean>>(async () => true),
    setRouteOptions: vi.fn<(options: unknown) => Promise<boolean>>(async () => true),
});

const GET = vi.fn(async () => ({
    error: undefined,
    data: { route: { enabled: true, providers: [{ id: 'taklab', name: 'taklab', modes: [
        { id: 'car', name: 'Samochód' },
        { id: 'foot', name: 'Pieszo' },
        { id: 'foot_cross_country', name: 'Pieszo na przełaj' },
    ] }] } },
}));
vi.mock('../../../std.ts', () => ({ server: { GET: () => GET() } }));

vi.mock('../../../stores/map.ts', () => ({ useMapStore: () => ({ draw }) }));
vi.mock('../../../stores/app.ts', () => ({ useAppStore: () => reactive({ isMobileDetected: false }) }));
vi.mock('../../../base/overlay.ts', () => ({ default: { queryableOverlayNames: () => [] } }));

import DrawOverlay from './DrawOverlay.vue';

function mountOverlay() {
    return mount(DrawOverlay, {
        global: { stubs: { GenericBottomPane: { template: '<div><slot /></div>' }, TablerIconButton: { template: '<button class="icon-button" @click="$emit(\'click\')"><slot /></button>' } } },
    });
}

describe('DrawOverlay - edytor trasy', () => {
    it('pokazuje podsumowanie i podpowiedź trybu edycji', () => {
        const wrapper = mountOverlay();
        expect(wrapper.text()).toContain('Edycja trasy');
        expect(wrapper.text()).toContain('Punkty: 3 · 12,3 km · 2 h 5 min');
        expect(wrapper.text()).toContain('najbliższego odcinka');
    });

    it('w budowaniu podpowiada dopisywanie na koniec', async () => {
        draw.routeEditorKind = 'build';
        const wrapper = mountOverlay();
        expect(wrapper.text()).toContain('Wyznaczanie trasy');
        expect(wrapper.text()).toContain('dodać kolejny punkt');
        draw.routeEditorKind = 'edit';
    });

    it('pokazuje przeliczanie i błąd', () => {
        draw.routeBusy = true;
        draw.routeError = 'Brak przejścia między punktami.';
        const wrapper = mountOverlay();
        expect(wrapper.find('.route-busy').exists()).toBe(true);
        expect(wrapper.find('.route-error').text()).toBe('Brak przejścia między punktami.');
        draw.routeBusy = false;
        draw.routeError = '';
    });

    it('menu punktu usuwa wskazany punkt', async () => {
        draw.routeMenu = { index: 1, x: 0, y: 0 };
        const wrapper = mountOverlay();
        expect(wrapper.find('.route-point-menu').text()).toContain('Punkt 1');
        await wrapper.find('.route-remove-point').trigger('click');
        expect(draw.removeRouteWaypoint).toHaveBeenCalledWith(1);
        draw.routeMenu = null;
    });

    describe('tryb i opcje w edycji', () => {
        afterEach(() => {
            draw.routeEditorKind = 'edit';
            draw.routeTravelMode = 'foot';
            draw.routeOptions = undefined;
            vi.clearAllMocks();
        });

        async function settings() {
            const wrapper = mountOverlay();
            await flushPromises();
            await wrapper.find('.route-settings-toggle').trigger('click');
            await flushPromises();
            return wrapper;
        }

        it('w edycji pokazuje tryb trasy wczytany z edytora', async () => {
            const wrapper = await settings();
            const select = wrapper.find('.route-travel-mode select');
            expect((select.element as HTMLSelectElement).value).toBe('Pieszo');
            expect(wrapper.find('.route-options').exists()).toBe(false);
        });

        it('w budowaniu nie ma przycisku ustawień (są w menu trasy)', async () => {
            draw.routeEditorKind = 'build';
            const wrapper = mountOverlay();
            await flushPromises();
            expect(wrapper.find('.route-settings-toggle').exists()).toBe(false);
        });

        it('zmiana trybu idzie do edytora, a odrzucona wraca', async () => {
            const wrapper = await settings();
            await wrapper.find('.route-travel-mode select').setValue('Samochód');
            await flushPromises();
            expect(draw.setRouteTravelMode).toHaveBeenCalledWith('car');

            draw.setRouteTravelMode.mockImplementationOnce(async () => false);
            await wrapper.find('.route-travel-mode select').setValue('Pieszo na przełaj');
            await flushPromises();
            expect(draw.setRouteTravelMode).toHaveBeenNthCalledWith(2, 'foot_cross_country');
            expect((wrapper.find('.route-travel-mode select').element as HTMLSelectElement).value).toBe('Samochód');
        });

        it('w trybie pieszym pokazuje stan stref z planu i wysyła zmianę do edytora', async () => {
            draw.routeOptions = { ignore_danger_zones: true };
            const wrapper = await settings();
            const zones = () => wrapper.find('.route-danger-zones .avoid-danger-zones input');
            expect((zones().element as HTMLInputElement).checked).toBe(false);

            await zones().setValue(true);
            await flushPromises();
            expect(draw.setRouteOptions).toHaveBeenCalledWith(undefined);
        });

        it('przy przełaju pokazuje opcje z planu i wysyła zmiany do edytora', async () => {
            draw.routeTravelMode = 'foot_cross_country';
            draw.routeOptions = { avoid_wetland: true };
            const wrapper = await settings();
            expect((wrapper.find('.route-options .avoid-wetland input').element as HTMLInputElement).checked).toBe(true);

            await wrapper.find('.route-options .avoid-streams input').setValue(true);
            await flushPromises();
            expect(draw.setRouteOptions).toHaveBeenCalledWith({ avoid_wetland: true, avoid_streams: true });
        });

        it('odrzucone opcje wracają do poprzednich', async () => {
            draw.routeTravelMode = 'foot_cross_country';
            const wrapper = await settings();
            draw.setRouteOptions.mockImplementationOnce(async () => false);
            await wrapper.find('.route-options .avoid-wetland input').setValue(true);
            await flushPromises();
            expect((wrapper.find('.route-options .avoid-wetland input').element as HTMLInputElement).checked).toBe(false);
        });

        it('w trakcie przeliczania pola są zablokowane', async () => {
            draw.routeTravelMode = 'foot_cross_country';
            draw.routeBusy = true;
            const wrapper = await settings();
            expect(wrapper.find('.route-travel-mode select').attributes('disabled')).toBeDefined();
            expect(wrapper.find('.route-options .avoid-wetland input').attributes('disabled')).toBeDefined();
            draw.routeBusy = false;
        });
    });
});
