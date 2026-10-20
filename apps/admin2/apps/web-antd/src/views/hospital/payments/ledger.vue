<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Page } from '@vben/common-ui';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Empty,
  Input,
  Spin,
  Table,
  Tag,
} from 'ant-design-vue';
import { fetchPaymentOperationDetail } from '#/hospital/api';
import { formatAdminTime } from '#/hospital/admin-time';
import {
  formatPaymentAmount,
  paymentAmountLines,
} from '#/hospital/payment-amount-display';
import { getHospitalSession, handleHospitalError } from '#/hospital/session';
import type { AdminPaymentOperationDetail } from '#/hospital/types';
import { label, statusColor } from './payment-labels';

defineOptions({ name: 'HospitalPaymentLedger' });

const route = useRoute();
const router = useRouter();
const aggregateId = ref('');
const loading = ref(false);
const error = ref('');
const detail = ref<AdminPaymentOperationDetail>();
let generation = 0;
const legColumns = [
  { title: '金额分项', key: 'legType', width: 200 },
  { title: '来源', key: 'source', width: 160 },
  { title: '来源订单号', dataIndex: 'sourceOrderId', width: 280 },
  { title: '金额', key: 'amount', width: 200 },
  { title: '状态', key: 'status', width: 130 },
  { title: '确认时间', key: 'confirmedAt', width: 190 },
  { title: '版本', dataIndex: 'version', width: 80 },
];
const eventColumns = [
  { title: '发生时间', key: 'eventAt', width: 185 },
  { title: '来源', key: 'source', width: 150 },
  { title: '事件', dataIndex: 'eventType', width: 210 },
  { title: '状态变化', key: 'status', width: 230 },
  { title: '金额', key: 'amount', width: 170 },
  { title: '上游请求号', dataIndex: 'providerRequestId', width: 250 },
  { title: '事件摘要', dataIndex: 'payloadDigest', width: 280 },
];
async function load(id = aggregateId.value.trim()) {
  const current = ++generation;
  detail.value = undefined;
  error.value = '';
  if (!id) {
    loading.value = false;
    return;
  }
  if (!/^payagg-[a-f0-9]{56}$/u.test(id)) {
    error.value = '请输入有效的支付账本编号，或从支付记录点击“查看账本”。';
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const result = await fetchPaymentOperationDetail(id, getHospitalSession());
    if (current === generation) detail.value = result;
  } catch (cause) {
    if (current === generation)
      error.value = handleHospitalError(cause, '支付账本加载失败');
  } finally {
    if (current === generation) loading.value = false;
  }
}
function search() {
  const id = aggregateId.value.trim();
  if (route.query.aggregateId === id) void load(id);
  else void router.replace({ query: { aggregateId: id } });
}
watch(
  () => route.query.aggregateId,
  (value) => {
    aggregateId.value = typeof value === 'string' ? value : '';
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation++;
  detail.value = undefined;
});
</script>

