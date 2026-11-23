<template>
    <TablerModal>
        <div class='modal-status bg-yellow' />
        <button
            type='button'
            class='btn-close'
            :aria-label='t("common.close")'
            @click='$emit("close")'
        />
        <div class='modal-header'>
            <div class='modal-title'>
                {{ t('panels.passkeyModal.title') }}
            </div>
            <div class='ms-auto btn-list'>
                <TablerDelete
                    displaytype='icon'
                    @delete='deletePasskey'
                />
            </div>
        </div>
        <div class='modal-body row g-2'>
            <div class='col-12'>
                <label class='form-label'>{{ t('panels.passkeyModal.name') }}</label>
                <div v-text='passkey.name || t("panels.passkeyModal.unnamed")' />
            </div>
            <div class='col-12'>
                <label class='form-label'>{{ t('panels.passkeyModal.created') }}</label>
                <div v-text='new Date(passkey.created).toLocaleString()' />
            </div>
            <div class='col-12'>
                <label class='form-label'>{{ t('panels.passkeyModal.lastUsed') }}</label>
                <div v-text='passkey.last_used ? new Date(passkey.last_used).toLocaleString() : t("panels.passkeyModal.never")' />
            </div>
        </div>
        <div class='modal-footer'>
            <button
                class='btn btn-primary'
                @click='$emit("close")'
            >
                {{ t('common.close') }}
            </button>
        </div>
    </TablerModal>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { server } from '../../../../std.ts';
import {
    TablerModal,
    TablerDelete,
} from '@tak-ps/vue-tabler';

const props = defineProps<{
    passkey: {
        id: number;
        name: string;
        credential_id: string;
        created: string;
        last_used: string | null;
    };
}>();

const emit = defineEmits(['close', 'refresh']);
const { t } = useI18n();

async function deletePasskey() {
    const { error } = await server.DELETE('/api/login/passkey/{:id}', {
        params: {
            path: {
                ':id': props.passkey.id,
            }
        }
    });

    if (error) throw new Error(error.message);

    emit('refresh');
}
</script>
