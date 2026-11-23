<template>
    <div class='datagrid-item'>
        <div class='datagrid-title'>
            {{ t('shared.certificateInfo.validFrom') }}
        </div>
        <div
            class='datagrid-content'
            v-text='certificate?.validFrom || t("shared.common.unknown")'
        />
    </div>
    <div class='datagrid-item'>
        <div class='datagrid-title'>
            {{ t('shared.certificateInfo.validTo') }}
        </div>
        <div class='datagrid-content d-flex align-items-center gap-2'>
            <div v-text='certificate?.validTo || t("shared.common.unknown")' />
            <CertificateBadge
                class='ms-auto'
                :certificate='certificate'
                :expired-label='t("shared.certificateInfo.expiredCertificate")'
            />
        </div>
    </div>
    <div class='datagrid-item'>
        <div class='datagrid-title'>
            {{ t('shared.certificateInfo.subject') }}
        </div>
        <div
            class='datagrid-content'
            v-text='certificate?.subject || t("shared.common.unknown")'
        />
    </div>
    <div class='datagrid-item'>
        <div class='datagrid-title'>
            Channels Enabled
        </div>
        <div class='datagrid-content'>
            <CertificateChannelsBadge
                v-if='typeof certificate?.channels === "boolean"'
                :certificate='certificate'
                enabled-label='Enabled'
                disabled-label='Disabled'
            />
            <span
                v-else
                v-text='"Unknown"'
            />
        </div>
    </div>
</template>

<script setup lang='ts'>
/**
 * Generic certificate datagrid items (Valid From / Valid To + expiry badge / Subject / Channels)
 * Must be rendered inside a `.datagrid` container
 */
import { useI18n } from 'vue-i18n';
import CertificateBadge from './CertificateBadge.vue';
import CertificateChannelsBadge from './CertificateChannelsBadge.vue';
import type { CertificateMetadata } from '../../utils/certificate.ts';

withDefaults(defineProps<{
    certificate?: CertificateMetadata | null;
}>(), {
    certificate: null,
});

const { t } = useI18n();
</script>
