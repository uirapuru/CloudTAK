<template>
    <TablerModal
        :fade='false'
    >
        <div
            class='modal-body rounded user-select-none'
        >
            <div
                class='text-center'
                style='margin-bottom: 24px;'
            >
                <img
                    :alt='t("map.mapLoading.agencyLogo")'
                    :src='logo'
                    style='height: 150px;'
                >
            </div>
            <TablerLoading :desc='t("map.mapLoading.loadingState")' />
            <Transition
                name='stage-fade'
                mode='out-in'
            >
                <div
                    v-if='props.stage'
                    :key='props.stage'
                    class='text-center text-muted mt-1'
                    style='font-size: 0.85rem;'
                    v-text='props.stage'
                />
            </Transition>
            <Transition name='reset-fade'>
                <div
                    v-if='showReset'
                    class='text-center mt-3'
                >
                    <button
                        class='btn btn-danger'
                        @click='hardReset'
                    >
                        {{ t('map.mapLoading.hardReset') }}
                    </button>
                    <div
                        class='text-muted mt-1'
                        style='font-size: 0.8rem;'
                    >
                        {{ t('map.mapLoading.hardResetHint') }}
                    </div>
                </div>
            </Transition>
        </div>
    </TablerModal>
</template>

<script setup lang='ts'>
import Config from '../../base/config.ts';
import { supportsServiceWorker, addBackgroundStateListener } from '../../utils/capacitor.ts';
import { ref, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import {
    TablerModal,
    TablerLoading
} from '@tak-ps/vue-tabler'

const props = defineProps<{
    stage?: string;
}>();

const { t } = useI18n();

const RESET_PROMPT_MS = 20000;

const logo = ref('/CloudTAKLogo.svg');
const showReset = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;
let removeBackgroundListener: (() => void) | undefined;

async function hardReset(): Promise<void> {
    if (supportsServiceWorker()) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
            await registration.unregister();
        }
    }
    location.reload();
}

function startResetTimer(): void {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
        showReset.value = true;
    }, RESET_PROMPT_MS);
}

onMounted(async () => {
    startResetTimer();

    // Count only foreground time - a timer that expired during sleep would
    // show "Hard Reset" the moment the app resumes
    removeBackgroundListener = await addBackgroundStateListener((isBackgrounded) => {
        if (showReset.value) return;

        if (isBackgrounded) {
            clearTimeout(resetTimer);
        } else {
            startResetTimer();
        }
    });

    try {
        const config = await Config.list(['login::logo']);

        if (config['login::logo']) {
            logo.value = config['login::logo'];
        }
    } catch (err) {
        console.warn('Failed to load custom logo', err);
    }
});

onUnmounted(() => {
    clearTimeout(resetTimer);
    if (removeBackgroundListener) removeBackgroundListener();
});
</script>
