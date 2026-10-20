<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';
import { Page } from '@vben/common-ui';
import {
  Alert,
  Button,
  Card,
  Collapse,
  CollapsePanel,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Empty,
  Input,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
} from 'ant-design-vue';
import {
  fetchPaymentDay,
  fetchPaymentInterface,
  isReadOnlySession,
} from '#/hospital/api';
import { formatAdminTime } from '#/hospital/admin-time';
import { getHospitalSession, handleHospitalError } from '#/hospital/session';
import type {
  PaymentDayResult,
  PaymentFlowSummary,
  PaymentInterfaceDetail,
  PaymentInterfaceSummary,
  RawLogEntry,
} from '#/hospital/types';
import { flowColor, flowLabel, todayInShanghai } from './payment-labels';

defineOptions({ name: 'HospitalPaymentDay' });

const date = ref(todayInShanghai());
const appliedDate = ref(date.value);
const day = ref<PaymentDayResult>();
const loading = ref(false);
const error = ref('');
const readOnly = ref(true);
const drawerOpen = ref(false);
const detail = ref<PaymentInterfaceDetail>();
const detailLoading = ref(false);
const detailError = ref('');
let generation = 0;
let detailGeneration = 0;
const completeCount = computed(
  () =>
    day.value?.orders.filter((item) => item.status === 'PROVIDER_COMPLETED')
      .length || 0,
);
const warningCount = computed(
  () =>
    day.value?.orders.filter((item) =>
      ['INCOMPLETE', 'MANUAL_REVIEW_REQUIRED'].includes(item.status),
    ).length || 0,
);
const columns = [
  { title: '序号', dataIndex: 'ordinal', width: 70 },
  { title: '实际接口', key: 'operation', width: 300 },
  { title: '调用时间', key: 'timestamp', width: 190 },
  { title: '日期归属', key: 'boundary', width: 120 },
  { title: '入参与返回', key: 'complete', width: 170 },
  { title: '操作', key: 'actions', width: 150 },
];
function boundary(value: PaymentInterfaceSummary['boundary']) {
  return {
    'before-day': '前一日边界',
    'within-day': '当天',
    'after-day': '次日边界',
  }[value];
}
function closeDetail() {
  detailGeneration++;
  drawerOpen.value = false;
  detail.value = undefined;
  detailLoading.value = false;
  detailError.value = '';
}
async function load() {
  const current = ++generation;
  closeDetail();
  error.value = '';
  loading.value = true;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date.value)) {
    error.value = '请选择有效的查询日期';
    loading.value = false;
    return;
  }
  try {
    const session = getHospitalSession();
    readOnly.value = isReadOnlySession(session);
    const result = await fetchPaymentDay(date.value, session);
    if (current !== generation) return;
    day.value = result;
    appliedDate.value = result.date;
  } catch (cause) {
    if (current === generation)
      error.value = handleHospitalError(cause, '当天支付链路加载失败');
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function openDetail(
  flow: PaymentFlowSummary,
  item: PaymentInterfaceSummary,
) {
  if (readOnly.value || loading.value) return;
  const current = ++detailGeneration;
  drawerOpen.value = true;
  detail.value = undefined;
  detailError.value = '';
  detailLoading.value = true;
  try {
    const result = await fetchPaymentInterface(
      appliedDate.value,
      flow.id,
      item.ordinal,
      getHospitalSession(),
    );
    if (current !== detailGeneration || !drawerOpen.value) return;
    if (
      result.flowId !== flow.id ||
      result.interface.ordinal !== item.ordinal ||
      result.orderId !== flow.orderId
    )
      throw new Error('返回的接口归属不一致，请重新查询');
    detail.value = result;
  } catch (cause) {
    if (current === detailGeneration && drawerOpen.value)
      detailError.value = handleHospitalError(cause, '接口详情加载失败');
  } finally {
    if (current === detailGeneration) detailLoading.value = false;
  }
}
function pretty(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? '未记录';
  } catch {
    return '无法展示';
  }
}
function parse(text?: string): unknown {
  if (text === undefined || text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
function packet(entry?: RawLogEntry): string {
  if (!entry) return '未记录此侧日志，无法确认完整内容。';
  const body = parse(entry.bodyText);
  if (!entry.method && !entry.url && !entry.headersText)
    return body === undefined ? '未记录正文' : pretty(body);
  return pretty({
    ...(entry.method ? { method: entry.method } : {}),
    ...(entry.url ? { url: entry.url } : {}),
    ...(entry.headersText ? { headers: parse(entry.headersText) } : {}),
    ...(body !== undefined ? { body } : { body: '未记录正文' }),
  });
}
const packets = computed(() =>
  detail.value
    ? [
        { title: '接口入参', entry: detail.value.request },
        { title: '接口返回', entry: detail.value.response },
      ]
    : [],
);
onMounted(() => void load());
onDeactivated(closeDetail);
onBeforeUnmount(() => {
  generation++;
  closeDetail();
  day.value = undefined;
});
</script>

<template>
  <Page
    title="当日支付链路"
    description="按北京时间还原当天日志中的支付流程；摘要反映已观测事实，未完整记录的接口会单独标记。"
    content-class="flex flex-col gap-4"
  >
    <Card
      ><form class="flex flex-wrap items-center gap-3" @submit.prevent="load">
        <label for="payment-day">查询日期</label
        ><Input
          id="payment-day"
          v-model:value="date"
          type="date"
          style="width: 180px"
        /><Button type="primary" html-type="submit" :loading="loading"
          >查询</Button
        ><Button :loading="loading" @click="load">刷新</Button>
      </form></Card
    >
    <Alert
      v-if="readOnly"
      type="info"
      show-icon
      message="只读账号可查看链路摘要；接口入参和原始返回仅向运营账号开放。"
    />
    <Alert v-if="error" :message="error" type="error" show-icon />
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card
        ><Statistic
          :title="`${appliedDate} 已识别支付流程`"
          :value="day?.orders.length || 0"
          suffix="笔" /></Card
      ><Card
        ><Statistic
          title="上游已完成"
          :value="completeCount"
          suffix="笔" /></Card
      ><Card
        ><Statistic
          title="需核对的链路"
          :value="warningCount"
          suffix="笔" /></Card
      ><Card
        ><Statistic title="解析日志条数" :value="day?.parsedRecords || 0"
      /></Card>
    </div>
    <Spin :spinning="loading">
      <Card :title="`${appliedDate} 支付流程`">
        <div class="flex flex-col gap-4">
          <div v-if="day" class="text-sm leading-6 text-muted-foreground">
            北京时间 {{ formatAdminTime(day.window.start) }} 至
            {{
              formatAdminTime(day.window.endExclusive)
            }}（不含结束时刻），额外读取前后
            {{ day.window.boundaryBufferMinutes }} 分钟边界日志。未归属支付事件
            {{ day.unmatchedPaymentEventCount }} 条。
          </div>
          <Collapse v-if="day?.orders.length" accordion>
            <CollapsePanel v-for="flow in day.orders" :key="flow.id"
              ><template #header
                ><Space wrap
                  ><Tag :color="flowColor(flow.status)">{{
                    flowLabel(flow.status)
                  }}</Tag
                  ><span class="font-medium">订单 {{ flow.orderId }}</span
                  ><span class="text-sm text-muted-foreground"
                    >{{ formatAdminTime(flow.startedAt) }} ·
                    {{ flow.completeInterfaceCount }}/{{
                      flow.interfaceCount
                    }}
                    个完整接口</span
                  ><Tag v-if="flow.hasBoundaryCrossing" color="orange"
                    >跨日边界</Tag
                  ></Space
                ></template
              >
              <div class="flex flex-col gap-4">
                <Descriptions size="small" :column="2"
                  ><DescriptionsItem label="流程编号">{{
                    flow.id
                  }}</DescriptionsItem
                  ><DescriptionsItem label="关联挂号">{{
                    flow.appointmentId || '—'
                  }}</DescriptionsItem></Descriptions
                >
                <Alert
                  v-if="flow.attributionWarningCount > 0"
                  type="warning"
                  show-icon
                  :message="`有 ${flow.attributionWarningCount} 个日志块无法唯一归属，已排除。`"
                />
                <Table
                  :data-source="flow.interfaces"
                  :columns="columns"
                  row-key="id"
                  size="small"
                  :pagination="false"
                  :scroll="{ x: 1000 }"
                  ><template #bodyCell="{ column, record }"
                    ><template v-if="column.key === 'operation'"
                      >{{ record.displayOperation
                      }}<span
                        v-if="record.invocationIndex > 0"
                        class="text-muted-foreground"
                      >
                        · 第 {{ record.invocationIndex + 1 }} 次调用</span
                      ></template
                    ><template v-else-if="column.key === 'timestamp'">{{
                      formatAdminTime(record.timestamp)
                    }}</template
                    ><template v-else-if="column.key === 'boundary'"
                      ><Tag
                        :color="
                          record.boundary === 'within-day'
                            ? 'default'
                            : 'orange'
                        "
                        >{{
                          boundary((record as PaymentInterfaceSummary).boundary)
                        }}</Tag
                      ></template
                    ><template v-else-if="column.key === 'complete'"
                      ><Tag :color="record.complete ? 'success' : 'warning'">{{
                        record.complete ? '均已校验' : '缺失或校验未通过'
                      }}</Tag></template
                    ><template v-else-if="column.key === 'actions'"
                      ><Button
                        v-if="!readOnly"
                        type="link"
                        size="small"
                        @click="
                          openDetail(flow, record as PaymentInterfaceSummary)
                        "
                        >查看接口详情</Button
                      ><span v-else class="text-muted-foreground"
                        >—</span
                      ></template
                    ></template
                  ></Table
                >
              </div>
            </CollapsePanel>
          </Collapse>
          <Empty v-else description="当天没有识别到支付流程" />
        </div>
      </Card>
    </Spin>
    <Drawer
      :open="drawerOpen"
      title="支付接口详情"
      width="min(1080px, 100vw)"
      :destroy-on-close="true"
      @close="closeDetail"
    >
      <div class="flex flex-col gap-4">
        <Alert
          v-if="detailError"
          :message="detailError"
          type="error"
          show-icon
        />
        <Spin :spinning="detailLoading"
          ><div v-if="detail" class="flex flex-col gap-4">
            <Descriptions bordered size="small" :column="2"
              ><DescriptionsItem label="订单号" :span="2">{{
                detail.orderId
              }}</DescriptionsItem
              ><DescriptionsItem label="调用接口">{{
                detail.interface.displayOperation
              }}</DescriptionsItem
              ><DescriptionsItem label="调用时间">{{
                formatAdminTime(detail.interface.timestamp)
              }}</DescriptionsItem
              ><DescriptionsItem label="日期归属">{{
                boundary(detail.interface.boundary)
              }}</DescriptionsItem
              ><DescriptionsItem label="归属依据">{{
                detail.interface.attribution === 'correlation'
                  ? '关联号匹配'
                  : '时间线唯一匹配'
              }}</DescriptionsItem
              ><DescriptionsItem label="Trace / 上游请求号" :span="2">{{
                detail.interface.traceId ||
                detail.interface.providerRequestId ||
                '—'
              }}</DescriptionsItem
              ><DescriptionsItem label="完整性" :span="2">{{
                detail.interface.complete
                  ? '入参和返回均已校验'
                  : '缺少一侧或校验未通过，请勿据此认定支付结果'
              }}</DescriptionsItem></Descriptions
            >
            <Card
              v-for="part in packets"
              :key="part.title"
              :title="part.title"
              size="small"
              ><div class="flex flex-col gap-3">
                <template v-if="part.entry"
                  ><div class="flex flex-wrap items-center gap-2">
                    <Tag :color="part.entry.complete ? 'success' : 'warning'">{{
                      part.entry.complete
                        ? '日志已校验'
                        : '日志不完整 / 校验未通过'
                    }}</Tag
                    ><span>{{ formatAdminTime(part.entry.timestamp) }}</span
                    ><span>{{ part.entry.chunkCount }} 个日志块</span
                    ><span v-if="part.entry.statusCode"
                      >HTTP {{ part.entry.statusCode }}</span
                    >
                  </div>
                  <Alert
                    v-if="part.entry.error"
                    :message="part.entry.error"
                    type="warning"
                  />
                  <div
                    v-if="part.entry.missingChunkIndexes?.length"
                    class="text-sm"
                  >
                    缺失块：{{ part.entry.missingChunkIndexes.join(', ') }}
                  </div>
                  <Descriptions
                    v-if="part.entry.integrity"
                    size="small"
                    :column="1"
                    ><DescriptionsItem label="字节数（预期 / 实际）"
                      >{{ part.entry.integrity.expectedByteLength ?? '—' }} /
                      {{
                        part.entry.integrity.actualByteLength ?? '—'
                      }}</DescriptionsItem
                    ><DescriptionsItem label="预期 SHA-256">{{
                      part.entry.integrity.expectedSha256 || '—'
                    }}</DescriptionsItem
                    ><DescriptionsItem label="实际 SHA-256">{{
                      part.entry.integrity.actualSha256 || '—'
                    }}</DescriptionsItem></Descriptions
                  ></template
                ><Alert
                  v-else
                  message="未记录此侧日志，无法确认完整内容。"
                  type="warning"
                  show-icon
                />
                <pre
                  class="max-h-[560px] overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-4 text-xs leading-6"
                  >{{ packet(part.entry) }}</pre
                >
              </div>
            </Card>
          </div></Spin
        >
      </div>
    </Drawer>
  </Page>
</template>
