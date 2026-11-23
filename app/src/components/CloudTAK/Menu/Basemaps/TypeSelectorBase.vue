<template>
    <TypeSelectorSelected
        v-if='showSelectedBanner'
        :type='type'
        @change-type='emit("change-type")'
    />

    <TablerInlineAlert
        v-if='warnSharing'
        severity='danger'
        :title='t("basemaps.base.sharingWarnTitle")'
        :description='t("basemaps.base.sharingWarnDescription")'
        :dismissable='true'
    />

    <div class='col-12 mt-3'>
        <TablerInput
            v-model='editing.name'
            required
            :label='t("basemaps.base.name")'
            :error='errors.name'
        >
            <TablerToggle
                v-model='editing.sharing_enabled'
                :label='t("basemaps.base.enableSharing")'
                @change='emit("update:warnSharing", !editing.sharing_enabled)'
            />
        </TablerInput>
    </div>
    <div
        v-if='isSystemAdmin'
        class='col-12 mt-3'
    >
        <TablerPillGroup
            :model-value='editing.overlay ? "overlay" : "basemap"'
            :options='[
                { value: "basemap", label: t("basemaps.common.basemap") },
                { value: "overlay", label: t("basemaps.common.overlay") }
            ]'
            @update:model-value='(v: string) => editing.overlay = v === "overlay"'
        >
            <template #option='{ option }'>
                <IconMap
                    v-if='option.value === "basemap"'
                    :size='20'
                    stroke='1'
                />
                <IconStack2
                    v-else
                    :size='20'
                    stroke='1'
                />
                <span class='mx-2'>{{ option.label }}</span>
            </template>
        </TablerPillGroup>
    </div>
    <div class='col-md-12'>
        <TablerInput
            v-model='editing.url'
            required
            :label='t(`basemaps.types.${type}.urlLabel`)'
            :description='t(`basemaps.types.${type}.urlDescription`)'
            :placeholder='config.urlPlaceholder'
            :error='errors.url'
        >
            <div
                v-if='config.urlTokens.length'
                class='btn-list'
            >
                <TablerBadge
                    v-for='token in config.urlTokens'
                    :key='token.value'
                    :title='t(`basemaps.tokens.${token.value.replace(/[^a-zA-Z0-9]+/g, "")}`)'
                    class='cursor-pointer'
                    background-color='rgba(6, 182, 212, 0.15)'
                    border-color='rgba(6, 182, 212, 0.4)'
                    text-color='#0891b2'
                    @click='editing.url = editing.url + token.value'
                >
                    {{ token.value }}
                </TablerBadge>
            </div>
        </TablerInput>
    </div>

    <label
        class='subheader mt-3 cursor-pointer'
        @click='advanced = !advanced'
    >
        <IconSquareChevronRight
            v-if='!advanced'
            :size='32'
            stroke='1'
        />
        <IconChevronDown
            v-else
            :size='32'
            stroke='1'
        />
        {{ t('basemaps.base.advanced') }}
    </label>

    <div
        v-if='advanced'
        class='col-12'
    >
        <div class='row g-2'>
            <div
                v-if='showTypeField'
                class='col-12 mt-3'
            >
                <TablerEnum
                    v-model='editing.type'
                    required
                    :label='t("basemaps.base.type")'
                    :options='["raster", "raster-dem", "vector"]'
                />
            </div>
            <div
                v-if='editing.type === "raster-dem"'
                class='col-12 mt-3'
            >
                <TablerEnum
                    v-model='editing.encoding'
                    :label='t("basemaps.base.terrainEncoding")'
                    :options='["mapbox", "terrarium"]'
                />
            </div>
            <div
                v-if='isSystemAdmin'
                class='col-12 mt-3'
            >
                <TranslatedEnum
                    :model-value='scope'
                    required
                    :label='t("basemaps.base.accessScope")'
                    :options='[
                        { value: "user", label: t("basemaps.base.scopeUser") },
                        { value: "server", label: t("basemaps.base.scopeServer") }
                    ]'
                    @update:model-value='emit("update:scope", $event as "user" | "server")'
                />
            </div>
            <SelectBasemapCollection
                v-model='editing.collection'
                :overlay='editing.overlay'
            />
            <div class='col-12'>
                <TablerInput
                    v-model='editing.attribution'
                    :label='t("basemaps.base.attribution")'
                    :placeholder='t("basemaps.base.attributionPlaceholder")'
                />
            </div>

            <div
                v-if='editing.type === "vector" && vectorLayers.length'
                class='col-12'
            >
                <HandleForm
                    v-model='vectorTitleField'
                    :label='t("basemaps.base.titleField")'
                    :description='t("basemaps.base.titleFieldDescription")'
                    :schema='vectorTitleSchema'
                />
            </div>

            <slot name='advanced' />

            <template v-if='isSystemAdmin'>
                <div class='col-12'>
                    <TablerToggle
                        v-model='editing.hidden'
                        :label='t("basemaps.base.hidden")'
                        :description='t("basemaps.base.hiddenDescription")'
                    >
                        <TablerBadge>admin</TablerBadge>
                    </TablerToggle>
                </div>
                <div class='col-12'>
                    <TablerInput
                        v-if='editing.frequency !== undefined && editing.frequency !== null'
                        v-model='editing.frequency'
                        :label='t("basemaps.base.frequency")'
                        :description='t("basemaps.base.frequencyDescription")'
                    >
                        <TablerBadge>admin</TablerBadge>
                        <TablerToggle
                            :model-value='true'
                            :label='t("basemaps.base.enabled")'
                            @click='editing.frequency = null'
                        />
                    </TablerInput>
                    <div v-else>
                        <TablerToggle
                            :model-value='false'
                            :label='t("basemaps.base.enableFrequency")'
                            :description='t("basemaps.base.enableFrequencyDescription")'
                            @click='editing.frequency = 60'
                        >
                            <TablerBadge>admin</TablerBadge>
                        </TablerToggle>
                    </div>
                </div>
                <div
                    v-if='editing.type === "vector"'
                    class='col-12'
                >
                    <div class='row g-2 my-2 border rounded'>
                        <div class='col-12'>
                            <TablerToggle
                                v-model='editing.snapping_enabled'
                                :label='t("basemaps.base.enableSnapping")'
                                :description='t("basemaps.base.enableSnappingDescription")'
                            >
                                <TablerBadge>admin</TablerBadge>
                            </TablerToggle>
                        </div>
                        <div
                            v-if='editing.snapping_enabled'
                            class='col-12'
                        >
                            <TablerEnum
                                v-if='vectorLayerOptions.length'
                                v-model='editing.snapping_layer'
                                :label='t("basemaps.base.snappingLayer")'
                                :description='t("basemaps.base.snappingLayerChoose")'
                                :options='vectorLayerOptions'
                            />
                            <TablerInput
                                v-else
                                v-model='editing.snapping_layer'
                                :label='t("basemaps.base.snappingLayer")'
                                :description='t("basemaps.base.snappingLayerName")'
                            />
                        </div>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang='ts'>
