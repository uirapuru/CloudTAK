<template>
    <MenuTemplate
        :name='t("taklab.otsAccounts.title")'
        :loading='loading'
    >
        <template #buttons>
            <TablerIconButton
                :title='t("taklab.common.refresh")'
                @click='refresh'
            >
                <IconRefresh
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>
        </template>
        <template #default>
            <TablerAlert
                v-if='error'
                :err='error'
            />
            <TablerNone
                v-else-if='!status.enabled || !status.administrator'
                :label='status.reason || t("taklab.otsAccounts.adminOnly")'
                :create='false'
            />
            <template v-else>
                <div class='px-2 pt-2'>
                    <TablerInput
                        v-model='filter'
                        icon='search'
                        :placeholder='t("taklab.otsAccounts.search")'
                    />
                </div>

                <TablerNone
                    v-if='!visible.length'
                    :label='t("taklab.otsAccounts.none")'
                    :create='false'
                />
                <div
                    v-else
                    class='d-flex flex-column gap-2 py-2'
                >
                    <StandardItem
                        v-for='account in visible'
                        :key='account.username'
                        class='d-flex align-items-center px-3 py-2 gap-2'
                    >
                        <div class='flex-grow-1 d-flex flex-column overflow-hidden'>
                            <div class='d-flex align-items-center gap-2'>
                                <span
                                    class='fw-semibold text-truncate'
                                    v-text='account.username'
                                />
                                <TablerBadge
                                    v-if='!account.active'
                                    class='small flex-shrink-0'
                                    background-color='rgba(220, 38, 38, 0.15)'
                                    border-color='rgba(220, 38, 38, 0.3)'
                                    text-color='#dc2626'
                                >
                                    {{ t('taklab.otsAccounts.locked') }}
                                </TablerBadge>
                            </div>
                            <span
                                class='text-muted small text-truncate'
                                v-text='account.roles.join(", ")'
                            />
                        </div>
                        <button
                            v-for='type in TYPES'
                            :key='type'
                            class='btn btn-sm d-flex flex-column align-items-center px-2'
                            :title='qrTitle(type)'
                            :disabled='qrButtonState(status, type).disabled'
                            @click='openQr(account, type)'
                        >
                            <IconQrcode
                                :size='20'
                                stroke='1'
                            />
                            <span
                                class='small'
                                v-text='type === "atak" ? "ATAK" : "ICU"'
                            />
                        </button>
                    </StandardItem>
                </div>
            </template>
        </template>
    </MenuTemplate>

    <TablerModal v-if='modal'>
        <div class='modal-status bg-yellow' />
        <button
            type='button'
            class='btn-close'
            :aria-label='t("common.close")'
            @click='modal = undefined'
        />
        <div class='modal-header text-body'>
            <div
                class='modal-title'
                v-text='`${modal.type === "atak" ? "ATAK" : "OpenTAK ICU"}: ${modal.username}`'
            />
        </div>
        <div class='modal-body'>
            <TablerLoading v-if='!modal.qr && !modal.error' />
            <TablerAlert
                v-else-if='modal.error'
                :err='modal.error'
            />
            <template v-else-if='modal.qr'>
                <img
                    class='ots-qr d-block mx-auto mb-3'
                    :alt='t("taklab.otsAccounts.qrAlt")'
                    :src='`data:image/svg+xml;charset=utf-8,${encodeURIComponent(modal.qr.svg)}`'
                >
                <div class='d-flex align-items-center gap-2'>
                    <input
                        class='form-control form-control-sm'
                        readonly
                        :value='modal.qr.uri'
                    >
                    <CopyButton
                        :text='modal.qr.uri'
                        :title='t("taklab.common.copy")'
                        :size='24'
                    />
                </div>
                <div class='alert alert-warning mt-3 mb-0'>
                    {{ t('taklab.otsAccounts.warning') }}
                </div>
            </template>
        </div>
    </TablerModal>
</template>

<script setup lang='ts'>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconQrcode, IconRefresh } from '@tabler/icons-vue';
import {
    TablerAlert,
    TablerBadge,
    TablerIconButton,
    TablerInput,
    TablerLoading,
    TablerModal,
    TablerNone,
} from '@tak-ps/vue-tabler';
import MenuTemplate from '../util/MenuTemplate.vue';
import StandardItem from '../util/StandardItem.vue';
import CopyButton from '../util/CopyButton.vue';
import { std, stdurl } from '../../../std.ts';
import {
    filterAccounts,
    qrButtonState,
    type OtsAccount,
    type OtsAccountsStatus,
    type OtsQr,
    type OtsQrType,
} from './ots-accounts.ts';

const TYPES: OtsQrType[] = ['atak', 'icu'];

const { t } = useI18n();

const loading = ref(true);
const error = ref<Error | undefined>();
const status = ref<OtsAccountsStatus>({ enabled: false, administrator: false, atak: false, icu: false });
const items = ref<OtsAccount[]>([]);
const filter = ref('');
const modal = ref<{ username: string; type: OtsQrType; qr?: OtsQr; error?: Error } | undefined>();

const visible = computed(() => filterAccounts(items.value, filter.value));

onMounted(async () => {
    await refresh();
    loading.value = false;
});

async function refresh(): Promise<void> {
    try {
        status.value = await std('/api/ots/accounts/status') as OtsAccountsStatus;
        if (status.value.enabled && status.value.administrator) {
            items.value = (await std('/api/ots/accounts') as { items: OtsAccount[] }).items;
        } else {
            items.value = [];
        }
        error.value = undefined;
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    }
}

/** Button tooltip; qrButtonState keeps the Polish text for its spec, the screen shows the translated one. */
function qrTitle(type: OtsQrType): string {
    const { disabled } = qrButtonState(status.value, type);
    if (type === 'atak') return t(disabled ? 'taklab.otsAccounts.qrAtakUnavailable' : 'taklab.otsAccounts.qrAtak');
    return t(disabled ? 'taklab.otsAccounts.qrIcuUnavailable' : 'taklab.otsAccounts.qrIcu');
}

async function openQr(account: OtsAccount, type: OtsQrType): Promise<void> {
    const current = { username: account.username, type } as NonNullable<typeof modal.value>;
    modal.value = current;
    try {
        const url = stdurl(`/api/ots/accounts/${encodeURIComponent(account.username)}/qr`);
        url.searchParams.set('type', type);
        const qr = await std(url) as OtsQr;
        if (modal.value?.username === current.username && modal.value.type === type) {
            modal.value = { ...current, qr };
        }
    } catch (err) {
        if (modal.value?.username === current.username && modal.value.type === type) {
            modal.value = { ...current, error: err instanceof Error ? err : new Error(String(err)) };
        }
    }
}
</script>

<style scoped>
.ots-qr {
    width: 100%;
    max-width: 280px;
    background: #fff;
    padding: 8px;
}
</style>
