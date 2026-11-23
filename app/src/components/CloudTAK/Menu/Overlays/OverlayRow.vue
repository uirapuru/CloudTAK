<template>
    <StandardItem
        :id='String(card.overlay.id)'
        class='p-3 overlay-row'
        :class='{
            "overlay-pinned": OverlayManager.isPinned(card.overlay)
        }'
        :hover='card.overlay.id !== 0 && hasOverlayDetails(card.overlay)'
        @click='emit("toggle")'
    >
        <div
            class='d-flex justify-content-between gap-3'
        >
            <div
                class='d-flex align-items-center gap-2 flex-grow-1 w-100 overflow-hidden'
                :aria-disabled='card.overlay.id === 0'
            >
                <span
                    v-if='draggable'
                    class='drag-handle flex-shrink-0 align-self-stretch d-flex align-items-center cursor-move text-white-50'
                    :title='t("taklab.overlayRow.drag")'
                    @click.stop
                >
                    <IconGripVertical
                        :size='20'
                        stroke='1'
                    />
                </span>
                <span
                    v-if='card.overlay.type === "raster"'
                    class='flex-shrink-0 text-white-50'
                    :title='t("panels.overlays.badge.raster")'
                >
                    <IconMap
                        :size='20'
                        stroke='1'
                    />
                </span>
                <span
                    v-else-if='card.overlay.type === "raster-dem"'
                    class='flex-shrink-0 text-white-50'
                    :title='t("panels.overlays.badge.terrain")'
                >
                    <IconMap
                        :size='20'
                        stroke='1'
                    />
                </span>
                <span
                    v-else-if='card.overlay.type === "geojson" && card.overlay.mode === "mission"'
                    class='flex-shrink-0 text-white-50'
                    :title='t("panels.overlays.badge.dataSync")'
                >
                    <IconCloudPin
                        :size='20'
                        stroke='1'
                    />
                </span>
                <span
                    v-else-if='card.overlay.type === "3dtiles"'
                    class='flex-shrink-0 text-white-50'
                    :title='t("taklab.overlayRow.buildings3d")'
                >
                    <IconBuildingSkyscraper
                        :size='20'
                        stroke='1'
                    />
                </span>
                <span
                    v-else
                    class='flex-shrink-0 text-white-50'
                    :title='t("panels.overlays.badge.vector")'
                >
                    <IconVector
                        :size='20'
                        stroke='1'
                    />
                </span>

                <div class='flex-grow-1 w-100 overflow-hidden'>
                    <div class='d-flex align-items-center gap-2 w-100'>
                        <div class='d-flex align-items-center flex-grow-1 w-100'>
                            <a
                                v-if='card.overlay.mode === "mission"'
                                class='fw-semibold text-decoration-underline d-inline-flex align-items-center text-break'
                                @click.stop='router.push(`/menu/missions/${card.overlay.mode_id}`)'
                                v-text='card.overlay.name'
                            />
                            <a
                                v-else-if='card.overlay.mode === "internal"'
                                class='fw-semibold text-primary text-decoration-underline d-inline-flex align-items-center text-break cursor-pointer'
                                :title='t("panels.overlays.openFeatures")'
                                @click.stop='router.push("/menu/features")'
                                v-text='card.overlay.name'
                            />
                            <span
                                v-else
                                class='fw-semibold d-inline-flex align-items-center flex-grow-1 text-break'
                                v-text='card.overlay.name'
                            />
                        </div>
                    </div>
                    <div
                        v-if='card.badges.length || card.offline'
                        class='d-flex flex-wrap align-items-center gap-2 mt-2'
                    >
                        <span
                            v-for='badge in card.badges'
                            :key='`${card.overlay.id}-${badge.label}`'
                            class='badge rounded-pill'
                            :class='`text-bg-${badge.variant}`'
                        >
                            {{ badge.label }}
                        </span>
                        <OfflineBadge
                            v-if='card.offline'
                            :title='t("panels.overlays.offline")'
                        />
                    </div>
                </div>
            </div>

            <div
                style='min-width: 100px;'
                class='d-flex flex-column align-items-end gap-2'
            >
                <span
                    v-if='card.status.kind === "error"'
                    class='badge rounded-pill'
                    :class='`text-bg-${card.status.variant}`'
                    :title='card.status.tooltip || ""'
                >
                    {{ card.status.label }}
                </span>
                <span
                    v-else-if='card.status.kind === "pending"'
                    class='spinner-border spinner-border-sm text-secondary my-1'
                    role='status'
                    :title='card.status.tooltip || card.status.label'
                >
                    <span class='visually-hidden'>{{ card.status.label }}</span>
                </span>
                <span
                    v-else
                    class='d-inline-block rounded-circle bg-success my-2'
                    style='width: 10px; height: 10px;'
                    role='status'
                    :title='card.status.label'
                >
                    <span class='visually-hidden'>{{ card.status.label }}</span>
                </span>

                <div class='d-flex align-items-center gap-2 flex-wrap justify-content-end w-100'>
                    <FavoriteStar
                        v-if='favorite !== null && favorite !== undefined'
                        :active='favorite'
                        @toggle='emit("favorite")'
                    />

                    <TablerIconButton
                        v-if='card.overlay.hasBounds()'
                        :title='t("panels.overlays.zoom")'
                        @click.stop.prevent='card.overlay.zoomTo()'
                    >
                        <IconMaximize
                            :size='20'
                            stroke='1'
                        />
                    </TablerIconButton>

                    <TablerIconButton
                        v-if='card.visible'
                        :title='t("panels.overlays.hide")'
                        @click.stop.prevent='emit("update", { visible: !card.visible })'
                    >
                        <IconEye
                            :size='20'
                            stroke='1'
                        />
                    </TablerIconButton>

                    <TablerIconButton
                        v-else
                        :title='t("panels.overlays.show")'
                        @click.stop.prevent='emit("update", { visible: !card.visible })'
                    >
                        <IconEyeOff
                            :size='20'
                            stroke='1'
                        />
                    </TablerIconButton>

                    <TablerIconButton
                        v-if='!OverlayManager.isPinned(card.overlay)'
                        :title='t("panels.overlays.delete")'
                        @click.stop.prevent='emit("remove")'
                    >
                        <IconTrash
                            :size='20'
                            stroke='1'
                        />
                    </TablerIconButton>
                </div>
            </div>
        </div>

        <div
            v-if='opened && hasOverlayDetails(card.overlay)'
            class='mt-3 p-3 rounded-3 border border-white border-opacity-10 bg-black bg-opacity-25'
            @click.stop
        >
            <div
                v-if='card.overlay.type === "raster" || card.overlay.type === "3dtiles"'
                class='mb-3'
            >
                <TablerRange
                    :model-value='card.overlay.opacity'
                    :label='t("panels.overlays.opacity")'
                    :min='0'
                    :max='1'
                    :step='0.1'
                    @update:model-value='emit("update", { opacity: $event })'
                />
            </div>
            <SlopeClasses
                v-if='isSlopeOverlay(card.overlay)'
                :model-value='parseSlopeArgs(card.overlay.args)'
                :debounce='500'
                :hint='t("panels.overlays.slopeHint")'
                @update:model-value='emit("update", { args: { ...card.overlay.args, ...slopeArgs($event) } })'
            />
            <TreeVector
                v-if='card.overlay.type === "vector"'
                :overlay='card.overlay'
            />
        </div>
    </StandardItem>
