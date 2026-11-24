<template>
    <MenuTemplate
        :name='subscription ? subscription.meta.name : t("panels.mission.dataSync")'
        :loading='(!subscription && !error) || loading'
        :scroll='false'
    >
        <template #header='{ isModal }'>
            <div
                v-if='subscription && subscription.subscribed'
                class='mission-name flex-grow-1 text-break'
                :class='isModal ? "modal-title px-1" : "strong px-2"'
                style='min-width: 0'
                role='button'
                tabindex='0'
                :title='t("panels.mission.zoom")'
                @click='zoomToFeatures'
                @keydown.enter.prevent='zoomToFeatures'
                v-text='subscription.meta.name'
            />
            <div
                v-else
                class='flex-grow-1 text-break user-select-none'
                :class='isModal ? "modal-title px-1" : "strong px-2"'
                style='min-width: 0'
                v-text='subscription ? subscription.meta.name : t("panels.mission.dataSync")'
            />
        </template>
        <template #buttons>
            <TablerDelete
                v-if='!loading && subscription && subscription.subscribed && subscription.role.permissions.includes("MISSION_DELETE")'
                :title='t("common.delete")'
                :label='t("panels.mission.deleteLabel", { name: subscription.meta.name || t("panels.mission.dataSync") })'
                displaytype='icon'
                :match='t("panels.mission.deleteMatch")'
                @delete='deleteMission'
            />
            <TablerDropdown
                v-if='subscription && subscription.subscribed'
            >
                <TablerIconButton
                    :title='t("panels.mission.moreOptions")'
                >
                    <IconDotsVertical
                        :size='20'
                        stroke='1'
                    />
                </TablerIconButton>

                <template #dropdown>
                    <div class='col-12'>
                        <div
                            class='cursor-pointer col-12 cloudtak-hover d-flex align-items-center px-2 py-2'
                            @click.stop='shareToPackageSetup'
                        >
                            <IconPackages
                                :size='32'
                                stroke='1'
                            />
                            <span class='mx-2'>{{ t('panels.mission.exportPackage') }}</span>
                        </div>
                        <div
                            class='cursor-pointer col-12 cloudtak-hover d-flex align-items-center px-2 py-2'
                            @click.stop='exportToPackage("geojson")'
                        >
                            <IconFile
                                :size='32'
                                stroke='1'
                            />
                            <span class='mx-2'>{{ t('panels.mission.exportGeojson') }}</span>
                        </div>
                        <div
                            class='cursor-pointer col-12 cloudtak-hover d-flex align-items-center px-2 py-2'
                            @click.stop='exportToPackage("kml")'
                        >
                            <IconFile
                                :size='32'
                                stroke='1'
                            />
                            <span class='mx-2'>{{ t('panels.mission.exportKml') }}</span>
                        </div>
                        <div
                            class='cursor-pointer col-12 cloudtak-hover d-flex align-items-center px-2 py-2'
                            @click.stop='exportToPackage("zip")'
                        >
                            <IconFileZip
                                :size='32'
                                stroke='1'
                            />
                            <span class='mx-2'>{{ t('panels.mission.downloadArchive') }}</span>
                        </div>
                        <div
                            v-if='reportButtonVisible(subscription, mapStore.menu.canSeeReport.value)'
                            class='cursor-pointer col-12 cloudtak-hover d-flex align-items-center px-2 py-2'
                            data-testid='mission-report'
                            @click.stop='openReport'
                        >
                            <IconReportAnalytics
                                :size='32'
                                stroke='1'
                            />
                            <span class='mx-2'>{{ t('report.menuButton') }}</span>
                        </div>
                    </div>
                </template>
            </TablerDropdown>
            <TablerRefreshButton
                :loading='(!subscription && !error) || loading'
                @click='fetchMission(true)'
            />
        </template>
        <template #default>
            <TablerLoading
                v-if='loadingInline'
                :desc='loadingInline'
                :compact='true'
            />
            <TablerAlert
                v-else-if='error'
                :err='error'
            />
            <template v-else>
                <div
                    v-if='subscription && subscription.subscribed'
                    ref='tabs'
                >
                    <TablerPillGroup
                        :model-value='String(route.name)'
                        :options='missionTabs'
                        @update:model-value='navigateMissionTab'
                    >
                        <template #option='{ option }'>
                            <span
                                class='d-inline-flex align-items-center'
                                :title='option.label'
                            >
                                <component
                                    :is='missionTabIcons[option.value]'
                                    :size='32'
                                    stroke='1'
                                />
                                <span
                                    v-if='showTabLabels'
                                    class='ms-1'
                                    v-text='option.label'
                                />
                            </span>
                        </template>
                    </TablerPillGroup>
                </div>

                <Suspense>
                    <router-view
                        v-if='subscription'
                        :subscription='subscription'
                        @subscribed='subscribedChanged'
                    />

                    <template #fallback>
                        <TablerLoading />
                    </template>
                </Suspense>
            </template>
        </template>
    </MenuTemplate>

    <ShareToPackage
        v-if='shareToPackage.shown && subscription'
        :name='`${new Date().toISOString().replace(/T.*/, "")} ${subscription ? subscription.meta.name : t("panels.mission.mission")}`'
        :feats='shareToPackage.features'
        @close='shareToPackage.shown = false'
    />
