import type {
  AdminPaymentRefundResult,
  AdminPaymentRefundType,
  AdminWechatRefundPaymentRecord,
} from '#/hospital/types';

import { computed, reactive, ref } from 'vue';

import { message } from 'ant-design-vue';

import {
  fetchWechatRefundPaymentHistory,
  isReadOnlySession,
  queryMedicalInsuranceRefund,
  queryPaymentRefund,
  queryWechatRefund,
  requestPaymentRefund,
} from '#/hospital/api';
import {
  hasPendingRefund,
  PAYMENT_REFUND_TYPES,
  paymentRefundKey,
  paymentRefundOption,
  paymentRefundPreview,
  registrationRefundFeedback,
} from '#/hospital/payment-refund-options';
import { getHospitalSession, handleHospitalError } from '#/hospital/session';

// Keep the order lock across modal closes and route changes. A list refresh alone
// cannot establish the outcome of a request whose response was lost.
const queryRequiredOrders = reactive(new Set<string>());
const queryRequiredScopes = new Map<string, AdminPaymentRefundType>();
const busyOrders = reactive(new Map<string, 'query' | 'submit'>());

export function usePaymentRefundLocks() {
  return {
    busy: computed(() => busyOrders.size > 0),
    queryingKey: computed(
      () => [...busyOrders].find(([, action]) => action === 'query')?.[0],
    ),
    queryRequiredOrders,
  };
}

export function refundResultLabel(result: AdminPaymentRefundResult): string {
  return (
    registrationRefundFeedback(result)?.title ??
    {
      failed: '退费失败',
      manual_review: '需人工复核',
      processing: '退款处理中',
      requested: '退款已受理',
      succeeded: '退款已完成',
    }[result.status]
  );
}

export function defaultRefundQueryType(
  record: AdminWechatRefundPaymentRecord,
): AdminPaymentRefundType {
  if (
    record.latestMedicalRefund &&
    !record.latestRefund &&
    record.latestMedicalRefund.wechatStatus === 'not_required'
  )
    return 'HI';
  return record.latestMedicalRefund ? 'ALL' : 'CASH';
}