<template>
  <Page
    content-class="flex flex-col gap-4"
    title="支付账本"
    description="核对一笔支付的原始金额事实、分项状态和平台事件。"
  >
    <Card>
      <form class="flex flex-wrap gap-3" @submit.prevent="search">
        <Input
          v-model:value="aggregateId"
          placeholder="从支付记录进入，或输入支付账本编号"
          aria-label="支付账本编号"
          style="max-width: 660px"
        /><Button type="primary" html-type="submit" :loading="loading"
          >查询</Button
        ><Button @click="router.push('/hospital/payments/records')"
          >返回支付记录</Button
        >
      </form>
    </Card>
    <Alert v-if="error" :message="error" type="error" show-icon />
    <Spin :spinning="loading">
      <div v-if="detail" class="flex flex-col gap-4">
        <Card title="订单概况">
          <template #extra
            ><Button
              @click="
                router.push({
                  path: '/hospital/payments/sync',
                  query: { aggregateId: detail.aggregate.aggregateId },
                })
              "
              >查看同步任务</Button
            ></template
          >
          <Descriptions bordered :column="2" size="small">
            <DescriptionsItem label="账本编号" :span="2">{{
              detail.aggregate.aggregateId
            }}</DescriptionsItem>
            <DescriptionsItem label="业务">{{
              label(detail.aggregate.business)
            }}</DescriptionsItem
            ><DescriptionsItem label="业务订单号">{{
              detail.aggregate.businessId
            }}</DescriptionsItem>
            <DescriptionsItem label="支付状态"
              ><Tag :color="statusColor(detail.aggregate.status)">{{
                label(detail.aggregate.status)
              }}</Tag></DescriptionsItem
            ><DescriptionsItem label="医院同步状态">{{
              label(detail.aggregate.hisSyncStatus)
            }}</DescriptionsItem>
            <DescriptionsItem label="创建时间">{{
              formatAdminTime(detail.aggregate.createdAt)
            }}</DescriptionsItem
            ><DescriptionsItem label="更新时间">{{
              formatAdminTime(detail.aggregate.updatedAt)
            }}</DescriptionsItem>
            <DescriptionsItem label="来源版本 / 账本版本"
              >{{ detail.aggregate.sourceVersion }} /
              {{ detail.aggregate.version }}</DescriptionsItem
            ><DescriptionsItem label="业务关联号">{{
              detail.aggregate.businessKey
            }}</DescriptionsItem>
          </Descriptions>
          <div class="mt-4 flex flex-wrap gap-x-8 gap-y-2">
            <div
              v-for="line in paymentAmountLines(
                detail.aggregate,
                detail.legs.some(
                  (leg) =>
                    leg.legType === 'wechat_cash' &&
                    ['confirmed', 'refunded'].includes(leg.status),
                ),
              )"
              :key="line"
            >
              {{ line }}
            </div>
          </div>
        </Card>
        <Card title="支付金额分项"
          ><Table
            :columns="legColumns"
            :data-source="[...detail.legs]"
            row-key="legId"
            :pagination="false"
            :scroll="{ x: 1280 }"
            ><template #bodyCell="{ column, record }"
              ><template v-if="column.key === 'legType'">{{
                label(record.legType)
              }}</template
              ><template v-else-if="column.key === 'source'">{{
                label(record.source)
              }}</template
              ><template v-else-if="column.key === 'amount'">{{
                formatPaymentAmount(record.amountFen)
              }}</template
              ><template v-else-if="column.key === 'status'"
                ><Tag :color="statusColor(record.status)">{{
                  label(record.status)
                }}</Tag></template
              ><template v-else-if="column.key === 'confirmedAt'">{{
                record.confirmedAt
                  ? formatAdminTime(record.confirmedAt)
                  : '尚未确认'
              }}</template></template
            ></Table
          ></Card
        >
        <Card title="账本事件"
          ><Table
            :columns="eventColumns"
            :data-source="[...detail.events]"
            row-key="eventId"
            :pagination="{ pageSize: 12, showSizeChanger: false }"
            :scroll="{ x: 1540 }"
            ><template #bodyCell="{ column, record }"
              ><template v-if="column.key === 'eventAt'">{{
                formatAdminTime(record.eventAt)
              }}</template
              ><template v-else-if="column.key === 'source'">{{
                label(record.source)
              }}</template
              ><template v-else-if="column.key === 'status'"
                >{{ label(record.previousStatus) }} →
                {{ label(record.nextStatus) }}</template
              ><template v-else-if="column.key === 'amount'">{{
                record.amountFen === undefined
                  ? '—'
                  : formatPaymentAmount(record.amountFen)
              }}</template></template
            ></Table
          ></Card
        >
      </div>
      <Card v-else-if="!loading"
        ><Empty description="请从支付记录选择一笔订单，查看对应账本。"
      /></Card>
    </Spin>
  </Page>
</template>
