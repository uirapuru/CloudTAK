<template>
    <TablerModal size='xl'>
        <div class='modal-status bg-yellow' />
        <button
            type='button'
            class='btn-close'
            :aria-label='t("common.close")'
            @click='emit("refresh")'
        />
        <div class='modal-header'>
            <div
                v-if='wizard > 0'
                v-text='t("panels.videoLeaseModal.wizardStep", { step: wizard })'
            />
            <div
                v-else-if='disabled'
                class='d-flex align-items-center'
            >
                <VideoLeaseSourceType :source-type='editLease.source_type' />
                <div class='row mx-2'>
                    <span
                        class='modal-title'
                        v-text='editLease.name'
                    />
                    <span
                        v-if='editLease.source_model'
                        class='subheader'
                        v-text='editLease.source_model'
                    />
                </div>
            </div>
            <div
                v-else
                class='modal-title'
                v-text='editLease.id ? t("panels.videoLeaseModal.editLease") : t("panels.videoLeaseModal.newLease")'
            />

            <div class='ms-auto btn-list'>
                <TablerRefreshButton
                    v-if='disabled && editLease.id'
                    :title='t("panels.videoLeaseModal.refresh")'
                    :loading='loading'
                    @click='fetchLease'
                />

                <TablerIconButton
                    v-if='disabled && editLease.id'
                    :title='t("panels.videoLeaseModal.edit")'
                    @click='disabled = false'
                >
                    <IconPencil
                        :size='32'
                        stroke='1'
                    />
                </TablerIconButton>

                <TablerDelete
                    v-if='editLease.id'
                    displaytype='icon'
                    @delete='deleteLease'
                />
            </div>
        </div>

        <TablerLoading v-if='loading' />
        <template v-else-if='wizard > 0'>
            <div class='d-flex align-items-center w-100 justify-content-center'>
                <div class='py-2'>
                    <img
                        style='max-width: 100%; height: auto; max-height: 600px;'
                        :alt='t("panels.videoLeaseModal.wizardImage")'
                        :src='`/wizard/Step${wizard}.png`'
                        class='rounded'
                    >

                    <div v-if='wizard === 8'>
                        <div class='subheader pt-4'>
                            {{ t('panels.videoLeaseModal.rtspPath') }}
                        </div>
                        <CopyField
                            v-if='protocols.rtsp'
                            :model-value='protocols.rtsp.url.replace(/.*\//, "")'
                        />
                    </div>
                </div>
            </div>

            <div class='modal-footer'>
                <div class='d-flex align-items-center w-100'>
                    <button
                        class='btn btn-secondary'
                        @click='wizard = wizard -= 1'
                    >
                        <IconChevronLeft
                            :size='20'
                            stroke='1'
                        />
                        <span
                            v-if='wizard === 1'
                            class='mx-2'
                        >{{ t('common.close') }}</span>
                        <span
                            v-else
                            class='mx-2'
                        >{{ t('panels.videoLeaseModal.back') }}</span>
                    </button>

                    <div class='ms-auto'>
                        <button
                            class='btn btn-primary'
                            @click='wizard = wizard > 10 ? 0 : wizard + 1'
                        >
                            <span
                                v-if='wizard < 10'
                                class='mx-2'
                            >{{ t('panels.videoLeaseModal.next') }}</span>
                            <span
                                v-else
                                class='mx-2'
                            >{{ t('panels.videoLeaseModal.done') }}</span>
                            <IconChevronRight
                                :size='20'
                                stroke='1'
                            />
                        </button>
                    </div>
                </div>
            </div>
        </template>
        <template v-else-if='disabled'>
            <div class='modal-body row'>
                <template v-if='Object.keys(protocols).length'>
                    <div class='col-12 d-flex align-items-center'>
                        <div class='subheader user-select-none'>
                            {{ t('panels.videoLeaseModal.protocols') }}
                        </div>

                        <div class='ms-auto'>
                            <div
                                v-if='editLease.proxy'
                                class='d-flex align-items-center user-select-none'
                            >
                                <IconServer
                                    :size='24'
                                    stroke='1'
                                />
                                <span class='ms-2'>{{ t('panels.videoLeaseModal.externalUrl') }}</span>
                            </div>
                            <div
                                v-else
                                class='col-12'
                            >
                                <!-- Read vs Publish is always selectable - SRT URLs differ by mode even without credentials -->
                                <TablerPillGroup
                                    v-model='mode'
                                    :options='[
                                        { value: "read", label: secure ? t("panels.videoLeaseModal.readUser") : t("panels.videoLeaseModal.read") },
                                        { value: "publish", label: secure ? t("panels.videoLeaseModal.writeUser") : t("panels.videoLeaseModal.publish") }
                                    ]'
                                    padding='p-1'
                                >
                                    <template #option='{ option }'>
                                        <span
                                            v-if='option.value === "read"'
                                            :title='secure ? t("panels.videoLeaseModal.readUser") : t("panels.videoLeaseModal.read")'
                                        >
                                            <IconBook2
                                                :size='24'
                                                stroke='1'
                                            />
                                        </span>
                                        <span
                                            v-else
                                            :title='secure ? t("panels.videoLeaseModal.writeUser") : t("panels.videoLeaseModal.publish")'
                                        >
                                            <IconPencil
                                                :size='24'
                                                stroke='1'
                                            />
                                        </span>
                                        <span class='mx-2'>{{ option.label }}</span>
                                    </template>
                                </TablerPillGroup>
                            </div>
                        </div>
                    </div>
                    <template v-if='expired(editLease.expiration)'>
                        <TablerAlert
                            :title='t("panels.videoLeaseModal.expiredLease")'
                            :err='new Error(t("panels.videoLeaseModal.renewHint"))'
                            :advanced='false'
                        />

                        <div class='col-12 d-flex justify-content-center pb-3'>
                            <TranslatedEnum
                                v-model='editLease.duration'
                                :options='durationOptions'
                                style='width: 300px;'
                            />
                        </div>
                        <div class='col-12 d-flex justify-content-center'>
                            <button
                                class='btn btn-primary'
                                style='width: 280px'
                                @click='saveLease'
                            >
                                {{ t('panels.videoLeaseModal.renew') }}
                            </button>
                        </div>
                    </template>
                    <template v-else>
                        <template v-if='secure && mode === "publish"'>
                            <div class='col-md-6'>
                                <CopyField
                                    :label='t("panels.videoLeaseModal.writeUsername")'
                                    :model-value='editLease.stream_user || ""'
                                />
                            </div>
                            <div class='col-md-6'>
                                <CopyField
                                    :label='t("panels.videoLeaseModal.writePassword")'
                                    :model-value='editLease.stream_pass || ""'
                                />
                            </div>
                        </template>
                        <template v-else-if='secure && mode === "read"'>
                            <div class='col-12 col-md-6'>
                                <CopyField
                                    :label='t("panels.videoLeaseModal.readUsername")'
                                    :model-value='editLease.read_user || ""'
                                />
                            </div>
                            <div class='col-12 col-md-6'>
                                <CopyField
                                    :label='t("panels.videoLeaseModal.readPassword")'
                                    :model-value='editLease.read_pass || ""'
                                />
                            </div>
                        </template>
                        <div
                            v-for='protocol in protocols'
                            class='pt-2'
                        >
                            <template v-if='protocol'>
                                <CopyField
                                    v-if='secure && mode === "read"'
                                    :label='protocol.name'
                                    :model-value='protocol.url.replace("{{mode}}", mode).replace("{{username}}", editLease.read_user || "").replace("{{password}}", editLease.read_pass || "")'
                                />
                                <CopyField
                                    v-else-if='secure && mode === "publish"'
                                    :label='protocol.name'
                                    :model-value='protocol.url.replace("{{mode}}", mode).replace("{{username}}", editLease.stream_user || "").replace("{{password}}", editLease.stream_pass || "")'
                                />
                                <CopyField
                                    v-else
                                    :label='protocol.name'
                                    :model-value='protocol.url.replace("{{mode}}", mode)'
                                />
                            </template>
                        </div>
                    </template>

                    <div
                        v-if='disabled'
                        class='col-12 pt-2'
                    >
                        <div class='col-12 d-flex align-items-center mb-1'>
                            <label>{{ t('panels.videoLeaseModal.expiration') }}</label>

                            <div class='ms-auto'>
                                <span
                                    v-if='expired(editLease.expiration)'
                                    class='badge bg-red text-white mt-2'
                                >{{ t('panels.videoLeaseModal.expired') }}</span>
                                <span
                                    v-else-if='editLease.expiration === null'
                                    class='badge bg-blue text-white mt-2'
                                >{{ t('panels.videoLeaseModal.permanent') }}</span>
                            </div>
                        </div>

                        <div class='col-12'>
                            <CopyField
                                v-if='editLease.expiration'
                                :model-value='editLease.expiration'
                            />
                        </div>
                    </div>
                </template>

                <div
                    v-if='editLease.proxy'
                    class='col-12 pt-4'
                >
                    <div class='subheader user-select-none'>
                        {{ t('panels.videoLeaseModal.externalConfig') }}
                    </div>
                    <div class='pt-2'>
                        <CopyField
                            :label='t("panels.videoLeaseModal.externalUrl")'
                            :model-value='editLease.proxy'
                        />
                    </div>
                </div>
            </div>
            <div class='modal-footer'>
                <button
                    v-if='protocols.rtsp && !expired(editLease.expiration)'
                    class='btn btn-secondary'
                    @click='wizard = 1'
                >
                    <IconWand
                        :size='20'
                        stroke='1'
                    />
                    <span class='mx-2'>{{ t('panels.videoLeaseModal.wizard') }}</span>
                </button>
            </div>
        </template>
        <template v-else>
            <div
                class='modal-body row g-2'
            >
                <div class='col-12'>
                    <TablerPillGroup
                        :model-value='typeof editLease.proxy === "string" ? "proxy" : "host"'
                        :options='[
                            { value: "host", label: t("panels.videoLeaseModal.hostedUrl") },
                            { value: "proxy", label: t("panels.videoLeaseModal.externalUrl") }
                        ]'
                        padding='p-1'
                        @update:model-value='(v: string) => editLease.proxy = v === "proxy" ? "" : null'
                    >
                        <template #option='{ option }'>
                            <span
                                v-if='option.value === "host"'
                                :title='t("panels.videoLeaseModal.hostedHint")'
                            >
                                <IconDrone
                                    :size='24'
                                    stroke='1'
                                />
                            </span>
                            <span
                                v-else
                                :title='t("panels.videoLeaseModal.externalHint")'
                            >
                                <IconServer
                                    :size='24'
                                    stroke='1'
                                />
                            </span>
                            <span class='ms-2'>{{ option.label }}</span>
                        </template>
                    </TablerPillGroup>
                </div>
                <div class='col-12 col-md-8'>
                    <TablerInput
                        v-model='editLease.name'
                        :description='t("panels.videoLeaseModal.nameDesc")'
                        :disabled='disabled'
                        :required='true'
                        :label='t("panels.videoLeaseModal.name")'
                    />
                </div>
                <div class='col-12 col-md-4'>
                    <TranslatedEnum
                        v-model='editLease.duration'
                        :options='durationOptions'
                        :disabled='disabled'
                        :label='t("panels.videoLeaseModal.duration")'
                        :description='t("panels.videoLeaseModal.durationDesc")'
                    />
                </div>
                <div class='col-12 col-md-6'>
                    <TranslatedEnum
                        v-model='editLease.source_type'
                        default='unknown'
                        :options='sourceTypeOptions'
                        :disabled='disabled'
                        :label='t("panels.videoLeaseModal.sourceType")'
                        :description='t("panels.videoLeaseModal.sourceTypeDesc")'
                    />
                </div>
                <div class='col-12 col-md-6'>
                    <TablerInput
                        v-model='editLease.source_model'
                        :disabled='disabled'
                        :label='t("panels.videoLeaseModal.sourceModel")'
                        :description='t("panels.videoLeaseModal.sourceModelDesc")'
                    />
                </div>
                <div
                    v-if='typeof editLease.proxy === "string"'
                    class='col-12'
                >
                    <TablerInput
                        v-model='editLease.proxy'
                        :disabled='disabled'
                        :label='t("panels.videoLeaseModal.mediaUrl")'
                        :required='true'
                        :error='validateURL(editLease.proxy, { protocols: ["http", "https", "rtsp", "rtsps", "rtmp", "rtmps", "srt"] })'
                        :description='t("panels.videoLeaseModal.mediaUrlDesc")'
                    />
                </div>
                <div class='col-12 col-md-6'>
                    <TablerToggle
                        v-model='editLease.publish'
                        :label='t("panels.videoLeaseModal.publishTak")'
                        :disabled='disabled'
                        :description='t("panels.videoLeaseModal.publishTakDesc")'
                    />
                </div>
                <div class='col-12 col-md-6'>
                    <TablerToggle
                        v-model='editLease.recording'
                        :label='t("panels.videoLeaseModal.record")'
                        :disabled='disabled'
                        :description='t("panels.videoLeaseModal.recordDesc")'
                    />
                </div>
                <div
                    v-if='typeof editLease.proxy !== "string"'
                    class='col-12 col-md-6'
                >
                    <TablerToggle
                        v-model='secure'
                        :label='t("panels.videoLeaseModal.security")'
                        :disabled='disabled'
                        :description='t("panels.videoLeaseModal.securityDesc")'
                    />
                </div>
                <div class='col-12'>
                    <TablerToggle
                        v-model='editLease.share'
                        :description='t("panels.videoLeaseModal.shareDesc")'
                        :disabled='disabled'
                        :label='t("panels.videoLeaseModal.share")'
                    />
                </div>
                <div
                    v-if='editLease.share || editLease.publish'
                    class='col-12'
                >
                    <div
                        v-if='!disabled'
                        style='height: 20vh; min-height: 200px; overflow-y: auto;'
                    >
                        <GroupSelect
                            v-model='channels'
                            :limit='1'
                        />
                    </div>
                    <div
                        v-else
                        class='border border-white rounded px-2 py-2'
                    >
                        <IconAffiliate
                            :size='32'
                            stroke='1'
                        /> <span v-text='editLease.channel' />
                    </div>
                </div>
            </div>
            <div class='modal-footer d-flex'>
                <button
                    v-if='!disabled'
                    class='btn btn-secondary'
                    @click='emit("close")'
                >
                    {{ t('common.cancel') }}
                </button>

                <div class='ms-auto btn-list'>
                    <button
                        v-if='protocols.rtsp && !expired(editLease.expiration)'
                        class='btn btn-secondary'
                        @click='wizard = 1'
                    >
                        <IconWand
                            :size='20'
                            stroke='1'
                        />
                        <span class='mx-2'>{{ t('panels.videoLeaseModal.wizard') }}</span>
                    </button>
                    <button
                        v-if='!disabled'
                        class='btn btn-primary'
                        @click='saveLease'
                    >
                        {{ t('common.save') }}
                    </button>
                    <button
                        v-if='disabled'
                        class='btn btn-primary'
                        @click='emit("close")'
                    >
                        {{ t('panels.videoLeaseModal.done') }}
                    </button>
                </div>
            </div>
        </template>
    </TablerModal>
