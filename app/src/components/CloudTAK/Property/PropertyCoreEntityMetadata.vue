<template>
    <div class='col-12'>
        <SlideDownHeader
            v-model='expanded'
            :label='t("property.coreEntityMetadata.title")'
        >
            <template #icon>
                <IconListDetails
                    :size='18'
                    stroke='1'
                    color='#6b7990'
                    class='ms-2 me-1'
                />
            </template>
            <template #right>
                <TablerIconButton
                    v-if='props.edit'
                    :title='t("property.coreEntityMetadata.add")'
                    class='me-2'
                    @click.stop='addEntry'
                >
                    <IconPlus
                        :size='20'
                        stroke='1'
                    />
                </TablerIconButton>
                <TablerBadge
                    class='me-2'
                    background-color='rgba(59, 130, 246, 0.15)'
                    border-color='rgba(59, 130, 246, 0.4)'
                    text-color='#3b82f6'
                >
                    {{ entries.length }}
                </TablerBadge>
            </template>

            <div class='overflow-hidden mb-2'>
                <div class='rounded mx-2 mt-2 px-2 py-2'>
                    <TablerNone
                        v-if='!entries.length && !creating'
                        :label='t("property.coreEntityMetadata.none")'
                        :compact='true'
                        :create='false'
                    />

                    <KeyValueRow
                        v-for='entry of entries'
                        :key='entry.key'
                        :name='entry.key'
                        :value='entry.display'
                    >
                        <template
                            v-if='props.edit'
                            #actions
                        >
                            <TablerIconButton
                                :title='t("property.coreEntityMetadata.remove")'
                                class='flex-shrink-0'
                                @click='removeEntry(entry.key)'
                            >
                                <IconTrash
                                    :size='18'
                                    stroke='1'
                                />
                            </TablerIconButton>
                        </template>
                    </KeyValueRow>

                    <div
                        v-if='creating'
                        class='rounded mt-2 px-2 py-2'
                    >
                        <div class='d-flex align-items-center mb-2'>
                            <div class='subheader user-select-none'>
                                {{ t('property.coreEntityMetadata.title') }}
                            </div>
                            <div class='ms-auto d-flex align-items-center flex-nowrap'>
                                <TablerIconButton
                                    :title='t("property.coreEntityMetadata.save")'
                                    @click='saveEntry'
                                >
                                    <IconCheck
                                        :size='18'
                                        stroke='1'
                                    />
                                </TablerIconButton>
                                <TablerIconButton
                                    :title='t("property.coreEntityMetadata.discard")'
                                    @click='creating = false'
                                >
                                    <IconTrash
                                        :size='18'
                                        stroke='1'
                                    />
                                </TablerIconButton>
                            </div>
                        </div>

                        <TablerInput
                            v-model='draft.key'
                            :label='t("property.coreEntityMetadata.key")'
                            class='pb-2'
                        />

                        <TablerInput
                            v-model='draft.value'
                            :label='t("property.coreEntityMetadata.value")'
                        />
                    </div>
                </div>
            </div>
        </SlideDownHeader>
    </div>
</template>

<script setup lang='ts'>
import { ref, computed } from 'vue';
import SlideDownHeader from '../util/SlideDownHeader.vue';
import KeyValueRow from '../util/KeyValueRow.vue';
import { TablerBadge, TablerInput, TablerIconButton, TablerNone } from '@tak-ps/vue-tabler';
import { IconListDetails, IconPlus, IconTrash, IconCheck } from '@tabler/icons-vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
    /** User defined key/value Event metadata */
    modelValue: Record<string, unknown>;
    edit?: boolean;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: Record<string, unknown>): void
}>();

const expanded = ref(false);
const creating = ref(false);
const draft = ref({ key: '', value: '' });

const entries = computed(() => {
    return Object.keys(props.modelValue).sort().map((key) => {
        const value = props.modelValue[key];

        return {
            key,
            display: typeof value === 'object' && value !== null
                ? JSON.stringify(value)
                : String(value)
        };
    });
});

function addEntry(): void {
    creating.value = true;
    draft.value = { key: '', value: '' };
    expanded.value = true;
}

function saveEntry(): void {
    const key = draft.value.key.trim();
    if (!key) return;

    emit('update:modelValue', {
        ...props.modelValue,
        [key]: draft.value.value
    });

    creating.value = false;
    draft.value = { key: '', value: '' };
}

function removeEntry(key: string): void {
    const metadata = { ...props.modelValue };
    delete metadata[key];
    emit('update:modelValue', metadata);
}
</script>
