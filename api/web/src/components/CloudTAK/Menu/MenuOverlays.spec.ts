import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shallowReactive } from 'vue';
import Sortable from 'sortablejs';

type Group = { id: number; name: string; pos: number; collapsed: boolean };
type Stub = {
    id: number; name: string; mode: string; type: string; pos: number; group_id: number | null;
    visible: boolean; loading: boolean; styles: unknown[]; url: string; _internal: boolean;
    healthy: () => boolean; hasBounds: () => boolean; update: (body: { visible?: boolean }) => Promise<void>;
};

const state = vi.hoisted(() => ({
    loaded: [] as unknown[],
    groups: [] as Array<{ id: number; name: string; pos: number; collapsed: boolean }>,
}));

function overlay(id: number, name: string, mode: string, extra: Partial<Stub> = {}): Stub {
    const stub: Stub = shallowReactive({
        id, name, mode, type: 'raster', pos: 0, group_id: null, visible: true, loading: false,
        styles: [{}], url: '', _internal: mode === 'internal',
        healthy: () => true, hasBounds: () => false,
        update: vi.fn(async (body: { visible?: boolean }) => { Object.assign(stub, body); }),
        ...extra,
    });
    return stub;
}

const manager = vi.hoisted(() => ({
    reorderLoaded: vi.fn(async () => {}),
    restackLoaded: vi.fn(async () => {}),
    deleteLoaded: vi.fn(async () => {}),
}));

const groupManager = vi.hoisted(() => ({
    create: vi.fn(),
    update: vi.fn(async (id: number, body: object) => ({ id, ...body })),
    delete: vi.fn(async () => {}),
}));

vi.mock('vue-router', () => ({
    useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../../../stores/map.ts', () => ({
    useMapStore: () => ({ isMapLoadedFully: true, offlineTiles: new Set() }),
}));
vi.mock('../../../utils/offline-tiles.ts', () => ({
    profileAssetIdFromUrl: () => null,
}));
vi.mock('./Overlays/TreeVector.vue', () => ({ default: { render: () => null } }));
/*
 * MenuTemplate renders the menu body in its own slot - like the real one, so
 * the lists are rendered by a child component, not by MenuOverlays itself
 */
vi.mock('../util/MenuTemplate.vue', async () => {
    const { defineComponent, h } = await import('vue');
    return {
        default: defineComponent({
            setup(_props, { slots }) {
                return () => h('div', [slots.buttons?.(), slots.default?.()]);
            },
        }),
    };
});
vi.mock('../../../base/overlay-group-manager.ts', () => ({
    default: {
        cached: async () => state.groups.map((group) => ({ ...group })),
        list: async () => state.groups.map((group) => ({ ...group })),
        create: groupManager.create,
        update: groupManager.update,
        delete: groupManager.delete,
    },
}));
vi.mock('../../../base/overlay.ts', () => {
    const rank = (o: { mode: string; _internal?: boolean }) => (o._internal || o.mode === 'internal') ? 1 : o.mode === 'basemap' ? -1 : 0;
    return {
        default: {
            get loaded() { return state.loaded; },
            loadedFrom: (id: number) => (state.loaded as Array<{ id: number }>).find((o) => o.id === Number(id)),
            isPinned: (o: { mode: string; _internal?: boolean }) => rank(o) !== 0,
            liveList: () => ({
                subscribe: ({ next }: { next: (items: unknown[]) => void }) => {
                    next((state.loaded as Array<Stub>).filter((o) => !o._internal).map((o) => ({ id: o.id, group_id: o.group_id })));
                    return { unsubscribe() {} };
                },
            }),
            reorderLoaded: manager.reorderLoaded,
            restackLoaded: manager.restackLoaded,
            deleteLoaded: manager.deleteLoaded,
            sync: async () => {},
        },
    };
});

import MenuOverlays from './MenuOverlays.vue';

async function mountMenu() {
    const wrapper = mount(MenuOverlays, { attachTo: document.body });
    await flushPromises();
    return wrapper;
}

async function editOrder(wrapper: Awaited<ReturnType<typeof mountMenu>>): Promise<void> {
    await wrapper.find('[title="Edit Order"]').trigger('click');
    await flushPromises();
}

function list(key: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(`.overlay-list[data-list-key="${key}"]`);
    if (!el) throw new Error(`No list ${key}`);
    return el;
}

function rowIds(el: Element): number[] {
    return Array.from(el.querySelectorAll(':scope > .overlay-row')).map((row) => Number(row.id));
}

