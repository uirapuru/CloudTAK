<template>
    <TablerModal v-if='version'>
        <div class='modal-status bg-yellow' />
        <div class='modal-body text-body'>
            <h3 data-test='journal-notice-title'>
                {{ t('taklab.journalNotice.title') }}
            </h3>
            <p>{{ t('taklab.journalNotice.intro') }}</p>
            <ul>
                <li>{{ t('taklab.journalNotice.itemChat') }}</li>
                <li>{{ t('taklab.journalNotice.itemMap') }}</li>
                <li>{{ t('taklab.journalNotice.itemPosition') }}</li>
                <li>{{ t('taklab.journalNotice.itemFiles') }}</li>
            </ul>
            <p>{{ t('taklab.journalNotice.access') }}</p>
            <p>{{ t('taklab.journalNotice.retention') }}</p>
            <p class='mb-0'>
                {{ t('taklab.journalNotice.contact') }}
            </p>
            <div
                v-if='failed'
                class='alert alert-warning mt-3 mb-0'
            >
                {{ t('taklab.journalNotice.saveFailed') }}
            </div>
        </div>
        <div class='modal-footer'>
            <button
                class='btn btn-primary w-100'
                data-test='journal-notice-confirm'
                :disabled='saving'
                @click='confirm'
            >
                {{ t('taklab.journalNotice.confirm') }}
            </button>
        </div>
    </TablerModal>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { TablerModal } from '@tak-ps/vue-tabler';
import { useI18n } from 'vue-i18n';
import { acknowledgeJournalNotice, journalNoticeState } from '../../base/journal-notice.ts';

const { t } = useI18n();

// Text version the server asked to acknowledge; null = nothing to show.
const version = ref<string | null>(null);
const saving = ref(false);
const failed = ref(false);

onMounted(async () => {
    const state = await journalNoticeState();
    version.value = state ? state.version : null;
});

async function confirm(): Promise<void> {
    if (!version.value) return;
    if (failed.value) {
        // Second click after a failed save: close; the server shows it again next time.
        version.value = null;
        return;
    }
    saving.value = true;
    try {
        await acknowledgeJournalNotice(version.value);
        version.value = null;
    } catch {
        failed.value = true;
    } finally {
        saving.value = false;
    }
}
</script>
