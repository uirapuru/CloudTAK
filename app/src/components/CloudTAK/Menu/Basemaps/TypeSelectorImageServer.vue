<template>
    <div class='row row-cards'>
        <template v-if='showImportPrompt'>
            <TypeSelectorSelected
                type='imageserver'
                @change-type='emit("change-type")'
            />

            <div class='col-md-12 mt-3'>
                <TablerInput
                    :model-value='props.url'
                    :label='t("basemaps.types.imageserver.urlLabel")'
                    :placeholder='config.urlPlaceholder'
                    @update:model-value='emit("update:url", $event)'
                />
            </div>
            <div class='col-md-12 mt-3'>
                <div class='d-flex'>
                    <button
                        class='cursor-pointer btn btn-secondary'
                        @click='emit("change-type")'
                    >
                        {{ t('common.cancel') }}
                    </button>
                    <div class='ms-auto'>
                        <a
                            class='cursor-pointer btn btn-primary'
                            @click='emit("fetch")'
                        >{{ t('basemaps.common.fetchMetadata') }}</a>
                    </div>
                </div>
            </div>
        </template>
        <template v-else>
            <TypeSelectorBase
                v-bind='props'
                v-model:editing='editing'
                type='imageserver'
                @change-type='emit("change-type")'
                @update:scope='emit("update:scope", $event)'
                @update:warn-sharing='emit("update:warnSharing", $event)'
            >
                <template #advanced>
                    <div class='col-md-6'>
                        <TablerInput
                            v-model='editing.minzoom'
                            required
                            :label='t("basemaps.common.minZoom")'
                        />
                    </div>
                    <div class='col-md-6'>
                        <TablerInput
                            v-model='editing.maxzoom'
                            required
                            :label='t("basemaps.common.maxZoom")'
                        />
                    </div>
                </template>
            </TypeSelectorBase>
        </template>
    </div>
</template>

<script setup lang='ts'>
import { computed } from 'vue';
import TypeSelectorBase from './TypeSelectorBase.vue';
import TypeSelectorSelected from './TypeSelectorSelected.vue';
import { BasemapTypeConfig } from './types.ts';
import { TablerInput } from '@tak-ps/vue-tabler';
import { useI18n } from 'vue-i18n';
import type { EditingBasemap, VectorLayerDescriptor } from './types.ts';

const { t } = useI18n();

const editing = defineModel<EditingBasemap>('editing', { required: true });

const props = defineProps<{
    basemapId?: number;
    vectorLayers: VectorLayerDescriptor[];
    errors: Record<'name' | 'url', string>;
    scope: 'user' | 'server';
    warnSharing: boolean;
    isSystemAdmin: boolean;
    url: string;
}>();

const emit = defineEmits<{
    'change-type': [];
    fetch: [];
    'update:scope': [value: 'user' | 'server'];
    'update:warnSharing': [value: boolean];
    'update:url': [value: string];
}>();

const config = BasemapTypeConfig['imageserver'];
const showImportPrompt = computed(() => !props.basemapId && !editing.value.url);
</script>