/** Run a Sortable drop the way Sortable reports it (the DOM is left untouched) */
function drop(from: HTMLElement, to: HTMLElement, item: HTMLElement, oldIndex: number, newIndex: number): void {
    const sortable = Sortable.get(from)!;
    sortable.options.onStart?.({ item } as unknown as Sortable.SortableEvent);
    sortable.options.onEnd?.({ item, from, to, oldIndex, newIndex } as unknown as Sortable.SortableEvent);
}

describe('MenuOverlays groups', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();

        // Stack bottom first: basemap, 11, 12, 13, Map Features
        state.loaded = [
            overlay(-1, 'Basemap', 'basemap'),
            overlay(11, 'Imagery', 'overlay', { pos: 0 }),
            overlay(12, 'Air Quality', 'profile', { pos: 1, type: 'vector' }),
            overlay(13, 'Rivers', 'data', { pos: 2, type: 'vector' }),
            overlay(0, 'Map Features', 'internal', { type: 'geojson' }),
        ];
        state.groups = [{ id: 1, name: 'Alpha', pos: 0, collapsed: false }];

        groupManager.create.mockImplementation(async (name: string) => {
            const group: Group = { id: 2, name, pos: -1, collapsed: false };
            state.groups.push(group);
            return group;
        });
    });

    it('lists the map stack bottom first: basemap, ungrouped overlays, groups, Map Features', async () => {
        const wrapper = await mountMenu();

        const lists = Array.from(document.querySelectorAll<HTMLElement>('.overlay-list'));
        expect(lists.map((el) => el.dataset.listKey ?? 'pinned')).toEqual(['pinned', 'ungrouped', '1', 'pinned']);
        expect(rowIds(lists[0])).toEqual([-1]);
        expect(rowIds(list('ungrouped'))).toEqual([11, 12, 13]);
        expect(rowIds(lists[3])).toEqual([0]);

        wrapper.unmount();
    });

    it('only allows dragging in the reorder mode', async () => {
        const wrapper = await mountMenu();

        expect(Sortable.get(list('ungrouped'))!.option('disabled')).toBe(true);
        expect(document.querySelector('.drag-handle')).toBeNull();
        expect(document.querySelector('.group-drag-handle')).toBeNull();

        await editOrder(wrapper);

        expect(Sortable.get(list('ungrouped'))!.option('disabled')).toBe(false);
        expect(Sortable.get(list('1'))!.option('disabled')).toBe(false);
        expect(rowIds(list('ungrouped')).length).toBe(document.querySelectorAll('.overlay-list[data-list-key] .drag-handle').length);
        expect(document.querySelectorAll('.group-drag-handle')).toHaveLength(1);

        wrapper.unmount();
    });

    it('makes a group created at runtime a drop target and lists it first', async () => {
        const wrapper = await mountMenu();

        await wrapper.find('[title="Create Group"]').trigger('click');
        await wrapper.find('input[placeholder="Group Name"]').setValue('Main');
        await wrapper.find('form').trigger('submit');
        await flushPromises();

        const keys = Array.from(document.querySelectorAll<HTMLElement>('.overlay-list[data-list-key]')).map((el) => el.dataset.listKey);
        expect(keys).toEqual(['ungrouped', '2', '1']);

        // The list of a group added after mount is rendered in MenuTemplate's
        // slot - only a directive on the element gives it a Sortable
        const target = list('2');
        const sortable = Sortable.get(target);
        expect(sortable).toBeDefined();
        expect(sortable!.option('group')).toMatchObject({ name: 'overlays' });

        await editOrder(wrapper);
        expect(sortable!.option('disabled')).toBe(false);

        const from = list('ungrouped');
        drop(from, target, from.querySelector<HTMLElement>('[id="12"]')!, 1, 0);
        await flushPromises();

        // Bottom first: ungrouped 11, 13, then the new group, then Alpha (empty)
        expect(manager.reorderLoaded).toHaveBeenCalledWith([11, 13, 12], 12, { groupId: 2 });
        expect(rowIds(list('2'))).toEqual([12]);

        wrapper.unmount();
    });

    it('reorders overlays within the ungrouped list', async () => {
        const wrapper = await mountMenu();
        await editOrder(wrapper);

        const from = list('ungrouped');
        drop(from, from, from.querySelector<HTMLElement>('[id="13"]')!, 2, 0);
        await flushPromises();

        // 13 moved to the top of the menu - the bottom of the stack
        expect(manager.reorderLoaded).toHaveBeenCalledWith([13, 11, 12], 13, { groupId: null });

        wrapper.unmount();
    });

    it('reorders groups by their handle, renumbers them and restacks the map', async () => {
        state.groups = [
            { id: 1, name: 'Alpha', pos: 0, collapsed: false },
            { id: 3, name: 'Beta', pos: 0, collapsed: false },
        ];
        (state.loaded[1] as Stub).group_id = 1;
        (state.loaded[2] as Stub).group_id = 3;

        const wrapper = await mountMenu();
        await editOrder(wrapper);

        const container = document.querySelector<HTMLElement>('.overlay-groups')!;
        const sortable = Sortable.get(container)!;
        expect(sortable.option('handle')).toBe('.group-drag-handle');
        expect(sortable.option('group')).toMatchObject({ name: 'overlay-groups' });

        const first = container.querySelector<HTMLElement>('.overlay-group')!;
        sortable.options.onStart?.({ item: first } as unknown as Sortable.SortableEvent);
        sortable.options.onEnd?.({ item: first, from: container, to: container, oldIndex: 0, newIndex: 1 } as unknown as Sortable.SortableEvent);
        await flushPromises();

        // Both groups had pos 0 - renumbering repairs that; Beta keeps its 0
        expect(groupManager.update).toHaveBeenCalledTimes(1);
        expect(groupManager.update).toHaveBeenCalledWith(1, { pos: 1 });
        // Alpha (11) is now drawn above Beta (12), both above the ungrouped 13
        expect(manager.restackLoaded).toHaveBeenCalledWith([13, 12, 11]);
        expect(Array.from(container.querySelectorAll('.group-name')).map((el) => el.textContent)).toEqual(['Beta', 'Alpha']);

        wrapper.unmount();
    });

    it('hides a collapsed group list despite Bootstrap display utilities', async () => {
        (state.loaded[1] as Stub).group_id = 1;
        const wrapper = await mountMenu();

        const groupList = list('1');
        expect(groupList.closest('[style*="display: none"]')).toBeNull();

        await wrapper.find('[data-group-id="1"] [title="Collapse Group"]').trigger('click');
        await flushPromises();

        // Bootstrap's d-flex is display:flex !important and would beat v-show's inline display:none
        const hidden = groupList.closest<HTMLElement>('[style*="display: none"]');
        expect(hidden).not.toBeNull();
        expect(hidden!.className).not.toMatch(/\bd-(flex|block|grid|inline)/);
        expect(groupManager.update).toHaveBeenCalledWith(1, { collapsed: true });

        wrapper.unmount();
    });

    it('toggles every overlay of a group from a tri-state checkbox', async () => {
        (state.loaded[1] as Stub).group_id = 1;
        (state.loaded[2] as Stub).group_id = 1;
        (state.loaded[2] as Stub).visible = false;

        const wrapper = await mountMenu();

        const checkbox = wrapper.find<HTMLInputElement>('[data-group-id="1"] input[type="checkbox"]');
        expect(checkbox.element.indeterminate).toBe(true);
        expect(checkbox.element.checked).toBe(false);

        await checkbox.trigger('change');
        await flushPromises();

        expect((state.loaded[1] as Stub).update).not.toHaveBeenCalled();
        expect((state.loaded[2] as Stub).update).toHaveBeenCalledWith({ visible: true });
        expect(checkbox.element.checked).toBe(true);
        expect(checkbox.element.indeterminate).toBe(false);

        wrapper.unmount();
    });

    it('renames a group inline', async () => {
        const wrapper = await mountMenu();

        await wrapper.find('[data-group-id="1"] [title="Rename Group"]').trigger('click');
        const input = wrapper.find<HTMLInputElement>('[data-group-id="1"] input[type="text"]');
        await input.setValue('  Roads  ');
        await input.trigger('keydown', { key: 'Enter' });
        await flushPromises();

        expect(groupManager.update).toHaveBeenCalledWith(1, { name: 'Roads' });

        wrapper.unmount();
    });

    it('deletes a group only after confirmation and keeps its overlays', async () => {
        (state.loaded[1] as Stub).group_id = 1;
        const wrapper = await mountMenu();

        await wrapper.find('[data-group-id="1"] [title="Delete Group"]').trigger('click');
        await flushPromises();
        expect(groupManager.delete).not.toHaveBeenCalled();

        const confirm = Array.from(document.querySelectorAll<HTMLElement>('.modal-footer .btn-danger'));
        expect(confirm).toHaveLength(1);
        confirm[0].click();
        await flushPromises();

        expect(groupManager.delete).toHaveBeenCalledWith(1);
        expect(manager.deleteLoaded).not.toHaveBeenCalled();
        expect(document.querySelector('[data-group-id="1"]')).toBeNull();
        expect(rowIds(list('ungrouped'))).toEqual([11, 12, 13]);
        expect(manager.restackLoaded).toHaveBeenCalledWith([11, 12, 13]);

        wrapper.unmount();
    });
});