</template>

<script setup lang='ts'>
import { ref, computed, triggerRef, onMounted, onBeforeUnmount, watch, useTemplateRef } from 'vue';
import { useElementSize } from '@vueuse/core';
import { std } from '../../../std.ts';
import type { Feature } from '../../../types.ts';
import type { Component } from 'vue';
import Subscription from '../../../base/subscription.ts';
import {
    IconFile,
    IconPackages,
    IconFileZip,
    IconBoxMultiple,
    IconDotsVertical,
    IconArticle,
    IconTimeline,
    IconFiles,
    IconInfoSquare,
    IconUsers,
    IconMessage,
    IconReportAnalytics,
} from '@tabler/icons-vue';
import {
    TablerAlert,
    TablerLoading,
    TablerDropdown,
    TablerDelete,
    TablerIconButton,
    TablerRefreshButton,
    TablerPillGroup
} from '@tak-ps/vue-tabler';
import MenuTemplate from '../util/MenuTemplate.vue';
import ShareToPackage from '../util/ShareToPackage.vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useMapStore } from '../../../stores/map.ts';
import OverlayManager from '../../../base/overlay.ts';
import { reportButtonVisible } from '../../../base/report.ts';

const mapStore = useMapStore();
const route = useRoute();
const router = useRouter();

// taklab: open "Raport misji" with this feed chosen.
function openReport(): void {
    if (!subscription.value || !reportButtonVisible(subscription.value, mapStore.menu.canSeeReport.value)) return;
    router.push({ path: '/menu/report', query: { mission: subscription.value.meta.name } });
}
const { t } = useI18n();

const missionTabs = computed(() => [
    { value: 'home-menu-mission-info', label: t('panels.mission.tabs.info') },
    { value: 'home-menu-mission-layers', label: t('panels.mission.tabs.layers') },
    { value: 'home-menu-mission-users', label: t('panels.mission.tabs.users') },
    { value: 'home-menu-mission-changes', label: t('panels.mission.tabs.changes') },
    { value: 'home-menu-mission-logs', label: t('panels.mission.tabs.logs') },
    { value: 'home-menu-mission-contents', label: t('panels.mission.tabs.contents') },
    { value: 'home-menu-mission-chats', label: t('panels.mission.tabs.chats') },
]);