</template>

<script setup lang='ts'>
import { server } from '../../../../std.ts';
import { validateURL } from '../../../../utils/validators.ts';
import CopyField from '../../util/CopyField.vue';
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import TranslatedEnum from '../../util/TranslatedEnum.vue';
import type { paths } from '@cloudtak/api-types';
import type { VideoLease, VideoLeaseProtocols } from '../../../../types.ts';
import VideoLeaseSourceType from '../../util/VideoLeaseSourceType.vue'
import GroupSelect from '../../../util/GroupSelect.vue';
import {
    IconDrone,
    IconServer,
    IconPencil,
    IconWand,
    IconBook2,
    IconAffiliate,
    IconChevronRight,
    IconChevronLeft,
} from '@tabler/icons-vue';
import {
    TablerRefreshButton,
    TablerIconButton,
    TablerLoading,
    TablerToggle,
    TablerAlert,
    TablerModal,
    TablerInput,
    TablerDelete,
    TablerPillGroup
} from '@tak-ps/vue-tabler'

const props = withDefaults(defineProps<{
    lease: VideoLease,
    isSystemAdmin?: boolean
}>(), {
    isSystemAdmin: false
});

const emit = defineEmits([ 'close', 'refresh' ])

const { t } = useI18n();

const mode = ref('read');
const loading = ref(true);
const secure = ref(false);
const disabled = ref(true);
const wizard = ref(0);
const protocols = ref<VideoLeaseProtocols>({});

