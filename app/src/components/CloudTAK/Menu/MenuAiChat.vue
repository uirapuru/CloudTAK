<template>
    <MenuTemplate
        :name='t("aiChat.title")'
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

            <div class='px-3 pt-2 d-flex flex-column gap-2'>
                <div class='d-flex align-items-center gap-2'>
                    <span v-text='t("aiChat.model.label") + ":"' />
                    <span
                        class='status-dot'
                        :class='stateClass'
                    />
                    <span
                        class='fw-semibold'
                        data-testid='ai-model-state'
                        v-text='stateLabel'
                    />
                    <span
                        v-if='model?.pinned'
                        class='small text-muted'
                        data-testid='ai-model-pinned'
                        v-text='"(" + t("aiChat.model.pinned") + ")"'
                    />
                    <div class='ms-auto'>
                        <button
                            v-if='action'
                            class='btn btn-sm'
                            :class='action === "stop" ? "btn-outline-danger" : "btn-primary"'
                            :disabled='switching'
                            data-testid='ai-model-toggle'
                            @click='toggle'
                            v-text='action === "stop" ? t("aiChat.model.stop") : t("aiChat.model.start")'
                        />
                    </div>
                </div>
                <div
                    v-if='refusal'
                    class='small text-red'
                    data-testid='ai-model-refused'
                    v-text='refusal'
                />
                <div
                    class='small text-muted'
                    v-text='t("aiChat.model.shared")'
                />
                <button
                    class='btn btn-outline-secondary w-100'
                    :disabled='!bot'
                    data-testid='ai-bot-chat'
                    @click='openBotChat'
                >
                    {{ t('aiChat.bot.open', { name: bot?.callsign || BOT_CALLSIGN }) }} →
                </button>
                <div
                    v-if='!bot'
                    class='small text-muted'
                    data-testid='ai-bot-missing'
                    v-text='t("aiChat.bot.missing")'
                />
            </div>

            <hr class='my-3'>

            <div class='row g-2 px-2'>
                <div class='col-12 px-3 fw-semibold'>
                    {{ t('aiChat.order.heading') }}
                </div>
                <div
                    class='col-12'
                    data-testid='ai-order-text'
                >
                    <TablerInput
                        v-model='form.text'
                        :label='t("aiChat.order.text")'
                        :rows='6'
                    />
                    <div
                        class='small text-muted px-2'
                        v-text='t("aiChat.order.textHint")'
                    />
                </div>
                <div class='col-12'>
                    <TranslatedEnum
                        v-model='form.location'
                        :label='t("aiChat.order.location")'
                        :options='locationOptions'
                        data-testid='ai-order-location'
                    />
                </div>
                <div class='col-12'>
                    <TablerInput
                        v-model='form.start'
                        :label='t("aiChat.order.start")'
                        type='datetime-local'
                        data-testid='ai-order-start'
                    />
                    <div
                        class='small text-muted px-2'
                        v-text='t("aiChat.order.timezone")'
                    />
                </div>
                <div class='col-12'>
                    <TranslatedEnum
                        v-model='form.format'
                        :label='t("aiChat.order.format")'
                        :options='formatOptions'
                        data-testid='ai-order-format'
                    />
                </div>
                <div class='col-12'>
                    <TablerInput
                        v-model='form.title'
                        :label='t("aiChat.order.titleLabel")'
                        data-testid='ai-order-title'
                    />
                </div>
                <div
                    class='col-12'
                    data-testid='ai-order-attachments'
                >
                    <div class='d-flex gap-2'>
                        <label class='btn btn-outline-secondary flex-fill mb-0'>
                            <IconCamera
                                :size='20'
                                stroke='1'
                                class='me-1'
                            />
                            {{ t('aiChat.order.takePhoto') }}
                            <input
                                type='file'
                                accept='image/*'
                                capture='environment'
                                class='d-none'
                                data-testid='ai-order-photo'
                                @change='pick'
                            >
                        </label>
                        <label class='btn btn-outline-secondary flex-fill mb-0'>
                            <IconPaperclip
                                :size='20'
                                stroke='1'
                                class='me-1'
                            />
                            {{ t('aiChat.order.attachFiles') }}
                            <input
                                type='file'
                                multiple
                                class='d-none'
                                data-testid='ai-order-files'
                                @change='pick'
                            >
                        </label>
                    </div>
                    <div
                        class='small text-muted px-2 pt-1'
                        v-text='t("aiChat.order.attachmentsHint")'
                    />
                    <div
                        v-for='item in attachments'
                        :key='item.key'
                        class='d-flex align-items-center gap-2 px-2'
                        data-testid='ai-order-attachment'
                    >
                        <span
                            class='text-truncate flex-grow-1'
                            data-testid='ai-order-attachment-name'
                            :title='item.file.name'
                            v-text='item.file.name'
                        />
                        <span
                            class='small text-muted text-nowrap'
                            data-testid='ai-order-attachment-size'
                            v-text='formatSize(item.file.size, locale)'
                        />
                        <TablerIconButton
                            :title='t("aiChat.order.removeFile", { name: item.file.name })'
                            data-testid='ai-order-attachment-remove'
                            @click='unpick(item.key)'
                        >
                            <IconX
                                :size='16'
                                stroke='1'
                            />
                        </TablerIconButton>
                    </div>
                    <div
                        v-if='attachments.length'
                        class='small text-muted px-2'
                        data-testid='ai-order-attachments-total'
                        v-text='t("aiChat.order.attachmentsTotal", { count: attachments.length, size: formatSize(attachmentsSize, locale) })'
                    />
                </div>
                <div
                    v-if='filesProblem'
                    class='col-12 small text-red px-3'
                    data-testid='ai-order-files-problem'
                    v-text='t(filesProblem)'
                />
                <div
                    v-if='textProblem && form.text'
                    class='col-12 small text-red px-3'
                    data-testid='ai-order-problem'
                    v-text='t(textProblem)'
                />
                <div
                    v-if='created'
                    class='col-12 small text-green px-3'
                    v-text='t("aiChat.order.created")'
                />
                <div class='col-12'>
                    <button
                        class='btn btn-primary w-100'
                        :disabled='busy || Boolean(problem)'
                        data-testid='ai-order-create'
                        @click='create'
                    >
                        {{ t('aiChat.order.create') }}
                    </button>
                </div>
                <div class='col-12 small text-muted px-3'>
                    {{ t('aiChat.notice') }}
                </div>
            </div>

            <div class='px-3 pt-3 small text-muted'>
                {{ t('aiChat.thread.heading') }}
            </div>
            <TablerNone
                v-if='!orders.length'
                :label='t("aiChat.thread.none")'
                :create='false'
            />
            <div
                v-else
                class='d-flex flex-column gap-3 px-3 py-2'
            >
                <div
                    v-for='order in orders'
                    :key='order.id'
                    class='d-flex flex-column gap-1'
                    :data-order='order.id'
                >
                    <div class='d-flex justify-content-end'>
                        <div class='bubble bubble-request'>
                            <div
                                class='fw-semibold'
                                v-text='order.title || t("aiChat.thread.untitled")'
                            />
                            <div
                                class='small'
                                v-text='requestLine(order)'
                            />
                            <div
                                class='small text-muted'
                                v-text='t("aiChat.thread.owner", { owner: order.owner })'
                            />
                        </div>
                    </div>
                    <div class='d-flex justify-content-start'>
                        <div class='bubble bubble-answer d-flex align-items-start gap-2'>
                            <div class='flex-grow-1 d-flex flex-column gap-1'>
                                <span
                                    class='badge align-self-start'
                                    :class='statusClass(order.status)'
                                    data-testid='ai-order-status'
                                    v-text='statusLabel(order)'
                                />
                                <span
                                    v-if='order.status === "failed" && order.error'
                                    class='small text-red'
                                    data-testid='ai-order-error'
                                    v-text='order.error'
                                />
                                <span
                                    v-if='order.status === "done" && order.weather_ok === false'
                                    class='small text-muted'
                                    v-text='t("aiChat.thread.noWeather")'
                                />
                                <span
                                    v-if='order.status === "done" && order.terrain_ok === false'
                                    class='small text-muted'
                                    v-text='t("aiChat.thread.noTerrain")'
                                />
                            </div>
                            <TablerIconButton
                                v-if='order.status === "done"'
                                :title='t("aiChat.thread.download", { format: formatName(order.format) })'
                                data-testid='ai-order-download'
                                @click='download(order)'
                            >
                                <IconFileTypeDocx
                                    v-if='order.format === "docx"'
                                    :size='20'
                                    stroke='1'
                                />
                                <IconFileTypePdf
                                    v-else
                                    :size='20'
                                    stroke='1'
                                />
                            </TablerIconButton>
                            <TablerDelete
                                :title='t("aiChat.thread.delete")'
                                :label='t("aiChat.thread.deleteLabel")'
                                displaytype='icon'
                                @delete='remove(order)'
                            />
                        </div>
                    </div>
                </div>
            </div>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
    IconCamera,
    IconFileTypeDocx,
    IconFileTypePdf,
    IconPaperclip,
    IconRefresh,
    IconX,
} from '@tabler/icons-vue';
import {
    TablerAlert,
    TablerDelete,
    TablerIconButton,
    TablerInput,
    TablerNone,
} from '@tak-ps/vue-tabler';
import MenuTemplate from '../util/MenuTemplate.vue';
import TranslatedEnum from '../util/TranslatedEnum.vue';
import { downloadUrl } from '../../../std.ts';
import ContactManager from '../../../base/contact.ts';
import { useMapStore } from '../../../stores/map.ts';
import { formatWhen } from './journal.ts';
import {
    AI_ORDER_FORMATS,
    AI_POLL_MS,
    BOT_CALLSIGN,
    type AiAttachment,
    type AiMapObject,
    type AiModel,
    type AiOrder,
    type BotContact,
    addAttachments,
    attachmentsProblem,
    botChatPath,
    createOrder,
    defaultOrderForm,
    deleteOrder,
    findBotContact,
    formatSize,
    getModel,
    isPending,
    listOrders,
    mapObjects,
    modelAction,
    modelChanging,
    orderProblem,
    orderUrl,
    startModel,
    stopModel,
    toOrderRequest,
} from '../../../base/ai-chat.ts';