const missionTabIcons: Record<string, Component> = {
    'home-menu-mission-info': IconInfoSquare,
    'home-menu-mission-layers': IconBoxMultiple,
    'home-menu-mission-users': IconUsers,
    'home-menu-mission-changes': IconTimeline,
    'home-menu-mission-logs': IconArticle,
    'home-menu-mission-contents': IconFiles,
    'home-menu-mission-chats': IconMessage,
};

const MISSION_TAB_LABEL_WIDTH = 100;

const tabs = useTemplateRef('tabs');
const { width: tabsWidth } = useElementSize(tabs);
const showTabLabels = computed(() => tabsWidth.value >= missionTabs.value.length * MISSION_TAB_LABEL_WIDTH);

function navigateMissionTab(name: string) {
    const suffix = name.replace('home-menu-mission-', '');
    router.replace(`/menu/missions/${route.params.mission}/${suffix}`);
}

const error = ref<Error | undefined>(undefined);
const token = ref<string | undefined>(route.query.token ? String(route.query.token) : undefined)
const loading = ref(false);

const shareToPackage = ref<{
    shown: boolean,
    features: Feature[]
}>({
    shown: false,
    features: []
});

const loadingInline = ref<string | undefined>(undefined);
const subscription = ref<Subscription | undefined>(undefined)

// Bumped per load and on unmount so a late response is closed, not adopted
let fetchSeq = 0;

onMounted(async () => {
    await fetchMission();
})

onBeforeUnmount(() => {
    fetchSeq++;
    setSubscription(undefined);
});

// The route is reused when moving between missions
watch(() => route.params.mission, async (guid, previous) => {
    if (!guid || guid === previous) return;

    setSubscription(undefined);
    token.value = route.query.token ? String(route.query.token) : undefined;

    await fetchMission();
});

function setSubscription(next: Subscription | undefined): void {
    const previous = subscription.value;
    subscription.value = next;
    if (previous && previous !== next) previous.close();
}

function subscribedChanged(): void {
    triggerRef(subscription);
}

async function shareToPackageSetup(): Promise<void> {
    if (!subscription.value) return;
    shareToPackage.value.features = (await subscription.value.feature.collection(true)).features as Feature[];
    shareToPackage.value.shown = true;
}

async function zoomToFeatures(): Promise<void> {
    if (!subscription.value) return;
    error.value = undefined;

    try {
        await subscription.value.feature.zoomTo();
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    }
}

async function deleteMission() {
    if (!subscription.value) return;

    loading.value = true;
    error.value = undefined;

    try {
        if (mapStore.mission && mapStore.mission.guid === subscription.value.guid) {
            await mapStore.makeActiveMission(undefined);
        }

        await subscription.value.delete();

        const overlay = OverlayManager.loadedByMode('mission', String(route.params.mission));
        if (overlay) {
            await OverlayManager.deleteLoaded(overlay);
        }

        router.replace('/menu/missions');
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        loading.value = false;
    }
}

async function exportToPackage(format: string): Promise<void> {
    if (!subscription.value) return;

    loadingInline.value = t('panels.mission.generating')

    try {
        await std(`/api/marti/missions/${encodeURIComponent(subscription.value.guid)}/archive?download=true&format=${format}`, {
            download: true
        })
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        loadingInline.value = undefined;
    }
}

async function fetchMission(reload = false): Promise<void> {
    const seq = ++fetchSeq;
    const guid = String(route.params.mission);

    loading.value = true;
    error.value = undefined;

    try {
        const sub = await Subscription.load(guid, {
            reload,
            missiontoken: token.value,
            live: true,
        });

        if (seq !== fetchSeq) {
            sub.close();
            return;
        }

        setSubscription(sub);
    } catch (err) {
        if (seq !== fetchSeq) return;

        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        if (seq === fetchSeq) loading.value = false;
    }
}
</script>

<style scoped>
.mission-name {
    cursor: pointer;
}

.mission-name:hover,
.mission-name:focus-visible {
    text-decoration: underline;
    outline: none;
}
</style>
