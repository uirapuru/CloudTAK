<template>
    <TablerModal size='xl'>
        <button
            type='button'
            class='btn-close'
            aria-label='Close'
            @click='$emit("close")'
        />
        <div class='modal-status bg-yellow' />
        <div class='modal-header'>
            <div class='modal-title'>
                {{ t('shared.esriFilter.title') }}
            </div>
        </div>
        <div class='modal-body row g-2'>
            <TablerInput
                v-model='filter.query'
                :label='t("shared.esriFilter.sqlQuery")'
                :disabled='disabled'
            />

            <div class='d-flex px-4'>
                <div class='ms-auto'>
                    <button
                        class='btn btn-secondary'
                        @click='fetch'
                    >
                        {{ t('shared.esriFilter.testQuery') }}
                    </button>
                </div>
            </div>

            <TablerAlert
                v-if='err'
                :err='err'
                :title='t("shared.esriFilter.queryError")'
            />
            <TablerLoading
                v-if='loading.count'
                :desc='t("shared.esriFilter.loadingFeatures")'
            />
            <template v-else-if='list.features.features'>
                <pre v-text='features' />
            </template>
        </div>
        <div class='modal-footer'>
            <button
                class='btn me-auto'
                @click='$emit("close")'
            >
                {{ t('common.close') }}
            </button>
            <button
                class='btn btn-primary'
                @click='save'
            >
                {{ t('shared.esriFilter.saveFilter') }}
            </button>
        </div>
    </TablerModal>
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import { ref, computed } from 'vue';
import { std, stdurl } from '../../std.ts';
import {
    TablerAlert,
    TablerModal,
    TablerInput,
    TablerLoading
} from '@tak-ps/vue-tabler';

const { t } = useI18n();

const props = withDefaults(defineProps<{
    disabled?: boolean;
    modelValue?: string;
    layer?: string;
    token?: string;
}>(), {
    disabled: false,
    modelValue: '',
    layer: undefined,
    token: undefined,
});

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'update:modelValue', value: string): void;
}>();

const err = ref<Error | null>(null);
const loading = ref({
    count: false
});
const filter = ref({
    query: props.modelValue || ''
});
const list = ref<{
    count: number;
    features: { features: unknown[] };
}>({
    count: 0,
    features: { features: [] }
});

const features = computed(() => {
    return list.value.features.features.map((feat: unknown) => {
        return JSON.stringify(feat);
    }).join('\n');
});

function save() {
    emit('update:modelValue', filter.value.query);
    emit('close');
}

async function fetch() {
    err.value = null;
    loading.value.count = true;

    try {
        const url = stdurl('/api/esri/server/layer');
        url.searchParams.set('query', filter.value.query);
        if (props.layer) url.searchParams.set('layer', props.layer);
        if (props.token) url.searchParams.set('token', props.token);

        list.value = await std(url, {
            method: 'GET',
        }) as typeof list.value;
    } catch (error) {
        err.value = error instanceof Error ? error : new Error(String(error));
    }

    loading.value.count = false;
}
</script>
