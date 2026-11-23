<template>
    <div
        v-if='enabled'
        class='ptt-dock d-flex flex-column align-items-center gap-1'
    >
        <div
            v-if='voice.state.error'
            class='ptt-note bg-dark text-white small px-2 py-1 rounded'
            v-text='voice.state.error'
        />
        <button
            v-else-if='voice.state.listening && voice.state.audioLocked'
            class='ptt-note btn btn-sm btn-dark'
            @click='voice.unlock()'
        >
            {{ t('taklab.ptt.unlockAudio') }}
        </button>

        <button
            class='ptt-button'
            :class='`ptt-${view.state}`'
            :disabled='view.state === "busy" || view.state === "unavailable"'
            :title='title'
            :aria-pressed='view.state === "transmitting"'
            @pointerdown.prevent='onDown'
            @pointerup='onUp'
            @pointercancel='onUp'
            @lostpointercapture='onUp'
            @contextmenu.prevent
        >
            <IconMicrophone
                :size='30'
                stroke='2'
            />
            <span
                class='ptt-label'
                v-text='label'
            />
        </button>

        <div class='ptt-controls d-flex align-items-center gap-1'>
            <select
                class='form-select form-select-sm'
                :value='voice.state.channel || ""'
                :disabled='!voice.state.channels.length || view.state === "transmitting"'
                :title='t("taklab.ptt.channel")'
                @change='voice.setChannel(($event.target as HTMLSelectElement).value || null)'
            >
                <option
                    v-for='c in voice.state.channels'
                    :key='c'
                    :value='c'
                    v-text='c'
                />
            </select>
            <TablerIconButton
                :title='voice.state.listening ? t("taklab.ptt.listenOff") : t("taklab.ptt.listenOn")'
                class='bg-dark rounded'
                @click='voice.setListening(!voice.state.listening)'
            >
                <IconVolume
                    v-if='voice.state.listening'
                    :size='20'
                    stroke='1'
                    color='white'
                />
                <IconVolumeOff
                    v-else
                    :size='20'
                    stroke='1'
                    color='white'
                />
            </TablerIconButton>
        </div>
    </div>
</template>

<script setup lang='ts'>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconMicrophone, IconVolume, IconVolumeOff } from '@tabler/icons-vue';
import { TablerIconButton } from '@tak-ps/vue-tabler';
import { std } from '../../std.ts';
import VoiceLive from '../../base/voice-live.ts';
import { pttState } from '../../base/voice-audio.ts';

const { t } = useI18n();

const voice = new VoiceLive();
const enabled = ref(false);

const view = computed(() => pttState({
    connected: voice.state.connected,
    ptt: voice.state.ptt,
    channel: voice.state.channel,
    speaking: voice.state.speaking,
    own: voice.state.name,
    requesting: voice.state.requesting,
    transmitting: voice.state.transmitting,
}));

const label = computed(() => {
    switch (view.value.state) {
        case 'transmitting': return t('taklab.ptt.transmitting');
        case 'requesting': return t('taklab.ptt.wait');
        case 'busy': return view.value.speaker || t('taklab.ptt.busy');
        default: return 'PTT';
    }
});

const title = computed(() => {
    switch (view.value.state) {
        case 'busy': return t('taklab.ptt.busyTitle', { speaker: view.value.speaker });
        case 'unavailable':
            if (!voice.state.connected) return t('taklab.ptt.noConnection');
            if (!voice.state.ptt) return t('taklab.ptt.pttDisabled');
            return t('taklab.ptt.selectChannel');
        case 'transmitting': return t('taklab.ptt.transmittingTitle');
        default: return t('taklab.ptt.idleTitle');
    }
});

onMounted(async () => {
    try {
        const status = await std('/api/voice/status') as { enabled: boolean };
        enabled.value = status.enabled;
    } catch {
        enabled.value = false;
    }
    if (enabled.value) await voice.start();
});

onUnmounted(() => voice.close());

function onDown(ev: PointerEvent): void {
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
    voice.press().catch(() => undefined);
}

function onUp(): void {
    voice.release();
}
</script>

<style scoped>
.ptt-dock {
    position: absolute;
    /* Stała szerokość: podpowiedzi nad przyciskiem nie przesuwają go w bok. */
    width: 150px;
    z-index: 3;
    right: calc(var(--map-side-offset, 0px) + 16px + env(safe-area-inset-right, 0px));
    bottom: calc(var(--map-gps-panel-size, 84px) + 24px + var(--map-bottom-inset, 0px));
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
}

.ptt-button {
    width: 96px;
    height: 96px;
    border-radius: 50%;
    border: 3px solid rgba(0, 0, 0, 0.55);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    font-weight: 700;
    font-size: 0.8rem;
    letter-spacing: 0.04em;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
    transition: background-color 0.08s ease, transform 0.08s ease;
    cursor: pointer;
}

.ptt-label {
    max-width: 84px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ptt-idle {
    background: #ffd400;
    color: #1a1a1a;
}

.ptt-idle:hover {
    background: #ffe14d;
}

.ptt-requesting {
    background: #ff9800;
    color: #1a1a1a;
    transform: scale(0.96);
}

.ptt-transmitting {
    background: #e53935;
    color: #fff;
    transform: scale(0.96);
    animation: ptt-pulse 1s ease-in-out infinite;
}

.ptt-busy,
.ptt-unavailable {
    background: #8a8f96;
    color: #f1f1f1;
    cursor: not-allowed;
}

.ptt-unavailable {
    opacity: 0.6;
}

.ptt-controls select {
    max-width: 130px;
}

.ptt-note {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    width: max-content;
    max-width: 220px;
    text-align: center;
}

@keyframes ptt-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(229, 57, 53, 0.7); }
    50% { box-shadow: 0 0 0 14px rgba(229, 57, 53, 0); }
}
</style>