/** User objects of the map that can be the place of an order. */
const OBJECT_FILTER = 'properties.archived and (geometry.type = "LineString" or geometry.type = "Point")';

const { t, te, locale } = useI18n();
const router = useRouter();
const mapStore = useMapStore();

const loading = ref(true);
const busy = ref(false);
const switching = ref(false);
const created = ref(false);
const error = ref<Error | undefined>();
const refusal = ref('');
const model = ref<AiModel | undefined>();
const orders = ref<AiOrder[]>([]);
const objects = ref<AiMapObject[]>([]);
const bot = ref<BotContact | undefined>();
const form = ref(defaultOrderForm());
const attachments = ref<AiAttachment[]>([]);

let alive = false;
let ordersTimer: ReturnType<typeof setTimeout> | undefined;
let modelTimer: ReturnType<typeof setTimeout> | undefined;

const textProblem = computed(() => orderProblem(form.value));
const filesProblem = computed(() => attachmentsProblem(attachments.value.map(a => a.file)));
const problem = computed(() => textProblem.value || filesProblem.value);
const attachmentsSize = computed(() => attachments.value.reduce((sum, a) => sum + a.file.size, 0));
const action = computed(() => modelAction(model.value));

const stateLabel = computed(() => {
    const state = model.value?.state;
    if (!state) return '…';
    const key = `aiChat.model.states.${state}`;
    return te(key) ? t(key) : state;
});

