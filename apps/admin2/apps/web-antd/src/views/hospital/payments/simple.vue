<script lang="ts" setup>
import type { AdminWechatRefundPaymentRecord } from '#/hospital/types';

import { computed, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Pagination,
  Space,
  Spin,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import {
  fetchWechatRefundPaymentHistory,
  isReadOnlySession,
} from '#/hospital/api';
import { paymentRefundKey } from '#/hospital/payment-refund-options';
import { getHospitalSession, handleHospitalError } from '#/hospital/session';
import {
  simplePaymentRefundAction,
  simplePaymentRefundStatus,
  simplePaymentSentence,
} from '#/hospital/simple-payment-display';

import PaymentRefundModal from './components/payment-refund-modal.vue';
import { usePaymentRefundLocks } from './composables/use-payment-refund';

defineOptions({ name: 'HospitalPaymentSimple' });

const items = ref<readonly AdminWechatRefundPaymentRecord[]>([]);
const loading = ref(false);
const error = ref('');
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const businessDay = ref('');
const refundModal = ref<InstanceType<typeof PaymentRefundModal>>();
const readOnly = computed(() => isReadOnlySession(getHospitalSession()));
const { busy, queryingKey, queryRequiredOrders } = usePaymentRefundLocks();
let requestGeneration = 0;

async function load(targetPage = page.value) {
  const generation = ++requestGeneration;
  loading.value = true;
  error.value = '';
  try {
    const result = await fetchWechatRefundPaymentHistory(
      {
        page: targetPage,
        pageSize,
        ...(businessDay.value ? { businessDay: businessDay.value } : {}),
      },
      getHospitalSession(),
    );
    if (generation !== requestGeneration) return;
    items.value = result.items;
    page.value = result.page;
    total.value = result.total;
  } catch (caught) {
    if (generation === requestGeneration)
      error.value = handleHospitalError(
        caught,
        '支付记录加载失败，请刷新重试。',
      );
  } finally {
    if (generation === requestGeneration) loading.value = false;
  }
}

function action(record: AdminWechatRefundPaymentRecord) {
  return simplePaymentRefundAction(record, {
    busy: busy.value,
    queryRequired: queryRequiredOrders.has(paymentRefundKey(record)),
    readOnly: readOnly.value,
  });
}

function changeDay(event: Event) {
  businessDay.value = (event.target as HTMLInputElement).value;
  void load(1);
}

function clearDay() {
  businessDay.value = '';
  void load(1);
}

onMounted(() => void load(1));
</script>

<template>
  <Page
    title="支付展示"
    description="按笔查看挂号和门诊缴费，以及医保、微信实付金额。"
  >
    <Card :bordered="false" class="mb-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Space wrap>
          <label for="simple-payment-day" class="font-medium">下单日期</label>
          <Input
            id="simple-payment-day"
            type="date"
            class="w-44"
            :value="businessDay"
            :disabled="loading"
            @change="changeDay"
          />
          <Button :disabled="loading || !businessDay" @click="clearDay">
            全部日期
          </Button>
        </Space>
        <Button :loading="loading" @click="load()">刷新记录</Button>
      </div>
      <p class="text-muted-foreground mb-0 mt-3 text-sm">
        时间为下单时间（北京时间），金额为原支付实付。退费状态单独展示。
      </p>
    </Card>

    <Alert
      v-if="readOnly"
      class="mb-4"
      type="info"
      show-icon
      message="当前账号仅可查看，退费需使用操作员账号。"
    />
    <Alert v-if="error" class="mb-4" type="error" show-icon :message="error" />

    <Card :bordered="false" :body-style="{ padding: '0' }">
      <Spin :spinning="loading">
        <ul v-if="items.length" aria-label="支付记录" class="m-0 list-none p-0">
          <li
            v-for="record in items"
            :key="paymentRefundKey(record)"
            class="flex flex-col justify-between gap-4 border-b border-border px-6 py-5 last:border-b-0 md:flex-row md:items-center"
          >
            <div class="min-w-0 flex-1">
              <p class="mb-2 text-[15px] leading-7">
                {{ simplePaymentSentence(record) }}
              </p>
              <Space :size="8" wrap>
                <span class="text-muted-foreground text-xs">
                  {{ record.business === 'registration' ? '挂号' : '缴费' }} ·
                  {{ record.orderId }}
                </span>
                <Tag
                  v-if="
                    simplePaymentRefundStatus(
                      record,
                      queryRequiredOrders.has(paymentRefundKey(record)),
                    )
                  "
                  :color="
                    simplePaymentRefundStatus(
                      record,
                      queryRequiredOrders.has(paymentRefundKey(record)),
                    ) === '退款已完成'
                      ? 'success'
                      : 'warning'
                  "
                >
                  {{
                    simplePaymentRefundStatus(
                      record,
                      queryRequiredOrders.has(paymentRefundKey(record)),
                    )
                  }}
                </Tag>
              </Space>
            </div>
            <Space class="shrink-0">
              <Tooltip :title="action(record).reason">
                <span>
                  <Button
                    danger
                    :disabled="
                      loading || Boolean(error) || action(record).disabled
                    "
                    @click="refundModal?.open(record, 'ALL')"
                  >
                    退费
                  </Button>
                </span>
              </Tooltip>
              <Button
                v-if="action(record).showQuery"
                type="link"
                :disabled="readOnly || loading || busy"
                :loading="queryingKey === paymentRefundKey(record)"
                @click="refundModal?.query(record)"
              >
                查询退款
              </Button>
            </Space>
          </li>
        </ul>
        <Empty
          v-else
          class="py-16"
          :description="error ? '支付记录加载失败，请刷新重试' : '暂无支付记录'"
        />
      </Spin>
      <div
        v-if="total > 0"
        class="flex justify-end border-t border-border px-6 py-4"
      >
        <Pagination
          :current="page"
          :page-size="pageSize"
          :total="total"
          :show-size-changer="false"
          :show-total="(count: number) => `共 ${count} 笔`"
          :disabled="loading"
          @change="(nextPage: number) => load(nextPage)"
        />
      </div>
    </Card>
    <PaymentRefundModal ref="refundModal" @updated="load()" />
  </Page>
</template>
