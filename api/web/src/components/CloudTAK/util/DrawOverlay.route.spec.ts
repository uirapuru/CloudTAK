import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
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
});

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
});