export function usePaymentRefund(onUpdated: () => void) {
  const record = ref<AdminWechatRefundPaymentRecord>();
  const refundType = ref<AdminPaymentRefundType>('ALL');
  const reason = ref('');
  const result = ref<AdminPaymentRefundResult>();
  const error = ref('');
  const needsQuery = ref(false);
  const capabilitiesFresh = ref(false);
  const submitting = ref(false);
  const querying = ref(false);
  const locks = usePaymentRefundLocks();

  const selectedOption = computed(() =>
    record.value
      ? paymentRefundOption(record.value, refundType.value)
      : undefined,
  );
  const preview = computed(() =>
    record.value
      ? paymentRefundPreview(record.value, refundType.value)
      : undefined,
  );
  const nextRefundType = computed(() => {
    const current = record.value;
    if (
      !current ||
      !result.value ||
      !capabilitiesFresh.value ||
      needsQuery.value ||
      queryRequiredOrders.has(paymentRefundKey(current))
    )
      return undefined;
    return PAYMENT_REFUND_TYPES.find(
      (type) => paymentRefundOption(current, type).enabled,
    );
  });

  function operatorAllowed(): boolean {
    try {
      if (!isReadOnlySession(getHospitalSession())) return true;
      message.warning('当前账号仅可查看，退费及退款状态查询需使用操作员账号。');
    } catch (error) {
      message.error(handleHospitalError(error, '请先登录管理后台'));
    }
    return false;
  }

  function open(
    selected: AdminWechatRefundPaymentRecord,
    type: AdminPaymentRefundType = 'ALL',
  ): boolean {
    if (locks.busy.value || !operatorAllowed()) return false;
    record.value = selected;
    refundType.value = type;
    reason.value = '';
    result.value = undefined;
    error.value = '';
    needsQuery.value = queryRequiredOrders.has(paymentRefundKey(selected));
    capabilitiesFresh.value = !needsQuery.value;
    return true;
  }

  async function refreshCapabilities(
    selected: AdminWechatRefundPaymentRecord,
    outcome: AdminPaymentRefundResult,
  ) {
    const key = paymentRefundKey(selected);
    const refreshed = await fetchWechatRefundPaymentHistory(
      {
        orderId: selected.orderId,
        page: 1,
        pageSize: 1,
        source: selected.source,
      },
      getHospitalSession(),
    );
    const fresh = refreshed.items.find(
      (item) => paymentRefundKey(item) === key,
    );
    if (!fresh)
      throw new Error(
        '退款结果已返回，但原订单退款能力尚未刷新，请查询最新状态。',
      );
    record.value = fresh;
    capabilitiesFresh.value = true;
    // Require both the actual refund outcome and a fresh order capability. In
    // particular an unknown channel receipt must never unlock another refund.
    if (
      outcome.status !== 'requested' &&
      outcome.status !== 'processing' &&
      !hasPendingRefund(fresh)
    ) {
      queryRequiredOrders.delete(key);
      queryRequiredScopes.delete(key);
    }
    needsQuery.value = queryRequiredOrders.has(key);
  }

  async function submit() {
    const selected = record.value;
    if (
      !selected ||
      locks.busy.value ||
      needsQuery.value ||
      queryRequiredOrders.has(paymentRefundKey(selected)) ||
      !selectedOption.value?.enabled ||
      !operatorAllowed()
    )
      return;

    const key = paymentRefundKey(selected);
    busyOrders.set(key, 'submit');
    queryRequiredOrders.add(key);
    queryRequiredScopes.set(key, refundType.value);
    submitting.value = true;
    needsQuery.value = true;
    capabilitiesFresh.value = false;
    error.value = '';
    try {
      const outcome = await requestPaymentRefund(
        {
          orderId: selected.orderId,
          refundType: refundType.value,
          source: selected.source,
          ...(reason.value.trim() ? { reason: reason.value.trim() } : {}),
        },
        getHospitalSession(),
      );
      result.value = outcome;
      message.info(refundResultLabel(outcome));
      await refreshCapabilities(selected, outcome);
    } catch (caught) {
      error.value = handleHospitalError(
        caught,
        '退款申请结果尚未确认，请先查询最新状态。',
      );
    } finally {
      busyOrders.delete(key);
      submitting.value = false;
      // Refresh display facts even when a request response is lost. This does
      // not remove the order lock or authorize a second submission.
      onUpdated();
    }
  }

  async function query(
    selected: AdminWechatRefundPaymentRecord,
    type?: AdminPaymentRefundType,
  ): Promise<boolean> {
    const key = paymentRefundKey(selected);
    // A lost ALL/HI response must be queried in the original scope even when
    // the old list has no receipt yet or its default query would select CASH.
    const selectedType =
      (queryRequiredOrders.has(key)
        ? queryRequiredScopes.get(key)
        : undefined) ??
      type ??
      defaultRefundQueryType(selected);
    if (!open(selected, selectedType)) return false;
    busyOrders.set(key, 'query');
    queryRequiredOrders.add(key);
    queryRequiredScopes.set(key, selectedType);
    querying.value = true;
    needsQuery.value = true;
    capabilitiesFresh.value = false;
    try {
      let outcome: AdminPaymentRefundResult;
      const session = getHospitalSession();
      if (!selected.refundOptions && selected.latestMedicalRefund) {
        const medicalRefund = await queryMedicalInsuranceRefund(
          selected.latestMedicalRefund.refundNo,
          session,
        );
        outcome = {
          amounts: medicalRefund.amounts,
          medicalRefund,
          orderId: selected.orderId,
          refundType: 'ALL',
          source: selected.source,
          status: medicalRefund.status,
        };
      } else if (!selected.refundOptions && selected.latestRefund) {
        const wechatRefund = await queryWechatRefund(
          selected.latestRefund.merchantRefundNo,
          session,
        );
        outcome = {
          amounts: {
            cashFen: wechatRefund.refundFen,
            fundFen: 0,
            personalAccountFen: 0,
            totalFen: wechatRefund.refundFen,
          },
          orderId: selected.orderId,
          refundType: 'CASH',
          source: selected.source,
          status:
            wechatRefund.status === 'success'
              ? 'succeeded'
              : ['abnormal', 'closed', 'request_failed'].includes(
                    wechatRefund.status,
                  )
                ? 'manual_review'
                : 'processing',
          wechatRefund,
        };
      } else {
        outcome = await queryPaymentRefund(
          selected.source,
          selected.orderId,
          session,
          selectedType,
        );
      }
      result.value = outcome;
      refundType.value = outcome.refundType;
      message.info(refundResultLabel(outcome));
      await refreshCapabilities(selected, outcome);
    } catch (caught) {
      error.value = handleHospitalError(
        caught,
        '退款状态查询失败，请稍后再查。',
      );
    } finally {
      busyOrders.delete(key);
      querying.value = false;
      onUpdated();
    }
    return true;
  }

  function prepareRemaining() {
    const type = nextRefundType.value;
    if (!type || locks.busy.value) return;
    refundType.value = type;
    reason.value = '';
    result.value = undefined;
    error.value = '';
  }

  return {
    ...locks,
    capabilitiesFresh,
    error,
    needsQuery,
    nextRefundType,
    open,
    prepareRemaining,
    preview,
    query,
    querying,
    reason,
    record,
    refundType,
    result,
    selectedOption,
    submit,
    submitting,
  };
}