import { computed, ref } from 'vue';
import {
    TablerBadge,
    TablerInlineAlert,
    TablerPillGroup,
    TablerToggle,
    TablerEnum,
    TablerInput,
} from '@tak-ps/vue-tabler';
import { IconChevronDown, IconMap, IconSquareChevronRight, IconStack2 } from '@tabler/icons-vue';
import HandleForm from '../../../util/HandleForm.vue';
import SelectBasemapCollection from '../../util/SelectBasemapCollection.vue';
import TypeSelectorSelected from './TypeSelectorSelected.vue';
import TranslatedEnum from '../../util/TranslatedEnum.vue';
import { BasemapTypeConfig } from './types.ts';
import type { BasemapSourceType, EditingBasemap, VectorLayerDescriptor } from './types.ts';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const editing = defineModel<EditingBasemap>('editing', { required: true });

const props = defineProps<{
    basemapId?: number;
    vectorLayers: VectorLayerDescriptor[];
    errors: Record<'name' | 'url', string>;
    type: BasemapSourceType;
    scope: 'user' | 'server';
    warnSharing: boolean;
    isSystemAdmin: boolean;
}>();

const emit = defineEmits<{
    'change-type': [];
    'update:scope': [value: 'user' | 'server'];
    'update:warnSharing': [value: boolean];
}>();

const config = BasemapTypeConfig[props.type];
const showSelectedBanner = computed(() => !props.basemapId);
const showTypeField = computed(() => {
    return props.type !== 'featureserver'
        && props.type !== 'mapserver'
        && props.type !== 'imageserver';
});
const advanced = ref(false);

const vectorTitleSchema = computed(() => {
    const fields = new Set<string>();

    for (const layer of props.vectorLayers || []) {
        for (const field of Object.keys(layer.fields || {})) {
            fields.add(field);
        }
    }

    return {
        type: 'object',
        properties: Object.fromEntries(Array.from(fields).sort().map((field) => {
            return [field, { type: 'string' }];
        }))
    };
});

const vectorTitleField = computed({
    get: () => {
        return editing.value.title || '';
    },
    set: (value: string) => {
        editing.value.title = value.trim();
    }
});

const vectorLayerOptions = computed(() => {
    const ids = new Set<string>();

    for (const layer of props.vectorLayers || []) {
        if (layer.id) ids.add(layer.id);
    }

    const current = editing.value.snapping_layer;
    if (current) ids.add(current);

    return Array.from(ids).sort();
});
</script>
