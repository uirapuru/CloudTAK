<template>
    <MenuTemplate
        :name='t("panels.packages.title")'
    >
        <template #buttons>
            <TablerIconButton
                v-if='!loading'
                :title='t("panels.packages.create")'
                @click='upload = true'
            >
                <IconPlus
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>

            <TablerRefreshButton
                :loading='loading'
                @click='fetchList'
            />
        </template>
        <template #default>
            <ShareToPackage
                v-if='upload'
                :upload='true'
                @close='upload = false'
            />

            <div class='d-flex flex-column'>
                <div class='d-flex pt-2 flex-row gap-2'>
                    <TablerInput
                        v-model='paging.filter'
                        icon='search'
                        :placeholder='t("panels.common.filter")'
                        class='flex-grow-1'
                    />
                </div>

                <ChannelInfo :label='t("panels.packages.title")' />
                <EmptyInfo v-if='mapStore.hasNoChannels' />

                <TablerLoading
                    v-if='loading'
                    class='my-5'
                />
                <TablerAlert
                    v-else-if='error'
                    :title='t("panels.packages.error")'
                    :err='error'
                />
                <TablerNone
                    v-else-if='!list.items.length'
                    :label='t("panels.packages.none")'
                    :create='false'
                />
                <div
                    v-else
                    class='d-flex flex-column gap-3'
                >
                    <StandardItem
                        v-for='pkg in list.items'
                        :key='pkg.uid'
                        class='d-flex flex-row gap-3'
                        @click='router.push(`/menu/packages/${pkg.uid}`)'
                    >
                        <div class='icon-wrapper ms-2 mt-2 d-flex align-items-center justify-content-center rounded-circle bg-black bg-opacity-25'>
                            <IconPackage
                                :size='24'
                                stroke='1'
                            />
                        </div>

                        <div class='flex-grow-1 d-flex flex-column gap-2 py-2'>
                            <div class='d-flex flex-wrap align-items-center gap-2'>
                                <span
                                    class='fw-semibold text-break'
                                    v-text='pkg.name'
                                />
                            </div>

                            <Keywords
                                :keywords='pkg.keywords.filter((k) => k && k.trim() !== "missionpackage")'
                                tone='accent'
                            />

                            <div class='text-secondary small d-flex flex-wrap align-items-center gap-2'>
                                <div v-text='timeDiff(pkg.created)' />
                                <span class='text-white-50'>•</span>
                                <div v-text='pkg.username' />
                            </div>
                        </div>
                    </StandardItem>
                </div>
            </div>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import type { PackageList } from '../../../../src/types.ts';
import { ref, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import MenuTemplate from '../util/MenuTemplate.vue';
import Keywords from '../util/Keywords.vue';
import StandardItem from '../util/StandardItem.vue';
import { server } from '../../../std.ts';

import {
    TablerNone,
    TablerAlert,
    TablerIconButton,
    TablerRefreshButton,
    TablerLoading,
    TablerInput,
} from '@tak-ps/vue-tabler';
import {
    IconPlus,
    IconPackage,
} from '@tabler/icons-vue';
import timeDiff from '../../../timediff.ts';
import ChannelInfo from '../util/ChannelInfo.vue';
import EmptyInfo from '../util/EmptyInfo.vue';
import ShareToPackage from '../util/ShareToPackage.vue';
import { useMapStore } from '../../../../src/stores/map.ts';

const mapStore = useMapStore();

const router = useRouter();
const { t } = useI18n();

const error = ref<Error | undefined>();
const loading = ref(true);
const upload = ref(false)

const paging = ref({
    filter: ''
});

const list = ref<PackageList>({
    total: 0,
    items: []
})

onMounted(async () => {
    await fetchList();
});

watch(() => paging.value.filter, async () => {
    await fetchList();
});

async function fetchList() {
    try {
        upload.value = false;
        error.value = undefined;
        loading.value = true;

        const res = await server.GET('/api/marti/package', {
            params: {
                query: {
                    filter: paging.value.filter,
                }
            }
        });

        if (res.error) {
            throw new Error(res.error.message || t('panels.packages.loadFailed'));
        }

        if (!res.data) throw new Error(t('panels.packages.loadFailed'));

        list.value = res.data;
    } catch (err) {
        list.value = {
            total: 0,
            items: []
        };
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        loading.value = false;
    }
}
</script>
