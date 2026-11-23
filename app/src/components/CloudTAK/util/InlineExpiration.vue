<template>
    <div :class='containerClass'>
        <TablerBorder
            :class='["cloudtak-accent", borderClass]'
            :background='background'
            :shadow='shadow'
            :fill-height='fillHeight'
            :gap='gap'
        >
            <template #label>
                <small :class='labelClass'>{{ label ?? t('util.inlineExpiration.label') }}</small>
            </template>
            <template
                v-if='editable && !editing'
                #tools
            >
                <TablerIconButton
                    :title='editTitle ?? t("util.inlineExpiration.edit")'
                    @click.stop.prevent='emit("edit")'
                >
                    <IconPencil
                        :size='24'
                        stroke='1'
                    />
                </TablerIconButton>
            </template>
            <template
                v-else-if='editing'
                #tools
            >
                <div class='d-flex gap-1'>
                    <TablerIconButton
                        :disabled='saving'
                        color='rgba(var(--tblr-primary-rgb), 0.14)'
                        :title='saving ? (savingLabel ?? t("util.common.saving")) : (saveLabel ?? t("common.save"))'
                        @click.stop='commitDraft'
                    >
                        <IconDeviceFloppy
                            color='rgb(var(--tblr-primary-rgb))'
                            stroke='1'
                        />
                    </TablerIconButton>
                    <TablerIconButton
                        v-if='showClear'
                        :disabled='saving'
                        :title='clearLabel ?? t("util.common.clear")'
                        @click.stop='emit("clear")'
                    >
                        <IconTrash stroke='1' />
                    </TablerIconButton>
                    <TablerIconButton
                        :disabled='saving'
                        :title='t("common.cancel")'
                        @click.stop='revertDraft'
                    >
                        <IconX stroke='1' />
                    </TablerIconButton>
                </div>
            </template>

            <template v-if='editing'>
                <TablerInput
                    :label='inputLabel ?? t("util.inlineExpiration.inputLabel")'
                    type='datetime-local'
                    :model-value='draftValue'
                    @update:model-value='draftValue = String($event || "")'
                />
            </template>

            <button
                v-else-if='value && interactive'
                type='button'
                :class='displayClass'
                @click.stop='emit("displayClick")'
                v-text='value'
            />
            <p
                v-else-if='value'
                :class='displayClass'
                v-text='value'
            />
            <p
                v-else
                :class='emptyClass'
            >
                {{ emptyLabel ?? t('util.common.none') }}
            </p>
        </TablerBorder>
    </div>
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import { IconDeviceFloppy, IconPencil, IconTrash, IconX } from '@tabler/icons-vue';
import { TablerBorder, TablerIconButton, TablerInput } from '@tak-ps/vue-tabler';
import { ref, watch } from 'vue';

const { t } = useI18n();

const props = withDefaults(defineProps<{
    value?: string | null;
    modelValue: string;
    editing: boolean;
    editable?: boolean;
    label?: string;
    editTitle?: string;
    containerClass?: string;
    borderClass?: string;
    labelClass?: string;
    background?: string;
    shadow?: boolean;
    fillHeight?: boolean;
    gap?: string;
    saving?: boolean;
    inputLabel?: string;
    emptyLabel?: string;
    emptyClass?: string;
    displayClass?: string;
    interactive?: boolean;
    showClear?: boolean;
    clearLabel?: string;
    saveLabel?: string;
    savingLabel?: string;
}>(), {
    value: null,
    editable: false,
    label: undefined,
    editTitle: undefined,
    containerClass: 'col-12',
    borderClass: undefined,
    labelClass: 'text-uppercase text-secondary d-block mb-0',
    background: '',
    shadow: false,
    fillHeight: false,
    gap: 'sm',
    saving: false,
    inputLabel: undefined,
    emptyLabel: undefined,
    emptyClass: 'text-start fw-semibold p-0 mb-0 text-decoration-none',
    displayClass: 'text-start fw-semibold p-0 mb-0 text-decoration-none',
    interactive: false,
    showClear: true,
    clearLabel: undefined,
    saveLabel: undefined,
    savingLabel: undefined
});

const emit = defineEmits<{
    'update:modelValue': [value: string];
    edit: [];
    cancel: [];
    clear: [];
    save: [value: string];
    displayClick: [];
}>();

const draftValue = ref(props.modelValue);

watch(() => props.modelValue, (modelValue) => {
    if (!props.editing) draftValue.value = modelValue;
}, { immediate: true });

watch(() => props.editing, (editing) => {
    if (editing) draftValue.value = props.modelValue;
});

function commitDraft(): void {
    emit('update:modelValue', draftValue.value);
    emit('save', draftValue.value);
}

function revertDraft(): void {
    draftValue.value = props.modelValue;
    emit('cancel');
}
</script>