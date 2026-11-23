<template>
    <div class='row row-cards'>
        <TypeSelectorBase
            v-bind='props'
            v-model:editing='editing'
            type='zxy'
            @change-type='emit("change-type")'
            @update:scope='emit("update:scope", $event)'
            @update:warn-sharing='emit("update:warnSharing", $event)'
        >
            <template #advanced>
                <div class='col-md-3'>
                    <TablerInput
                        v-model='editing.minzoom'
                        required
                        :label='t("basemaps.common.minZoom")'
                    />
                </div>
                <div class='col-md-3'>
                    <TablerInput
                        v-model='editing.maxzoom'
                        required
                        :label='t("basemaps.common.maxZoom")'
                    />
                </div>
                <div class='col-12 col-md-3'>
                    <TablerInput
                        v-model='editing.tilesize'
                        :label='t("basemaps.common.tileSize")'
                    />
                </div>
                <div class='col-12 col-md-3'>
                    <TablerEnum
                        v-model='editing.format'
                        required
                        :label='t("basemaps.common.format")'
                        :options='["png", "jpeg", "mvt", "webp"]'
                    />
                </div>
            </template>
        </TypeSelectorBase>
    </div>
</template>

<script setup lang='ts'>
import TypeSelectorBase from './TypeSelectorBase.vue';
import { TablerEnum, TablerInput } from '@tak-ps/vue-tabler';
import type { EditingBasemap, VectorLayerDescriptor } from './types.ts';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const editing = defineModel<EditingBasemap>('editing', { required: true });

const props = defineProps<{
    basemapId?: number;
    vectorLayers: VectorLayerDescriptor[];
    errors: Record<'name' | 'url', string>;
    scope: 'user' | 'server';
    warnSharing: boolean;
    isSystemAdmin: boolean;
}>();

const emit = defineEmits<{
    'change-type': [];
    'update:scope': [value: 'user' | 'server'];
    'update:warnSharing': [value: boolean];
}>();
</script>