const channels = ref<string[]>([]);

const durations = ref<Array<string>>(["16 Hours", "12 Hours", "6 Hours", "1 Hour"]);
const durationOptions = computed(() => durations.value.map((value) => ({
    value,
    label: t(`panels.videoLeaseModal.durations.${value.replace(/[^a-zA-Z0-9]+/g, '_')}`)
})));
const sourceTypeOptions = computed(() => [
    "unknown",
    "fixed",
    "vehicle",
    "screenshare",
    "personal",
    "rotor",
    "fixedwing",
    "uas-rotor",
    "uas-fixedwing"
].map((value) => ({
    value,
    label: t(`panels.videoLeaseModal.sourceTypes.${value.replace(/[^a-zA-Z0-9]+/g, '_')}`)
})));

type VideoLeaseCreateBody = paths['/api/video/lease']['post']['requestBody']['content']['application/json'];
type VideoLeaseUpdateBody = paths['/api/video/lease/{:lease}']['patch']['requestBody']['content']['application/json'];
type VideoLeaseSourceTypeValue = NonNullable<VideoLeaseCreateBody['source_type']>;

const editLease = ref<{
    id?: number
    name: string
    duration: string
    recording: boolean
    publish: boolean
    share: boolean
    channel: string | null
    source_type: VideoLeaseSourceTypeValue
    source_model: string
    proxy?: string | null
    expiration?: string | null
    stream_user: string | null
    stream_pass: string | null
    read_user: string | null
    read_pass: string | null
}>({
    name: '',
    duration: '16 Hours',
    channel: null,
    recording: false,
    publish: false,
    share: true,
    source_type: 'unknown',
    source_model: '',
    stream_user: '',
    stream_pass: '',
    read_user: '',
    read_pass: ''
});

