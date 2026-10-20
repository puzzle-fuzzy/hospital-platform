<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Page } from '@vben/common-ui';
import {
  Alert,
  Button,
  Card,
  Input,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';
import {
  fetchWechatRefundPaymentHistory,
  isReadOnlySession,
} from '#/hospital/api';
import { formatAdminTime } from '#/hospital/admin-time';
import {
  paymentAmountLines,
  formatPaymentAmount,
} from '#/hospital/payment-amount-display';
import {
  PAYMENT_REFUND_TYPES,
  hasRefundReceipt,
  paymentRefundKey,
  paymentRefundLabel,
  paymentRefundOption,
} from '#/hospital/payment-refund-options';
import { registrationStatusLabel } from '#/hospital/registration-display';
import { getHospitalSession, handleHospitalError } from '#/hospital/session';
import type {
  AdminWechatRefundPaymentHistoryQuery,
  AdminWechatRefundPaymentRecord,
} from '#/hospital/types';
import PaymentRefundModal from './components/payment-refund-modal.vue';
import RegistrationModal from './components/registration-modal.vue';
import { usePaymentRefundLocks } from './composables/use-payment-refund';
import {
  businessOptions,
  label,
  sourceOptions,
  stateOptions,
  statusColor,
} from './payment-labels';

defineOptions({ name: 'HospitalPaymentRecords' });

const router = useRouter();
const refundLocks = usePaymentRefundLocks();
const filters = reactive<AdminWechatRefundPaymentHistoryQuery>({
  orderId: '',
  page: 1,
  pageSize: 8,
});
const appliedFilters = ref<AdminWechatRefundPaymentHistoryQuery>({
  page: 1,
  pageSize: 8,
});
const records = ref<AdminWechatRefundPaymentRecord[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref('');
const readOnly = ref(true);
const refundModal = ref<InstanceType<typeof PaymentRefundModal>>();
const registrationModal = ref<InstanceType<typeof RegistrationModal>>();
let generation = 0;
const medicalCount = computed(
  () =>
    records.value.filter((item) => item.source === 'medical_insurance').length,
);
const confirmedCount = computed(
  () =>
    records.value.filter(
      (item) =>
        item.actualCashFen !== null &&
        item.actualCashFen > 0 &&
        item.cashPaymentConfirmed,
    ).length,
);
const refundableCash = computed(() =>
  records.value.reduce((sum, item) => sum + item.refundableFen, 0),
);
const columns = [
  { title: '更新时间（北京时间）', key: 'updatedAt', width: 180 },
  { title: '业务 / 支付来源', key: 'business', width: 160 },
  { title: '就诊人 / 下单用户', key: 'person', width: 180 },
  { title: '订单号', dataIndex: 'orderId', key: 'orderId', width: 275 },
  { title: '支付 / 挂号状态', key: 'status', width: 220 },
  { title: '金额明细', key: 'amounts', width: 275 },
  { title: '退款台账', key: 'refund', width: 240 },
  { title: '操作', key: 'actions', fixed: 'right' as const, width: 300 },
];

async function load(nextPage = page.value, apply = false) {
  const current = ++generation;
  if (apply) appliedFilters.value = { ...filters, pageSize: 8 };
  loading.value = true;
  error.value = '';
  try {
    const session = getHospitalSession();
    readOnly.value = isReadOnlySession(session);
    const result = await fetchWechatRefundPaymentHistory(
      { ...appliedFilters.value, page: nextPage, pageSize: 8 },
      session,
    );
    if (current !== generation) return;
    records.value = [...result.items];
    total.value = result.total;
    page.value = result.page;
  } catch (cause) {
    if (current === generation)
      error.value = handleHospitalError(cause, '支付记录加载失败');
  } finally {
    if (current === generation) loading.value = false;
  }
}
function reset() {
  Object.assign(filters, {
    orderId: '',
    source: undefined,
    business: undefined,
    businessDay: undefined,
    status: undefined,
  });
  void load(1, true);
}
function ledger(record: AdminWechatRefundPaymentRecord) {
  if (record.operationAggregateId)
    void router.push({
      path: '/hospital/payments/ledger',
      query: { aggregateId: record.operationAggregateId },
    });
}
function queryRefund(record: AdminWechatRefundPaymentRecord) {
  if (readOnly.value || refundLocks.busy.value) return;
  const type =
    record.latestMedicalRefund &&
    !record.latestRefund &&
    record.latestMedicalRefund.wechatStatus === 'not_required'
      ? 'HI'
      : record.latestMedicalRefund
        ? 'ALL'
        : 'CASH';
  void refundModal.value?.query(record, type);
}
onMounted(() => void load(1));
onBeforeUnmount(() => {
  generation++;
});
</script>

<template>
  <Page
    title="支付记录"
    description="按订单核对支付事实、医保与微信金额，以及退款和挂号状态。"
  >
    <Alert
      v-if="readOnly"
      message="当前为只读查看账号，可查看支付记录与账本。"
      type="info"
      show-icon
      class="mb-4"
    />
    <div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card
        ><Statistic title="符合条件的订单" :value="total" suffix="笔"
      /></Card>
      <Card
        ><Statistic title="当前页医保订单" :value="medicalCount" suffix="笔"
      /></Card>
      <Card
        ><Statistic
          title="当前页微信已确认"
          :value="confirmedCount"
          suffix="笔"
      /></Card>
      <Card
        ><Statistic
          title="当前页微信可退余额"
          :value="refundableCash / 100"
          :precision="2"
          prefix="¥"
      /></Card>
    </div>
    <Card title="全部支付记录">
      <form
        class="mb-4 flex flex-wrap items-center gap-3"
        @submit.prevent="load(1, true)"
      >
        <Input
          v-model:value="filters.orderId"
          allow-clear
          placeholder="订单号精确查询"
          :maxlength="64"
          style="width: 280px"
          aria-label="订单号"
        />
        <Select
          v-model:value="filters.source"
          allow-clear
          placeholder="全部来源"
          :options="sourceOptions"
          style="width: 160px"
          aria-label="支付来源"
        />
        <Select
          v-model:value="filters.business"
          allow-clear
          placeholder="全部业务"
          :options="businessOptions"
          style="width: 140px"
          aria-label="业务类型"
        />
        <Input
          v-model:value="filters.businessDay"
          type="date"
          aria-label="业务日"
          style="width: 170px"
        />
        <Select
          v-model:value="filters.status"
          allow-clear
          placeholder="全部状态"
          :options="stateOptions"
          style="width: 140px"
          aria-label="支付状态"
        />
        <Button type="primary" html-type="submit" :loading="loading"
          >查询</Button
        >
        <Button :disabled="loading" @click="reset">重置</Button>
        <Button :loading="loading" @click="load()">刷新</Button>
      </form>
      <Alert
        v-if="error"
        :message="error"
        type="error"
        show-icon
        class="mb-4"
      />
      <div class="mb-3 text-sm text-muted-foreground">
        更新时间是订单或结算上下文最后更新时间，并非支付完成时间。金额未确认时显示“待核实”。
      </div>
      <Table
        :columns="columns"
        :data-source="records"
        :loading="loading"
        :row-key="paymentRefundKey"
        :scroll="{ x: 1940 }"
        :pagination="{
          current: page,
          pageSize: 8,
          total,
          showSizeChanger: false,
          showTotal: (count: number) => `共 ${count} 笔`,
        }"
        @change="(pagination) => load(pagination.current || 1)"
      >
        <template #bodyCell="{ column, record: item }">
          <template
            v-for="record in [item as AdminWechatRefundPaymentRecord]"
            :key="paymentRefundKey(record)"
          >
            <template v-if="column.key === 'updatedAt'">{{
              formatAdminTime(record.updatedAt)
            }}</template>
            <template v-else-if="column.key === 'business'"
              ><div>{{ label(record.business) }}</div>
              <div class="mt-1 text-sm text-muted-foreground">
                {{
                  record.source === 'medical_insurance'
                    ? '医保支付订单'
                    : '普通微信支付'
                }}
              </div></template
            >
            <template v-else-if="column.key === 'person'"
              ><div>{{ record.patientDisplayName?.trim() || '未关联' }}</div>
              <div class="mt-1 text-sm text-muted-foreground">
                下单用户：{{ record.orderUserDisplayName?.trim() || '未设置' }}
              </div></template
            >
            <template v-else-if="column.key === 'status'"
              ><Tag :color="statusColor(record.paymentState)">{{
                label(record.paymentState)
              }}</Tag>
              <div v-if="record.medicalStatus" class="mt-1 text-sm">
                医保：{{ label(record.medicalStatus) }}
              </div>
              <div
                v-if="record.business === 'registration'"
                class="mt-1 text-sm"
              >
                {{ registrationStatusLabel(record.registration) }}
              </div></template
            >
            <template v-else-if="column.key === 'amounts'"
              ><div
                v-for="line in paymentAmountLines(
                  record,
                  record.cashPaymentConfirmed,
                )"
                :key="line"
                class="text-sm leading-6"
              >
                {{ line }}
              </div></template
            >
            <template v-else-if="column.key === 'refund'">
              <div v-if="record.latestMedicalRefund">
                医保：{{ label(record.latestMedicalRefund.medicalStatus) }}
                <div
                  v-if="
                    !record.latestRefund &&
                    record.latestMedicalRefund.wechatStatus !== 'not_required'
                  "
                >
                  微信：{{ label(record.latestMedicalRefund.wechatStatus) }}
                </div>
              </div>
              <div v-if="record.latestRefund">
                微信：{{ label(record.latestRefund.status) }} ·
                {{ formatPaymentAmount(record.latestRefund.refundFen) }}
              </div>
              <div
                v-if="!hasRefundReceipt(record)"
                class="text-muted-foreground"
              >
                暂无退款
              </div>
              <div class="mt-1 text-sm text-muted-foreground">
                剩余医保 {{ formatPaymentAmount(record.medicalRefundableFen) }}
              </div>
              <div class="text-sm text-muted-foreground">
                剩余微信 {{ formatPaymentAmount(record.refundableFen) }}
              </div>
            </template>
            <template v-else-if="column.key === 'actions'">
              <Space wrap :size="4"
                ><Button
                  type="link"
                  size="small"
                  :disabled="!record.operationAggregateId"
                  @click="ledger(record)"
                  >查看账本</Button
                ><Button
                  v-if="!readOnly && record.business === 'registration'"
                  type="link"
                  size="small"
                  :disabled="refundLocks.busy.value"
                  @click="registrationModal?.open(record)"
                  >查看挂号</Button
                ><Button
                  v-if="
                    !readOnly &&
                    (hasRefundReceipt(record) ||
                      refundModal?.queryRequiredOrders?.has(
                        paymentRefundKey(record),
                      ))
                  "
                  type="link"
                  size="small"
                  :loading="
                    refundModal?.queryingKey === paymentRefundKey(record)
                  "
                  :disabled="refundLocks.busy.value"
                  @click="queryRefund(record)"
                  >查询退款</Button
                ></Space
              >
              <Space v-if="!readOnly" wrap class="mt-2" :size="4"
                ><Tooltip
                  v-for="type in PAYMENT_REFUND_TYPES"
                  :key="type"
                  :title="
                    refundModal?.queryRequiredOrders?.has(
                      paymentRefundKey(record),
                    )
                      ? '退款结果尚未确认，请先查询'
                      : paymentRefundOption(record, type).reason
                  "
                  ><Button
                    danger
                    size="small"
                    :disabled="
                      refundLocks.busy.value ||
                      refundModal?.queryRequiredOrders?.has(
                        paymentRefundKey(record),
                      ) ||
                      !paymentRefundOption(record, type).enabled
                    "
                    @click="refundModal?.open(record, type)"
                    >{{ paymentRefundLabel(record, type) }}</Button
                  ></Tooltip
                ></Space
              >
            </template>
          </template>
        </template>
      </Table>
    </Card>
    <PaymentRefundModal ref="refundModal" @updated="load()" />
    <RegistrationModal ref="registrationModal" @updated="load()" />
  </Page>
</template>
