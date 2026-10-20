<script lang="ts" setup>
import type {
  AdminPaymentRefundType,
  AdminWechatRefundPaymentRecord,
} from '#/hospital/types';

import { computed } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import {
  Alert,
  Button,
  Descriptions,
  DescriptionsItem,
  Input,
  Space,
  Tag,
} from 'ant-design-vue';

import {
  PAYMENT_REFUND_LABELS,
  paymentRefundLabel,
  registrationRefundFeedback,
} from '#/hospital/payment-refund-options';

import {
  refundResultLabel,
  usePaymentRefund,
} from '../composables/use-payment-refund';

const emit = defineEmits<{ updated: [] }>();
const refund = usePaymentRefund(() => emit('updated'));
const {
  busy,
  error,
  needsQuery,
  nextRefundType,
  preview,
  querying,
  reason,
  record,
  refundType,
  result,
  selectedOption,
  submitting,
} = refund;

const [Modal, modalApi] = useVbenModal({
  class: 'w-full max-w-[640px]',
  fullscreenButton: false,
  onBeforeClose: () => !busy.value,
});

const title = computed(() => {
  if (result.value)
    return registrationRefundFeedback(result.value)
      ? '退款与取消挂号进度'
      : '退款结果与渠道状态';
  return record.value
    ? `确认${paymentRefundLabel(record.value, refundType.value)}`
    : '确认退费';
});
const registrationFeedback = computed(() =>
  result.value ? registrationRefundFeedback(result.value) : undefined,
);
const resultAlertType = computed(() => {
  if (registrationFeedback.value) return registrationFeedback.value.type;
  if (result.value?.status === 'succeeded') return 'success';
  if (result.value?.status === 'manual_review') return 'warning';
  return result.value?.status === 'failed' ? 'error' : 'info';
});
const confirmedCashFen = computed(() =>
  result.value ? result.value.amounts.cashFen : preview.value?.cashFen,
);
const confirmedMedicalFen = computed(() =>
  result.value
    ? result.value.amounts.personalAccountFen + result.value.amounts.fundFen
    : preview.value?.medicalFen,
);

function fen(value: number | null | undefined) {
  return value === null || value === undefined
    ? '待核实'
    : `¥${(value / 100).toFixed(2)}`;
}

function legLabel(status: string) {
  return (
    {
      abnormal: '异常',
      closed: '已关闭',
      failed: '失败',
      not_required: '无需退款',
      processing: '处理中',
      request_failed: '申请失败',
      requested: '已申请',
      success: '已成功',
      unknown: '结果未确认',
    }[status] ?? status
  );
}

function open(
  selected: AdminWechatRefundPaymentRecord,
  type: AdminPaymentRefundType = 'ALL',
) {
  if (refund.open(selected, type)) modalApi.open();
}

async function query(
  selected: AdminWechatRefundPaymentRecord,
  type?: AdminPaymentRefundType,
) {
  // The async state starts synchronously; show the existing Vben modal while
  // waiting instead of leaving a status-changing query invisible to operators.
  const work = refund.query(selected, type);
  if (refund.querying.value) modalApi.open();
  await work;
}

defineExpose({
  busy: refund.busy,
  open,
  query,
  queryingKey: refund.queryingKey,
  queryRequiredOrders: refund.queryRequiredOrders,
});
</script>

