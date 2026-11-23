<template>
    <MenuTemplate :name='t("menu.history.title")'>
        <template #default>
            <TablerNone
                v-if='entries.length === 0'
                :label='t("menu.history.none")'
                :create='false'
            />
            <template v-else>
                <div class='col-12 pt-2 pb-1'>
                    <span class='text-muted small'>
                        {{ t('menu.history.recordingDescription') }}
                    </span>
                </div>
                <div class='d-flex flex-column gap-2 py-2'>
                    <StandardItem
                        v-for='entry in entries'
                        :key='entry.uid'
                        class='d-flex align-items-center px-3 py-2 gap-3 cursor-pointer'
                        @click='flyToEntry(entry)'
                    >
                        <IconRoute
                            :size='20'
                            stroke='1'
                            class='text-muted flex-shrink-0'
                        />

                        <div class='flex-grow-1 d-flex flex-column gap-1 overflow-hidden'>
                            <span
                                class='fw-semibold text-truncate'
                                v-text='entry.callsign'
                            />
                            <div class='d-flex align-items-center gap-2'>
                                <span
                                    class='text-muted small text-truncate'
                                    v-text='entry.uid'
                                />
                                <TablerBadge
                                    v-if='entry.coordinates.length'
                                    class='small flex-shrink-0'
                                    background-color='rgba(107, 114, 128, 0.15)'
                                    border-color='rgba(107, 114, 128, 0.3)'
                                    text-color='#6b7280'
                                >
                                    {{ t('menu.history.pts', { count: entry.coordinates.length }) }}
                                </TablerBadge>
                            </div>
                        </div>

                        <div
                            class='d-flex align-items-center gap-2 flex-shrink-0'
                            @click.stop
                        >
                            <TablerToggle
                                :model-value='liveEnabled.has(entry.uid)'
                                :title='t("menu.history.liveTrail")'
                                @update:model-value='(val: boolean) => toggleLive(entry.uid, val)'
                            />

                            <TablerIconButton
                                :title='t("menu.history.viewCot")'
                                @click.stop.prevent='router.push(`/cot/${entry.uid}`)'
                            >
                                <IconListDetails
                                    :size='20'
                                    stroke='1'
                                />
                            </TablerIconButton>

                            <TablerIconButton
                                :title='t("menu.history.clearTrail")'
                                @click.stop.prevent='clearTrail(entry)'
                            >
                                <IconTrash
                                    :size='20'
                                    stroke='1'
                                />
                            </TablerIconButton>
                        </div>
                    </StandardItem>
                </div>
            </template>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
    IconRoute,
    IconListDetails,
    IconTrash,
} from '@tabler/icons-vue';
import {
    TablerBadge,
    TablerNone,
    TablerToggle,
    TablerIconButton,
} from '@tak-ps/vue-tabler';
import MenuTemplate from '../util/MenuTemplate.vue';
import StandardItem from '../util/StandardItem.vue';
import { db, type DBBreadcrumb, liveQuery } from '../../../database.ts';
import { useMapStore } from '../../../stores/map.ts';

const { t } = useI18n();
const mapStore = useMapStore();
const router = useRouter();

/** All breadcrumb trail entries (id ends with .track), kept live via Dexie liveQuery */
const entries = ref<DBBreadcrumb[]>([]);

/** Set of UIDs that currently have live recording on */
const liveEnabled = ref<Set<string>>(new Set());

const subscription = liveQuery(async () => {
    const all = await db.breadcrumb.toArray();
    return all.filter((e) => e.id.endsWith('.track'));
}).subscribe(async (rows) => {
    entries.value = rows;
    const enabledUids = await mapStore.worker.db.breadcrumb.listEnabled();
    liveEnabled.value = new Set(enabledUids);
});

onUnmounted(() => {
    subscription.unsubscribe();
});

async function flyToEntry(entry: DBBreadcrumb): Promise<void> {
    const cot = await mapStore.worker.db.get(entry.id, { mission: true });
    if (cot) await cot.flyTo();
}

async function toggleLive(uid: string, enabled: boolean): Promise<void> {
    await mapStore.worker.db.breadcrumb.set(uid, enabled);
    if (enabled) {
        liveEnabled.value.add(uid);
    } else {
        liveEnabled.value.delete(uid);
    }
    // Force reactivity update
    liveEnabled.value = new Set(liveEnabled.value);
}

async function clearTrail(entry: DBBreadcrumb): Promise<void> {
    if (liveEnabled.value.has(entry.uid)) {
        await mapStore.worker.db.breadcrumb.set(entry.uid, false);
    }
    // Removing from the map store and Dexie will trigger the liveQuery to re-fire
    await mapStore.worker.db.remove(entry.id);
    await db.breadcrumb.delete(entry.id);
}
</script>
