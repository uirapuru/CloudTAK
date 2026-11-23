<template>
    <div class='page page-center user-select-none'>
        <div class='container container-normal py-4'>
            <div class='row align-items-center g-4'>
                <div class='col-lg'>
                    <div class='container-tight'>
                        <div class='card card-md'>
                            <div class='card-body'>
                                <div
                                    class='text-center'
                                    style='margin-bottom: 24px;'
                                >
                                    <img
                                        :alt='t("login.loading.agencyLogo")'
                                        :src='logo'
                                        draggable='false'
                                        style='height: 150px;'
                                    >
                                </div>
                                <TablerLoading :desc='t("login.loading.loadingCloudtak")' />
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
                                            {{ t('login.loading.hardReset') }}
                                        </button>
                                        <div
                                            class='text-muted mt-1'
                                            style='font-size: 0.8rem;'
                                        >
                                            {{ t('login.loading.hardResetHint') }}
                                        </div>
                                    </div>
                                </Transition>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang='ts'>
import Config from '../base/config.ts';
import { supportsServiceWorker } from '../utils/capacitor.ts';
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n';

const props = defineProps<{
    stage?: string;
}>();
import {
    TablerLoading
} from '@tak-ps/vue-tabler'

const { t } = useI18n();

const logo = ref('/CloudTAKLogo.svg');
const showReset = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;

async function hardReset(): Promise<void> {
    if (supportsServiceWorker()) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
            await registration.unregister();
        }
    }

    location.reload();
}

onMounted(async () => {
    // Armed before any awaits so a hung logo lookup can't block it.
    resetTimer = setTimeout(() => {
        showReset.value = true;
    }, 20000);

    try {
        const config = await Config.list(['login::logo']);

        if (config['login::logo']) {
            logo.value = config['login::logo'];
        }
    } catch (err) {
        console.warn('Failed to load login logo', err);
    }
});

onUnmounted(() => {
    clearTimeout(resetTimer);
});
</script>