const stateClass = computed(() => {
    const state = model.value?.state;
    if (state === 'ready') return 'bg-green';
    if (state === 'starting' || state === 'stopping') return 'bg-yellow';
    if (state === 'unavailable') return 'bg-red';
    return 'bg-secondary';
});

const formatOptions = computed(() => AI_ORDER_FORMATS.map((f) => ({ value: f, label: t(`aiChat.order.formats.${f}`) })));

const locationOptions = computed(() => [
    { value: '', label: t('aiChat.order.locationNone') },
    ...objects.value.map((o) => ({
        value: o.id,
        label: t(o.kind === 'route' ? 'aiChat.order.locationRoute' : 'aiChat.order.locationPoint', { name: o.name }),
    })),
]);

function formatName(format: string): string {
    return format === 'docx' ? 'DOCX' : 'PDF';
}

function requestLine(order: AiOrder): string {
    const line = t('aiChat.thread.request', {
        format: formatName(order.format),
        start: order.start ? formatWhen(order.start, locale.value) : '–',
    });
    const parts = [line, t(order.has_location ? 'aiChat.thread.withLocation' : 'aiChat.thread.withoutLocation')];
    if (order.attachments) parts.push(t('aiChat.thread.attachments', { count: order.attachments }));
    return parts.join(' · ');
}

/** "Tworzy się… (odczyt zdjęć)" while running with a known phase. */
function statusLabel(order: AiOrder): string {
    const key = `aiChat.thread.statuses.${order.status}`;
    const label = te(key) ? t(key) : order.status;
    const phase = `aiChat.thread.phases.${order.phase}`;
    return order.status === 'running' && order.phase && te(phase) ? `${label} (${t(phase)})` : label;
}

function pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    attachments.value = addAttachments(attachments.value, input.files || []);
    created.value = false;
    // The same file may be picked again after removing it.
    input.value = '';
}

function unpick(key: string): void {
    attachments.value = attachments.value.filter(a => a.key !== key);
}

function statusClass(status: string): string {
    if (status === 'done') return 'bg-green text-white';
    if (status === 'failed') return 'bg-red text-white';
    return 'bg-blue-lt';
}

function fail(err: unknown): void {
    error.value = err instanceof Error ? err : new Error(String(err));
}

onMounted(async () => {
    alive = true;
    await Promise.all([loadObjects(), loadBot(), loadModel(), loadOrders()]);
    loading.value = false;
});

onUnmounted(() => {
    alive = false;
    if (ordersTimer) clearTimeout(ordersTimer);
    if (modelTimer) clearTimeout(modelTimer);
});

async function refresh(): Promise<void> {
    await Promise.all([loadBot(), loadModel(), loadOrders()]);
}

async function loadObjects(): Promise<void> {
    try {
        objects.value = mapObjects(await mapStore.worker.db.filter(OBJECT_FILTER, { mission: true }));
    } catch {
        objects.value = [];
    }
}

async function loadBot(): Promise<void> {
    try {
        bot.value = findBotContact(await ContactManager.list());
    } catch {
        bot.value = undefined;
    }
}

/** Poll the model every 5 s, only while the menu is open and the machine is starting or stopping. */
function scheduleModel(): void {
    if (modelTimer) clearTimeout(modelTimer);
    modelTimer = undefined;
    if (!alive || !modelChanging(model.value)) return;
    modelTimer = setTimeout(() => { void loadModel(); }, AI_POLL_MS);
}

/** Poll the orders every 5 s, only while the menu is open and an order is queued or running. */
function scheduleOrders(): void {
    if (ordersTimer) clearTimeout(ordersTimer);
    ordersTimer = undefined;
    if (!alive || !orders.value.some(isPending)) return;
    ordersTimer = setTimeout(() => { void loadOrders(); }, AI_POLL_MS);
}

async function loadModel(): Promise<void> {
    try {
        model.value = await getModel();
    } catch (err) {
        fail(err);
    } finally {
        scheduleModel();
    }
}

async function loadOrders(): Promise<void> {
    try {
        orders.value = await listOrders();
        error.value = undefined;
    } catch (err) {
        fail(err);
    } finally {
        scheduleOrders();
    }
}

async function toggle(): Promise<void> {
    const what = action.value;
    if (!what) return;
    switching.value = true;
    refusal.value = '';
    try {
        const res = what === 'start' ? await startModel() : await stopModel();
        if (res.result === 'refused') {
            refusal.value = res.reason
                ? t('aiChat.model.refused', { reason: res.reason })
                : t('aiChat.model.refusedNoReason');
        }
        error.value = undefined;
    } catch (err) {
        fail(err);
    } finally {
        switching.value = false;
    }
    await loadModel();
}

async function openBotChat(): Promise<void> {
    if (!bot.value) return;
    await router.push(botChatPath(bot.value));
}

async function create(): Promise<void> {
    if (problem.value) return;
    busy.value = true;
    created.value = false;
    try {
        await createOrder(toOrderRequest(form.value, objects.value), attachments.value.map(a => a.file));
        form.value = { ...defaultOrderForm(), format: form.value.format };
        attachments.value = [];
        created.value = true;
        error.value = undefined;
        await loadOrders();
    } catch (err) {
        fail(err);
    } finally {
        busy.value = false;
    }
}

async function download(order: AiOrder): Promise<void> {
    try {
        await downloadUrl(orderUrl(order.id, order.format), { token: true });
    } catch (err) {
        fail(err);
    }
}

async function remove(order: AiOrder): Promise<void> {
    try {
        await deleteOrder(order.id);
        await loadOrders();
    } catch (err) {
        fail(err);
    }
}
</script>

<style scoped>
.status-dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
}

.bubble {
    max-width: 85%;
    padding: 0.5rem 0.75rem;
    border-radius: 0.75rem;
}

.bubble-request {
    background: rgba(32, 107, 196, 0.25);
    border-bottom-right-radius: 0.2rem;
}

.bubble-answer {
    background: rgba(255, 255, 255, 0.08);
    border-bottom-left-radius: 0.2rem;
    min-width: 60%;
}
</style>