</template>

<script setup lang='ts'>
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { TablerIconButton, TablerRange } from '@tak-ps/vue-tabler';
import {
    IconGripVertical,
    IconCloudPin,
    IconBuildingSkyscraper,
    IconMaximize,
    IconVector,
    IconEyeOff,
    IconEye,
    IconMap,
    IconTrash
} from '@tabler/icons-vue';
import StandardItem from '../../util/StandardItem.vue';
import OfflineBadge from '../../util/OfflineBadge.vue';
import TreeVector from './TreeVector.vue';
import SlopeClasses from '../Basemaps/SlopeClasses.vue';
import { isSlopeURL, parseSlopeArgs, slopeArgs } from '../Basemaps/slope.ts';
import FavoriteStar from './FavoriteStar.vue';
import OverlayManager from '../../../../base/overlay.ts';
import type Overlay from '../../../../base/overlay-class.ts';
import type { OverlayCard, OverlayUpdate } from './overlay-card.ts';

withDefaults(defineProps<{
    card: OverlayCard;
    /** Show the drag handle */
    draggable: boolean;
    /** Show the details panel */
    opened: boolean;
    /** Whether the overlay is a favorite - no star when null or not given */
    favorite?: boolean | null;
}>(), {
    // An absent boolean prop would be cast to false - and show an empty star
    favorite: null
});

function isSlopeOverlay(overlay: Overlay): boolean {
    return overlay.type === 'raster' && isSlopeURL(overlay.tilejson?.tiles?.[0]);
}

const emit = defineEmits<{
    toggle: [];
    update: [body: OverlayUpdate];
    remove: [];
    favorite: [];
}>();

const router = useRouter();
const { t } = useI18n();

/** Whether an overlay has an expandable details panel. Mission overlays are managed from MenuMission and are not expandable here. */
function hasOverlayDetails(overlay: Overlay): boolean {
    return overlay.type === 'raster'
        || overlay.type === '3dtiles'
        || overlay.type === 'vector';
}
</script>

<style scoped>
.drag-handle {
    touch-action: none;
}
</style>
