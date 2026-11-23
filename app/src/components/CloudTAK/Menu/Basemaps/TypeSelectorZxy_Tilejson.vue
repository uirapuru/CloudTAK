<template>
    <div class='row row-cards'>
        <TypeSelectorSelected
            type='tilejson'
            @change-type='emit("change-type")'
        />

        <div class='col-md-12 mt-3'>
            <TablerInput
                :model-value='url'
                :label='t("basemaps.types.tilejson.urlLabel")'
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
                    >{{ t('basemaps.tilejson.fetch') }}</a>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang='ts'>
import TypeSelectorSelected from './TypeSelectorSelected.vue';
import { TablerInput } from '@tak-ps/vue-tabler';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

defineProps<{
    url: string;
}>();

const emit = defineEmits<{
    'change-type': [];
    'fetch': [];
    'update:url': [value: string];
}>();
</script>
