<template>
    <div class='col-12'>
        <SlideDownHeader
            v-model='expanded'
            :label='t("property.bioSensor.title")'
        >
            <template #icon>
                <IconBiohazard
                    :size='18'
                    stroke='1'
                    color='#6b7990'
                    class='ms-2 me-1'
                />
            </template>

            <div class='mx-2 py-2'>
                <div class='rounded px-2 pb-2'>
                    <div class='d-flex align-items-center mt-2 mb-3'>
                        <IconInfoCircle
                            :size='16'
                            stroke='1'
                            class='me-2 text-muted'
                        />
                        <label class='subheader m-0'>{{ t('property.sensorData.information') }}</label>
                    </div>
                    <div class='datagrid'>
                        <div class='datagrid-item'>
                            <div class='datagrid-title'>
                                {{ t('property.sensorData.manufacturer') }}
                            </div>
                            <div
                                class='datagrid-content'
                                v-text='biosensordetail.sensor_data.manufacturer'
                            />
                        </div>
                        <div class='datagrid-item'>
                            <div class='datagrid-title'>
                                {{ t('property.sensorData.model') }}
                            </div>
                            <div
                                class='datagrid-content'
                                v-text='biosensordetail.sensor_data.model'
                            />
                        </div>
                        <div class='datagrid-item'>
                            <div class='datagrid-title'>
                                {{ t('property.sensorData.serialNumber') }}
                            </div>
                            <div
                                class='datagrid-content'
                                v-text='biosensordetail.sensor_data.serialnumber'
                            />
                        </div>
                        <div
                            v-if='biosensordetail.sensor_data.batterylevel !== undefined'
                            class='datagrid-item'
                        >
                            <div class='datagrid-title'>
                                {{ t('property.sensorData.battery') }}
                            </div>
                            <div
                                class='datagrid-content'
                                v-text='biosensordetail.sensor_data.batterylevel + "%"'
                            />
                        </div>
                        <div
                            v-if='biosensordetail.sensor_data.status'
                            class='datagrid-item'
                        >
                            <div class='datagrid-title'>
                                {{ t('property.sensorData.status') }}
                            </div>
                            <div
                                class='datagrid-content'
                                v-text='biosensordetail.sensor_data.status'
                            />
                        </div>
                        <div
                            v-if='biosensordetail.sensor_data.callsign'
                            class='datagrid-item'
                        >
                            <div class='datagrid-title'>
                                {{ t('property.sensorData.callsign') }}
                            </div>
                            <div
                                class='datagrid-content'
                                v-text='biosensordetail.sensor_data.callsign'
                            />
                        </div>
                    </div>

                    <div
                        v-if='biosensordetail.measurement && biosensordetail.measurement.length > 0'
                        class='mt-4'
                    >
                        <div class='d-flex align-items-center mb-3'>
                            <IconActivity
                                :size='16'
                                stroke='1'
                                class='me-2 text-muted'
                            />
                            <label class='subheader m-0'>{{ t('property.sensorData.measurements') }}</label>
                        </div>
                        <div class='table-responsive rounded mt-1'>
                            <table class='table card-table table-hover table-vcenter datatable table-sm'>
                                <thead>
                                    <tr>
                                        <th>{{ t('property.sensorData.class') }}</th>
                                        <th>{{ t('property.sensorData.type') }}</th>
                                        <th>{{ t('property.bioSensor.dose') }}</th>
                                        <th>{{ t('property.bioSensor.harmful') }}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr
                                        v-for='(measurement, idx) in biosensordetail.measurement'
                                        :key='idx'
                                    >
                                        <td v-text='measurement.bioClass || "-"' />
                                        <td v-text='measurement.type || "-"' />
                                        <td v-text='measurement.dose.toFixed(2)' />
                                        <td>
                                            <span
                                                :class='measurement.harmful ? "text-danger fw-bold" : "text-muted"'
                                                v-text='measurement.harmful ? t("property.bioSensor.yes") : t("property.bioSensor.no")'
                                            />
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </SlideDownHeader>
    </div>
</template>

<script setup lang='ts'>
import { ref } from 'vue';
import { IconBiohazard, IconInfoCircle, IconActivity } from '@tabler/icons-vue';
import SlideDownHeader from '../util/SlideDownHeader.vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

interface BioSensorData {
    manufacturer: string;
    model: string;
    serialnumber: string;
    batterylevel?: number;
    callsign?: string;
    status?: string;
}

interface BioMeasurement {
    bioClass?: string;
    type?: string;
    dose: number;
    harmful?: boolean;
    time: string;
    channel?: number;
    doseTime?: number;
    confidence?: number;
    confirmationLevel?: string;
    concentration?: number;
    sampleId?: string;
    persistency?: string;
}

interface BioSensorDetail {
    sensor_data: BioSensorData;
    measurement?: BioMeasurement[];
}

defineProps<{
    biosensordetail: BioSensorDetail
}>();

const expanded = ref(false);
</script>
