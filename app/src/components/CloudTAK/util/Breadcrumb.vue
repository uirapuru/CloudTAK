<template>
    <div>
        <div class='px-3 pt-2 pb-1 fw-bold d-flex align-items-center'>
            <IconRoute
                :size='20'
                stroke='1'
                class='me-2'
            />
            <span>{{ t('util.breadcrumb.title') }}</span>
        </div>

        <div class='px-3 py-2 d-flex align-items-center justify-content-between'>
            <div class='d-flex align-items-center'>
                <IconRadar
                    :size='18'
                    stroke='1'
                    class='me-2 text-muted'
                />
                <span class='text-body'>{{ t('util.breadcrumb.liveTrail') }}</span>
            </div>
            <TablerToggle
                v-model='liveEnabled'
                @update:model-value='onLiveToggle'
            />
        </div>

        <div class='dropdown-divider my-0' />

        <TablerLoading
            v-if='loading'
            :desc='t("common.loading")'
            :inline='true'
        />
        <template v-else>
            <div class='px-3 pt-2 pb-1 d-flex align-items-center'>
                <IconHistory
                    :size='18'
                    stroke='1'
                    class='me-2 text-muted'
                />
                <span class='text-body'>{{ t('util.breadcrumb.loadHistory') }}</span>
            </div>

            <div class='px-3 pb-2'>
                <TranslatedEnum
                    v-model='query.relative'
                    :options='relativeOptions'
                />
            </div>

            <div class='px-3 pb-3'>
                <TablerButton
                    class='btn-primary w-100'
                    @click.stop.prevent='loadBreadcrumb'
                >
                    {{ t('util.breadcrumb.load') }}
                </TablerButton>
            </div>

            <div
                v-if='error'
                class='px-3 pb-2 small text-danger'
                v-text='error'
            />
            <div
                v-else-if='loaded !== null'
                class='px-3 pb-2 small text-muted'
                v-text='loaded ? `Loaded ${loaded} points` : "No history in that window"'
            />
        </template>
    </div>
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import { ref, watch, computed, onMounted } from 'vue';
import { server } from '../../../std.ts';
import {
    IconRoute,
    IconRadar,
    IconHistory,
} from '@tabler/icons-vue';
import {
    TablerButton,
    TablerLoading,
    TablerToggle
} from '@tak-ps/vue-tabler';
import TranslatedEnum from './TranslatedEnum.vue';
import { useMapStore } from '../../../stores/map.ts';
import type { InputFeature } from '../../../types.ts';

const { t } = useI18n();

const mapStore = useMapStore();

const props = defineProps<{
    uid: string
}>();

const emit = defineEmits<{
    live: [enabled: boolean]
}>();

const relativeOptions = computed(() => [
    { value: '1 Hour', label: t('util.breadcrumb.hours1') },
    { value: '4 Hours', label: t('util.breadcrumb.hours4') },
    { value: '8 Hours', label: t('util.breadcrumb.hours8') },
    { value: '24 Hours', label: t('util.breadcrumb.hours24') },
]);

const query = ref({
    relative: '1 Hour'
});
const loading = ref(false);
const loaded = ref<number | null>(null);
const error = ref<string | null>(null);
const liveEnabled = ref(false);

onMounted(async () => {
    liveEnabled.value = await mapStore.worker.db.breadcrumb.get(props.uid);
});

watch(() => props.uid, async (uid) => {
    loaded.value = null;
    error.value = null;
    liveEnabled.value = await mapStore.worker.db.breadcrumb.get(uid);
});

async function onLiveToggle(enabled: boolean): Promise<void> {
    await mapStore.worker.db.breadcrumb.set(props.uid, enabled);
    emit('live', enabled);
}

async function loadBreadcrumb() {
    loading.value = true;
    loaded.value = null;
    error.value = null;

    try {
        const { data: crumb, error: err } = await server.GET('/api/marti/cot/{:uid}/all', {
            params: {
                path: {
                    ':uid': props.uid
                },
                query: {
                    secago: String(60 * 60 * Number(query.value.relative.split(' ')[0])),
                    track: false
                }
            }
        });
        if (err || !crumb) throw new Error(String(err || 'No data'));

        loaded.value = await mapStore.worker.db.breadcrumb.ingest(crumb.features as unknown as InputFeature[]);
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
}
</script>
