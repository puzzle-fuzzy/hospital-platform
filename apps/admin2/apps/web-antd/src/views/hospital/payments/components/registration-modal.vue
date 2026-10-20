<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, ref } from 'vue';
import {
  Alert,
  Button,
  Descriptions,
  DescriptionsItem,
  Input,
  Modal,
  Space,
  message,
} from 'ant-design-vue';
import {
  cancelRegistration,
  fetchRegistrationStatus,
  isReadOnlySession,
} from '#/hospital/api';
import { formatAdminTime } from '#/hospital/admin-time';
import { getHospitalSession, handleHospitalError } from '#/hospital/session';
import {
  canCancelRegistration,
  cancellationAttemptStorageKey,
  readCancellationAttempt,
  registrationPaymentLabel,
  registrationStatusLabel,
  validCancellationReason,
} from '#/hospital/registration-display';
import type { RegistrationCancellationAttempt } from '#/hospital/registration-display';
import type {
  AdminRegistrationStatus,
  AdminWechatRefundPaymentRecord,
} from '#/hospital/types';

const emit = defineEmits<{ updated: [] }>();
const visible = ref(false);
const confirmOpen = ref(false);
const record = ref<AdminWechatRefundPaymentRecord>();
const detail = ref<AdminRegistrationStatus>();
const loading = ref(false);
const submitting = ref(false);
const error = ref('');
const reason = ref('');
const attempt = ref<RegistrationCancellationAttempt>();
const readOnly = ref(true);
let generation = 0;
const cancellable = computed(
  () =>
    !readOnly.value &&
    !loading.value &&
    !submitting.value &&
    !error.value &&
    !attempt.value?.needsQuery &&
    canCancelRegistration(detail.value) &&
    validCancellationReason(reason.value),
);

function close() {
  if (submitting.value) return;
  generation++;
  visible.value = false;
  confirmOpen.value = false;
  detail.value = undefined;
  record.value = undefined;
}

async function refresh() {
  const selected = record.value;
  if (!selected || readOnly.value || submitting.value) return;
  const current = ++generation;
  loading.value = true;
  error.value = '';
  try {
    const result = await fetchRegistrationStatus(
      selected.source,
      selected.orderId,
      getHospitalSession(),
    );
    if (current !== generation || !visible.value) return;
    detail.value = result.registration;
    const previous = readCancellationAttempt(
      sessionStorage,
      cancellationAttemptStorageKey(selected),
    );
    if (previous) {
      const checked = { ...previous, needsQuery: false };
      sessionStorage.setItem(
        cancellationAttemptStorageKey(selected),
        JSON.stringify(checked),
      );
      attempt.value = checked;
      reason.value = checked.reason;
    }
    emit('updated');
  } catch (cause) {
    if (current === generation && visible.value)
      error.value = handleHospitalError(
        cause,
        '挂号状态加载失败，请核对后再操作',
      );
  } finally {
    if (current === generation) loading.value = false;
  }
}

function open(selected: AdminWechatRefundPaymentRecord) {
  if (submitting.value || selected.business !== 'registration') return;
  generation++;
  record.value = selected;
  detail.value = selected.registration;
  error.value = '';
  confirmOpen.value = false;
  attempt.value = readCancellationAttempt(
    sessionStorage,
    cancellationAttemptStorageKey(selected),
  );
  reason.value = attempt.value?.reason || '';
  try {
    readOnly.value = isReadOnlySession(getHospitalSession());
  } catch (cause) {
    error.value = handleHospitalError(cause, '请先登录');
    readOnly.value = true;
  }
  visible.value = true;
  if (!readOnly.value) void refresh();
}

