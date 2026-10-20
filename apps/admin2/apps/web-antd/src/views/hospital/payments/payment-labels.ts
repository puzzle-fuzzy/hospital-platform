import type { AdminPaymentSyncTask, PaymentStatus } from '#/hospital/types';

export const businessOptions = [
  { value: 'registration', label: '挂号' },
  { value: 'outpatient', label: '门诊缴费' },
  { value: 'other', label: '其他' },
];
export const sourceOptions = [
  { value: 'medical_insurance', label: '医保支付订单' },
  { value: 'payment_order', label: '普通微信支付' },
];
export const stateOptions = [
  { value: 'created', label: '已创建' },
  { value: 'pending', label: '处理中' },
  { value: 'paid', label: '已支付' },
  { value: 'failed', label: '失败' },
  { value: 'manual_review', label: '人工复核' },
];
const labels: Record<string, string> = {
  registration: '挂号',
  outpatient: '门诊缴费',
  other: '其他',
  created: '已创建',
  pending: '处理中',
  paid: '已支付',
  completed: '已完成',
  cash_paid: '微信已支付',
  failed: '失败',
  cancelled: '已取消',
  refund_pending: '退费处理中',
  refunded: '已退费',
  manual_review: '人工复核',
  requested: '已受理',
  processing: '处理中',
  success: '成功',
  succeeded: '已完成',
  closed: '已关闭',
  abnormal: '异常',
  unknown: '结果未确认',
  request_failed: '申请失败',
  not_required: '无需退款',
  not_started: '未开始',
  confirmed: '已确认',
  medical_insurance: '医保',
  wechat_cash: '微信现金',
  hospital_reduce: '医院减免',
  hospital_part: '医院负担（其他支付）',
  unallocated: '金额分项待核实',
  his: 'HIS',
  wechat_pay: '微信 APIv3',
  pull: '拉取',
  reconcile: '对账',
  writeback: '回写',
  in_progress: '执行中',
  prepay_ready: '待支付',
  awaiting_confirmation: '等待确认',
  awaiting_authorization: '等待医保授权',
  fee_upload_pending: '费用上传待完成',
  cash_prepay_ready: '待微信支付',
  cash_payment_pending: '微信支付待确认',
  settling: '结算中',
  settled: '医保已结算',
  fee_uploaded: '费用已上传',
  not_checked: '未核对',
  unavailable: '暂不可用',
  payment_order: '普通微信支付',
  platform: '平台',
};
export function label(value?: string | null): string {
  return value ? labels[value] || value : '—';
}
export function statusColor(value?: string): string {
  if (
    [
      'paid',
      'success',
      'succeeded',
      'completed',
      'cash_paid',
      'confirmed',
      'settled',
      'refunded',
    ].includes(value || '')
  )
    return 'success';
  if (['failed', 'abnormal', 'request_failed'].includes(value || ''))
    return 'error';
  if (
    ['manual_review', 'unknown', 'awaiting_confirmation'].includes(value || '')
  )
    return 'warning';
  return 'default';
}
export function flowLabel(value: PaymentStatus): string {
  return {
    CANCELLED: '已取消',
    MANUAL_REVIEW_REQUIRED: '需人工复核',
    PROVIDER_COMPLETED: '上游已完成',
    OBSERVED: '已观测',
    INCOMPLETE: '链路不完整',
  }[value];
}
export function flowColor(value: PaymentStatus): string {
  return {
    CANCELLED: 'default',
    MANUAL_REVIEW_REQUIRED: 'warning',
    PROVIDER_COMPLETED: 'success',
    OBSERVED: 'blue',
    INCOMPLETE: 'error',
  }[value];
}
export function taskCanRetry(task: AdminPaymentSyncTask): boolean {
  return task.status === 'failed' || task.status === 'manual_review';
}
export function taskCanReview(task: AdminPaymentSyncTask): boolean {
  return !['succeeded', 'manual_review', 'in_progress'].includes(task.status);
}
export function todayInShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
