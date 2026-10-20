import type {
  AdminPaymentRefundResult,
  AdminWechatRefundPaymentRecord,
} from '#/hospital/types';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchHistory: vi.fn(),
  queryMedical: vi.fn(),
  queryPayment: vi.fn(),
  queryWechat: vi.fn(),
  readOnly: false,
  request: vi.fn(),
}));

vi.mock('ant-design-vue', () => ({
  message: { error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('#/hospital/api', () => ({
  fetchWechatRefundPaymentHistory: mocks.fetchHistory,
  isReadOnlySession: (session: { capabilities: { readOnly: boolean } }) =>
    session.capabilities.readOnly,
  queryMedicalInsuranceRefund: mocks.queryMedical,
  queryPaymentRefund: mocks.queryPayment,
  queryWechatRefund: mocks.queryWechat,
  requestPaymentRefund: mocks.request,
}));
vi.mock('#/hospital/session', () => ({
  getHospitalSession: () => ({
    accessToken: 'synthetic-test-token',
    capabilities: { readOnly: mocks.readOnly },
    username: 'synthetic-operator',
  }),
  handleHospitalError: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

import {
  defaultRefundQueryType,
  refundResultLabel,
  usePaymentRefund,
  usePaymentRefundLocks,
} from './use-payment-refund';

function order(
  overrides: Partial<AdminWechatRefundPaymentRecord> = {},
): AdminWechatRefundPaymentRecord {
  return {
    actualCashFen: 600,
    actualPaidFen: 1000,
    amountBreakdownStatus: 'confirmed',
    business: 'outpatient',
    cashFen: 600,
    cashPaymentConfirmed: true,
    createdAt: '2026-10-20T02:25:00.000Z',
    hospitalDiscountFen: 100,
    insuranceFen: 400,
    medicalRefundableFen: 400,
    medicalStatus: 'insurance_settled',
    orderId: 'synthetic-order',
    paymentState: 'completed',
    refundCount: 0,
    refundableFen: 600,
    refundOptions: {
      ALL: { amountFen: 1000, enabled: true },
      CASH: { amountFen: 600, enabled: true },
      HI: { amountFen: 400, enabled: true },
    },
    refundReservedFen: 0,
    refundRoute: 'admin',
    source: 'medical_insurance',
    totalFen: 1100,
    updatedAt: '2026-10-20T02:25:00.000Z',
    ...overrides,
  };
}

function outcome(
  overrides: Partial<AdminPaymentRefundResult> = {},
): AdminPaymentRefundResult {
  return {
    amounts: {
      cashFen: 600,
      fundFen: 400,
      personalAccountFen: 0,
      totalFen: 1000,
    },
    orderId: 'synthetic-order',
    refundType: 'ALL',
    source: 'medical_insurance',
    status: 'succeeded',
    ...overrides,
  };
}

function history(record: AdminWechatRefundPaymentRecord) {
  return { items: [record], page: 1, pageSize: 1, total: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readOnly = false;
  usePaymentRefundLocks().queryRequiredOrders.clear();
  mocks.request.mockResolvedValue(outcome());
  mocks.queryPayment.mockResolvedValue(outcome());
  mocks.fetchHistory.mockResolvedValue(history(order()));
});

describe('payment refund control boundaries', () => {
  it('constructing the composable has no request and a viewer cannot open, query or submit', async () => {
    mocks.readOnly = true;
    const refund = usePaymentRefund(vi.fn());
    expect(mocks.fetchHistory).not.toHaveBeenCalled();
    expect(refund.open(order())).toBe(false);
    expect(await refund.query(order())).toBe(false);
    await refund.submit();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.queryPayment).not.toHaveBeenCalled();
    expect(mocks.queryMedical).not.toHaveBeenCalled();
    expect(mocks.queryWechat).not.toHaveBeenCalled();
  });

  it('submits the selected scope once while double clicks and other instances are busy', async () => {
    let complete!: (value: AdminPaymentRefundResult) => void;
    mocks.request.mockImplementationOnce(
      () =>
        new Promise<AdminPaymentRefundResult>((resolve) => {
          complete = resolve;
        }),
    );
    const updated = vi.fn();
    const refund = usePaymentRefund(updated);
    refund.open(order(), 'HI');
    refund.reason.value = '  患者申请  ';
    const work = refund.submit();
    await refund.submit();
    expect(usePaymentRefund(vi.fn()).open(order())).toBe(false);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0]?.[0]).toEqual({
      orderId: 'synthetic-order',
      reason: '患者申请',
      refundType: 'HI',
      source: 'medical_insurance',
    });
    expect(refund.needsQuery.value).toBe(true);
    complete(outcome({ refundType: 'HI' }));
    await work;
    expect(refund.busy.value).toBe(false);
    expect(updated).toHaveBeenCalledTimes(1);
  });

  it('keeps the unknown-response lock when the modal is closed and reopened in another route', async () => {
    mocks.request.mockRejectedValueOnce(new Error('response lost'));
    const first = usePaymentRefund(vi.fn());
    first.open(order(), 'HI');
    await first.submit();
    const second = usePaymentRefund(vi.fn());
    expect(second.open(order())).toBe(true);
    expect(second.needsQuery.value).toBe(true);
    await second.submit();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(second.nextRefundType.value).toBeUndefined();
    await second.query(order(), 'CASH');
    expect(mocks.queryPayment).toHaveBeenCalledTimes(1);
    expect(mocks.queryPayment.mock.calls[0]?.[3]).toBe('HI');
    expect(mocks.fetchHistory.mock.calls[0]?.[0]).toEqual({
      orderId: 'synthetic-order',
      page: 1,
      pageSize: 1,
      source: 'medical_insurance',
    });
    expect(second.needsQuery.value).toBe(false);
  });

  it('does not unlock a known result until its own current order capabilities are refreshed', async () => {
    mocks.fetchHistory.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 1,
      total: 0,
    });
    const refund = usePaymentRefund(vi.fn());
    refund.open(order());
    await refund.submit();
    expect(refund.result.value?.status).toBe('succeeded');
    expect(refund.capabilitiesFresh.value).toBe(false);
    expect(refund.needsQuery.value).toBe(true);
    expect(refund.nextRefundType.value).toBeUndefined();
    await refund.submit();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('keeps a processing or unknown channel locked even if stale options say refund is enabled', async () => {
    mocks.request.mockResolvedValueOnce(outcome({ status: 'processing' }));
    const refund = usePaymentRefund(vi.fn());
    refund.open(order());
    await refund.submit();
    expect(refund.needsQuery.value).toBe(true);
    mocks.fetchHistory.mockResolvedValueOnce(
      history(
        order({
          latestRefund: {
            merchantRefundNo: 'synthetic-refund',
            status: 'unknown',
            refundFen: 600,
            updatedAt: '2026-10-20T02:25:00Z',
          },
        }),
      ),
    );
    await refund.query(order(), 'ALL');
    expect(refund.result.value?.status).toBe('succeeded');
    expect(refund.needsQuery.value).toBe(true);
    expect(refund.nextRefundType.value).toBeUndefined();
  });

  it('only offers remaining funds from refreshed backend capabilities after a partial refund', async () => {
    mocks.request.mockResolvedValueOnce(outcome({ refundType: 'HI' }));
    mocks.fetchHistory.mockResolvedValueOnce(
      history(
        order({
          refundOptions: {
            ALL: { amountFen: 0, enabled: false },
            HI: { amountFen: 0, enabled: false },
            CASH: { amountFen: 600, enabled: true },
          },
        }),
      ),
    );
    const refund = usePaymentRefund(vi.fn());
    refund.open(order(), 'HI');
    await refund.submit();
    expect(refund.nextRefundType.value).toBe('CASH');
    refund.prepareRemaining();
    expect(refund.refundType.value).toBe('CASH');
    expect(refund.result.value).toBeUndefined();
    expect(refund.preview.value).toEqual({
      cashFen: 600,
      medicalFen: 0,
      totalFen: 600,
    });
    await refund.submit();
    expect(mocks.request.mock.calls[1]?.[0].refundType).toBe('CASH');
  });

  it('uses legacy receipt status routes without ever submitting a new refund', async () => {
    const medicalRefund = {
      amounts: outcome().amounts,
      medicalStatus: 'success',
      orderId: 'synthetic-order',
      refundNo: 'synthetic-medical',
      status: 'succeeded',
      wechatStatus: 'not_required',
    };
    mocks.queryMedical.mockResolvedValue(medicalRefund);
    const medical = order({
      refundOptions: undefined,
      latestMedicalRefund: {
        refundNo: 'synthetic-medical',
        status: 'succeeded',
        medicalStatus: 'success',
        wechatStatus: 'not_required',
        totalFen: 400,
        updatedAt: '2026-10-20T02:25:00Z',
      },
    });
    const refund = usePaymentRefund(vi.fn());
    expect(defaultRefundQueryType(medical)).toBe('HI');
    await refund.query(medical);
    expect(mocks.queryMedical).toHaveBeenCalledWith(
      'synthetic-medical',
      expect.anything(),
    );
    const cash = order({
      refundOptions: undefined,
      latestRefund: {
        merchantRefundNo: 'synthetic-wechat',
        status: 'processing',
        refundFen: 600,
        updatedAt: '2026-10-20T02:25:00Z',
      },
    });
    mocks.queryWechat.mockResolvedValue({
      merchantRefundNo: 'synthetic-wechat',
      refundFen: 600,
      status: 'success',
    });
    await refund.query(cash);
    expect(refund.result.value?.refundType).toBe('CASH');
    expect(mocks.queryWechat).toHaveBeenCalledWith(
      'synthetic-wechat',
      expect.anything(),
    );
    expect(mocks.queryPayment).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('retains the distinct registration refund and hospital cancellation progress', () => {
    const result = outcome({
      source: 'payment_order',
      status: 'manual_review',
      registrationRefundStage: 'hospital_writeback_pending',
      hospitalWritebackPending: true,
    });
    expect(refundResultLabel(result)).toBe('微信已退款，医院退费回写待核对');
  });
});