async function submit() {
  const selected = record.value;
  if (!selected || !cancellable.value) return;
  submitting.value = true;
  generation++;
  const currentAttempt = attempt.value || {
    idempotencyKey: `admin-cancel:${crypto.randomUUID()}`,
    reason: reason.value.trim(),
    needsQuery: true,
  };
  const pending = { ...currentAttempt, needsQuery: true };
  let sent = false;
  try {
    sessionStorage.setItem(
      cancellationAttemptStorageKey(selected),
      JSON.stringify(pending),
    );
    attempt.value = pending;
    sent = true;
    const result = await cancelRegistration(
      selected.source,
      selected.orderId,
      currentAttempt.reason,
      currentAttempt.idempotencyKey,
      getHospitalSession(),
    );
    detail.value = result.registration;
    confirmOpen.value = false;
    sessionStorage.removeItem(cancellationAttemptStorageKey(selected));
    attempt.value = undefined;
    reason.value = '';
    message.success(
      result.outcome === 'already_cancelled'
        ? '医院已确认该挂号已取消'
        : '挂号已取消',
    );
    emit('updated');
  } catch (cause) {
    confirmOpen.value = false;
    if (!sent) {
      error.value =
        '当前标签页无法保存操作单号，本次未提交取消请求，请检查浏览器会话存储后再试。';
    } else {
      attempt.value = pending;
      error.value = `${handleHospitalError(
        cause,
        '取消结果未能确认',
      )}。请先刷新挂号状态，核对后再决定是否重试；将沿用原操作单号和原因。`;
    }
  } finally {
    submitting.value = false;
  }
}

defineExpose({ open });
onDeactivated(() => {
  if (!submitting.value) close();
});
onBeforeUnmount(() => {
  generation++;
});
</script>

<template>
  <Modal
    :open="visible"
    title="挂号详情"
    :width="720"
    :closable="!submitting"
    :mask-closable="!submitting"
    :keyboard="!submitting"
    @cancel="close"
  >
    <Alert v-if="error" :message="error" type="error" show-icon class="mb-4" />
    <Alert
      v-if="attempt?.needsQuery"
      message="上一次取消结果尚未确认，请先刷新挂号状态。"
      type="warning"
      show-icon
      class="mb-4"
    />
    <Descriptions bordered :column="2" size="small">
      <DescriptionsItem label="订单号" :span="2">{{
        record?.orderId
      }}</DescriptionsItem>
      <DescriptionsItem label="就诊人">{{
        record?.patientDisplayName || '未关联'
      }}</DescriptionsItem>
      <DescriptionsItem label="挂号状态">{{
        registrationStatusLabel(detail)
      }}</DescriptionsItem>
      <DescriptionsItem label="医院支付状态">{{
        detail
          ? registrationPaymentLabel(detail.hospitalPaymentStatus)
          : '待核对'
      }}</DescriptionsItem>
      <DescriptionsItem label="核对时间">{{
        detail?.checkedAt ? formatAdminTime(detail.checkedAt) : '尚未核对'
      }}</DescriptionsItem>
      <DescriptionsItem label="科室 / 医生"
        >{{ detail?.departmentName || '—' }} /
        {{ detail?.doctorName || '—' }}</DescriptionsItem
      >
      <DescriptionsItem label="就诊日期"
        >{{ detail?.workDate || '—' }}
        {{ detail?.shiftName || '' }}</DescriptionsItem
      >
      <DescriptionsItem label="取消条件" :span="2">{{
        detail?.cancellation.reason || '请先核对挂号状态'
      }}</DescriptionsItem>
    </Descriptions>
    <div v-if="!readOnly" class="mt-4 space-y-2">
      <Alert
        message="此入口仅执行医院允许的取消挂号；支付退款请使用支付记录中的退费功能。"
        type="info"
        show-icon
      />
      <Input.TextArea
        v-model:value="reason"
        :maxlength="80"
        :disabled="submitting || !!attempt"
        placeholder="取消原因，2–80 个字"
        :rows="2"
      />
    </div>
    <template #footer>
      <Space>
        <Button :disabled="submitting" @click="close">关闭</Button>
        <Button
          v-if="!readOnly"
          :loading="loading"
          :disabled="submitting"
          @click="refresh"
          >刷新挂号状态</Button
        >
        <Button
          v-if="!readOnly"
          danger
          :disabled="!cancellable"
          @click="confirmOpen = true"
          >取消挂号</Button
        >
      </Space>
    </template>
  </Modal>
  <Modal
    v-model:open="confirmOpen"
    title="确认取消挂号"
    ok-text="确认取消"
    :ok-button-props="{ danger: true, disabled: !cancellable }"
    :confirm-loading="submitting"
    :cancel-button-props="{ disabled: submitting }"
    :closable="!submitting"
    :mask-closable="false"
    :keyboard="!submitting"
    @ok="submit"
  >
    <p>确认取消 {{ record?.patientDisplayName || '该就诊人' }} 的挂号？</p>
    <p class="mt-2">原因：{{ attempt?.reason || reason.trim() }}</p>
  </Modal>
</template>