onMounted(async () => {
    if (props.isSystemAdmin) {
        durations.value.push('Permanent');
    }

    if (props.lease.id) {
        editLease.value = {
            ...props.lease,
            duration: '16 Hours'
        }

        await fetchLease();
    } else {
        disabled.value = false;
    }

    loading.value = false
});

function expired(expiration?: string | null) {
    if (!expiration) return false;
    return +new Date(expiration) < +new Date();
}

function leaseDurationSeconds(): number {
    if (editLease.value.duration === 'Permanent') return 0;

    return parseInt(editLease.value.duration.split(' ')[0]) * 60 * 60;
}

function leaseProxy(): string | undefined {
    if (typeof editLease.value.proxy !== 'string') return undefined;

    return editLease.value.proxy;
}

async function fetchLease() {
    loading.value = true;

    disabled.value = true;

    const res = await server.GET('/api/video/lease/{:lease}', {
        params: {
            path: {
                ':lease': editLease.value.id as number
            }
        }
    });
    if (res.error) throw new Error(res.error.message);

    editLease.value = {
        ...res.data,
        duration: res.data.expiration ? '16 Hours' : 'Permanent'
    }

    if (editLease.value.stream_user && editLease.value.read_user) {
        secure.value = true;
    } else {
        secure.value = false;
    }

    if (editLease.value.channel) {
        channels.value = [ editLease.value.channel ];
    } else {
        channels.value = [];
    }

    const resMetadata = await server.GET('/api/video/lease/{:lease}/metadata', {
        params: {
            path: {
                ':lease': editLease.value.id as number
            }
        }
    });
    if (resMetadata.error) throw new Error(resMetadata.error.message);

    protocols.value = resMetadata.data.protocols;

    disabled.value = true;
    loading.value = false;
}

