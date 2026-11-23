<template>
    <TablerDropdown
        position='bottom-start'
        width='100%'
    >
        <template #default>
            <button
                type='button'
                class='form-control d-flex align-items-center cursor-pointer text-start'
            >
                <span class='flex-fill text-truncate'>{{ modelValue && modelValue !== 'All Tasks' ? modelValue : t('shared.taskFilter.allTasks') }}</span>
                <IconChevronDown
                    :size='16'
                    stroke='1'
                    class='ms-2 flex-shrink-0 text-muted'
                />
            </button>
        </template>
        <template #dropdown>
            <div style='min-width: 260px;'>
                <div class='px-2 py-2 border-bottom'>
                    <TablerInput
                        v-model='search'
                        :placeholder='t("shared.taskFilter.search")'
                        :autofocus='true'
                        class='mb-0'
                        @click.stop
                    />
                </div>
                <div
                    class='overflow-auto'
                    style='max-height: 300px;'
                >
                    <div
                        class='px-3 py-2 cursor-pointer cloudtak-hover user-select-none'
                        :class='{ "fw-bold": !modelValue || modelValue === "All Tasks" }'
                        @click='select(undefined)'
                    >
                        {{ t('shared.taskFilter.allTasks') }}
                    </div>
                    <div
                        v-for='task in filtered'
                        :key='task'
                        class='px-3 py-2 cursor-pointer cloudtak-hover user-select-none text-truncate'
                        :class='{ "fw-bold": modelValue === task }'
                        @click='select(task)'
                    >
                        {{ task }}
                    </div>
                    <TablerNone
                        v-if='!filtered.length && search'
                        :compact='true'
                        :create='false'
                        :label='t("shared.taskFilter.none")'
                    />
                </div>
            </div>
        </template>
    </TablerDropdown>
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import { ref, computed } from 'vue';
import { IconChevronDown } from '@tabler/icons-vue';
import {
    TablerInput,
    TablerDropdown,
    TablerNone,
} from '@tak-ps/vue-tabler';

const { t } = useI18n();

const props = withDefaults(defineProps<{
    modelValue?: string;
    tasks: string[];
}>(), {
    modelValue: undefined,
});

const emit = defineEmits<{
    (e: 'update:modelValue', value: string | undefined): void;
}>();

const search = ref('');

const filtered = computed<string[]>(() => {
    const query = search.value.trim().toLowerCase();
    if (!query) return props.tasks;
    return props.tasks.filter((task) => task.toLowerCase().includes(query));
});

function select(task: string | undefined): void {
    search.value = '';
    emit('update:modelValue', task);
}
</script>
