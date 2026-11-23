<template>
    <div>
        <div v-if='loading.init'>
            <TablerLoading
                :inline='true'
                :desc='t("shared.basemapSelect.loadingBasemap")'
            />
        </div>
        <div v-else-if='modelValue && !err'>
            <div class='card'>
                <StandardItemBasemap
                    v-if='selected'
                    :basemap='selected'
                >
                    <template
                        v-if='!disabled'
                        #actions
                    >
                        <TablerIconButton
                            :title='t("shared.basemapSelect.removeBasemap")'
                            @click='emit("update:modelValue", null)'
                        >
                            <IconTrash
                                :size='20'
                                stroke='1'
                            />
                        </TablerIconButton>
                    </template>
                </StandardItemBasemap>
                <div
                    v-else
                    class='card-body d-flex align-items-center'
                >
                    <div>{{ t('shared.basemapSelect.unknownBasemap') }}</div>
                    <div
                        v-if='!disabled'
                        class='ms-auto'
                    >
                        <TablerIconButton
                            :title='t("shared.basemapSelect.removeBasemap")'
                            @click='emit("update:modelValue", null)'
                        >
                            <IconTrash
                                :size='20'
                                stroke='1'
                            />
                        </TablerIconButton>
                    </div>
                </div>
            </div>
        </div>
        <div v-else-if='disabled'>
            <TablerNone
                :compact='true'
                :create='false'
                :label='noValueLabel ?? t("shared.basemapSelect.noDefaultBasemap")'
            />
        </div>
        <div
            v-else
            class='card'
        >
            <div
                v-if='loading.list && list.items.length === 0'
                class='card-body'
            >
                <TablerLoading :desc='t("shared.basemapSelect.loadingBasemaps")' />
            </div>
            <div
                v-else
                class='card-body'
            >
                <div
                    v-if='err'
                    class='pb-2'
                >
                    <TablerInlineAlert
                        :title='t("shared.basemapSelect.failedToLoad")'
                        :description='String(err)'
                        severity='danger'
                    />
                </div>
                <TablerInput
                    v-model='paging.filter'
                    :placeholder='t("shared.basemapSelect.filter")'
                    class='mb-2'
                />
                
                <TablerLoading
                    v-if='loading.list'
                    :desc='t("shared.basemapSelect.loadingBasemaps")'
                />
                <TablerNone
                    v-else-if='list.total === 0'
                    :compact='true'
                    :create='false'
                    :label='t("shared.basemapSelect.noBasemaps")'
                />
                <template v-else>
                    <div class='d-flex flex-column gap-2'>
                        <StandardItemBasemap
                            v-for='basemap in list.items'
                            :key='basemap.id'
                            :basemap='basemap'
                            class='cloudtak-hover cursor-pointer'
                            @click='emit("update:modelValue", basemap.id)'
                        />
                    </div>
                </template>
            </div>
            <div
                v-if='list.total > paging.limit'
                class='card-footer d-flex'
            >
                <div class='ms-auto'>
                    <TablerPager
                        :page='paging.page'
                        :total='list.total'
                        :limit='paging.limit'
                        @page='paging.page = $event'
                    />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ref, watch, onMounted } from 'vue';
import { server } from '../../std.ts';
import {
    IconTrash
} from '@tabler/icons-vue';
import {
    TablerLoading,
    TablerInput,
    TablerNone,
    TablerPager,
    TablerInlineAlert,
    TablerIconButton
} from '@tak-ps/vue-tabler';
import type { Basemap, BasemapList } from '../../types.ts';
import StandardItemBasemap from '../CloudTAK/util/StandardItemBasemap.vue';

const { t } = useI18n();

const props = withDefaults(defineProps<{
    modelValue?: number | string | null;
    disabled?: boolean;
    type?: 'raster' | 'raster-dem' | 'vector';
    scope?: 'server' | 'user';
    noValueLabel?: string;
}>(), {
    modelValue: null,
    disabled: false,
    type: undefined,
    scope: 'server',
    noValueLabel: undefined
});

const emit = defineEmits<{
    'update:modelValue': [value: number | string | null];
}>();

const loading = ref<{
    init: boolean;
    list: boolean;
}>({
    init: false,
    list: false
});

const err = ref<Error | null>(null);
const selected = ref<Basemap | null>(null);

const paging = ref<{
    filter: string;
    limit: number;
    page: number;
}>({
    filter: '',
    limit: 10,
    page: 0
});

const list = ref<BasemapList>({
    total: 0,
    collections: [],
    items: []
});

watch(() => props.modelValue, async () => {
    await fetchSelected();
    if (!props.modelValue && !props.disabled) {
        await fetchList();
    }
});

watch(paging, async () => {
    if (!props.modelValue && !props.disabled) {
        await fetchList();
    }
}, { deep: true });

watch(() => props.disabled, async () => {
    if (!props.modelValue && !props.disabled) {
        await fetchList();
    }
});

onMounted(async () => {
    await fetchSelected();
    if (!props.modelValue && !props.disabled) {
        await fetchList();
    }
});

async function fetchSelected(): Promise<void> {
    err.value = null;
    if (!props.modelValue) {
        selected.value = null;
        return;
    }

    loading.value.init = true;
    const { data, error } = await server.GET('/api/basemap/{:basemapid}', {
        params: { path: { ':basemapid': Number(props.modelValue) } }
    });
    if (error) {
        err.value = new Error(String(error));
        await fetchList();
    } else if (typeof data !== 'string') {
        selected.value = data;
    }
    loading.value.init = false;
}

async function fetchList(): Promise<void> {
    loading.value.list = true;
    const { data, error } = await server.GET('/api/basemap', {
        params: {
            query: {
                limit: paging.value.limit,
                page: paging.value.page,
                filter: paging.value.filter,
                overlay: false,
                order: 'asc',
                sort: 'name',
                hidden: 'false',
                ...(props.type ? { type: props.type } : {}),
                ...(props.scope ? { scope: props.scope } : {})
            }
        }
    });
    if (error) {
        console.error(error);
    } else {
        list.value = data;
    }
    loading.value.list = false;
}
</script>