async function deleteLease() {
    try {
        loading.value = true;

        const res = await server.DELETE('/api/video/lease/{:lease}', {
            params: {
                path: {
                    ':lease': editLease.value.id as number
                }
            }
        });
        if (res.error) throw new Error(res.error.message);

        loading.value = false;

         emit('refresh');
    } catch (err) {
        loading.value = false;
        throw err;
    }
}

async function saveLease() {
    try {
        loading.value = true;

        if (editLease.value.id) {
            const body: VideoLeaseUpdateBody = {
                name: editLease.value.name,
                secure: secure.value,
                proxy: leaseProxy(),
                channel: channels.value.length ? channels.value[0] : null,
                duration: leaseDurationSeconds(),
                permanent: editLease.value.duration === 'Permanent',
                recording: editLease.value.recording,
                publish: editLease.value.publish,
                share: editLease.value.share,
                source_type: editLease.value.source_type,
                source_model: editLease.value.source_model,
            };

            const res = await server.PATCH('/api/video/lease/{:lease}', {
                params: {
                    path: {
                        ':lease': editLease.value.id
                    }
                },
                body
            });
            if (res.error) throw new Error(res.error.message);
        } else {
            const body: VideoLeaseCreateBody = {
                name: editLease.value.name,
                ephemeral: false,
                secure: secure.value,
                channel: channels.value.length ? channels.value[0] : null,
                proxy: leaseProxy(),
                duration: leaseDurationSeconds(),
                permanent: editLease.value.duration === 'Permanent',
                recording: editLease.value.recording,
                publish: editLease.value.publish,
                share: editLease.value.share,
                source_type: editLease.value.source_type,
                source_model: editLease.value.source_model,
            };

            const res = await server.POST('/api/video/lease', {
                body
            });
            if (res.error) throw new Error(res.error.message);
            editLease.value.id = res.data.id;
        }

        await fetchLease();
    } catch (err) {
        loading.value = false;
        throw err;
    }
}
</script>