<template>
  <Modal
    :title="title"
    :closable="!busy"
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
  >
    <Space v-if="record" direction="vertical" :size="16" class="w-full">
      <Alert
        :type="result ? 'info' : 'warning'"
        show-icon
        :message="PAYMENT_REFUND_LABELS[result?.refundType ?? refundType]"
        :description="
          record.source === 'payment_order' &&
          record.refundRoute === 'appointment_cancel'
            ? '退款按原微信支付渠道退回。确认原实付款已全额退回后，系统会请求医院取消挂号；医院退费回写结果单独核对。'
            : '退款按原支付渠道退回。医院减免不属于实付金额，不计入本次退款。'
        "
      />
      <Descriptions bordered size="small" :column="1">
        <DescriptionsItem label="就诊人">
          {{ record.patientDisplayName?.trim() || '未关联就诊人' }}
        </DescriptionsItem>
        <DescriptionsItem label="订单号">
          <span class="break-all">{{ record.orderId }}</span>
        </DescriptionsItem>
        <DescriptionsItem
          :label="result ? '所选范围金额（含已退）' : '本次退费金额'"
        >
          <span class="text-base font-semibold">
            {{ fen(result?.amounts.totalFen ?? selectedOption?.amountFen) }}
          </span>
        </DescriptionsItem>
        <DescriptionsItem
          :label="result ? '所选渠道实付（含已退）' : '原渠道退款'"
        >
          医保 {{ fen(confirmedMedicalFen) }}；微信 {{ fen(confirmedCashFen) }}
        </DescriptionsItem>
        <DescriptionsItem label="医院减免（不退款）">
          {{ fen(record.hospitalDiscountFen) }}
        </DescriptionsItem>
      </Descriptions>

      <Alert v-if="error" type="error" show-icon :message="error" />
      <Alert
        v-if="result"
        :type="resultAlertType"
        show-icon
        :message="refundResultLabel(result)"
      >
        <template #description>
          <Space direction="vertical" :size="6" class="w-full">
            <p v-if="registrationFeedback" class="mb-0">
              {{ registrationFeedback.description }}
            </p>
            <div v-if="result.medicalRefund">
              <Tag
                >医保：{{ legLabel(result.medicalRefund.medicalStatus) }}</Tag
              >
              <span class="break-all text-xs">{{
                result.medicalRefund.refundNo
              }}</span>
            </div>
            <div v-else>医保退款：本次未发起</div>
            <div v-if="result.wechatRefund">
              <Tag>微信：{{ legLabel(result.wechatRefund.status) }}</Tag>
              <span class="break-all text-xs">{{
                result.wechatRefund.merchantRefundNo
              }}</span>
            </div>
            <div v-else>
              微信退款：{{
                result.medicalRefund
                  ? legLabel(result.medicalRefund.wechatStatus)
                  : '本次未发起'
              }}
            </div>
            <p
              v-if="result.status === 'manual_review' && !registrationFeedback"
              class="mb-0"
            >
              请查询最新状态，分别核对医保、微信与医院回执。结果未确认的渠道不能重复退款。
            </p>
          </Space>
        </template>
      </Alert>
      <Alert
        v-if="needsQuery"
        type="warning"
        show-icon
        :message="
          querying
            ? '正在查询退款状态…'
            : '退款结果或剩余退款能力尚未确认，请先查询最新状态。'
        "
      />
      <template v-if="!result && !needsQuery">
        <Alert
          v-if="!selectedOption?.enabled"
          type="warning"
          show-icon
          :message="selectedOption?.reason || '当前范围不可退款'"
        />
        <label class="block">
          <span class="mb-2 block font-medium">退费原因</span>
          <Input.TextArea
            v-model:value="reason"
            :maxlength="80"
            :rows="3"
            show-count
            :disabled="busy"
            placeholder="退费原因（可选）"
          />
        </label>
      </template>
    </Space>
    <template #footer>
      <Space wrap>
        <Button :disabled="busy" @click="modalApi.close()">关闭</Button>
        <template v-if="result || needsQuery">
          <Button
            :loading="querying"
            :disabled="submitting || !record"
            @click="record && query(record, result?.refundType ?? refundType)"
          >
            查询最新状态
          </Button>
          <Button
            v-if="nextRefundType"
            :disabled="busy"
            @click="refund.prepareRemaining()"
          >
            退剩余款项
          </Button>
        </template>
        <Button
          v-else
          type="primary"
          danger
          :loading="submitting"
          :disabled="busy || !selectedOption?.enabled"
          @click="refund.submit()"
        >
          确认退款 {{ fen(selectedOption?.amountFen) }}
        </Button>
      </Space>
    </template>
  </Modal>
</template>
