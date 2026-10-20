<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Page } from '@vben/common-ui';
import {
  Alert,
  Button,
  Card,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'ant-design-vue';
import {
  fetchPaymentSyncTasks,
  isReadOnlySession,
  markPaymentSyncTaskManualReview,
  retryPaymentSyncTask,
} from '#/hospital/api';
import type { AdminPaymentSyncTaskQuery } from '#/hospital/api';
import { formatAdminTime } from '#/hospital/admin-time';
import { getHospitalSession, handleHospitalError } from '#/hospital/session';
import type { AdminPaymentSyncTask } from '#/hospital/types';
import {
  label,
  statusColor,
  taskCanRetry,
  taskCanReview,
} from './payment-labels';

defineOptions({ name: 'HospitalPaymentSync' });

const route = useRoute();
const router = useRouter();
const filters = reactive<AdminPaymentSyncTaskQuery>({
  limit: 100,
  aggregateId: '',
});
const tasks = ref<AdminPaymentSyncTask[]>([]);
const loading = ref(false);
const busy = ref(false);
const readOnly = ref(true);
const error = ref('');
const actionError = ref('');
const selected = ref<AdminPaymentSyncTask>();
const action = ref<'retry' | 'review'>('retry');
const reason = ref('');
let generation = 0;
const columns = [
  { title: '更新时间', key: 'updatedAt', width: 190 },
  { title: '来源 / 类型', key: 'source', width: 160 },
  { title: '业务关联号', dataIndex: 'businessKey', width: 250 },
  { title: '任务编号', dataIndex: 'taskId', width: 250 },
  { title: '状态', key: 'status', width: 130 },
  { title: '尝试次数', key: 'attempts', width: 100 },
  { title: '下次执行 / 领取期限', key: 'nextRunAt', width: 200 },
  { title: '最近错误', dataIndex: 'lastErrorCode', width: 200 },
  { title: '操作', key: 'actions', fixed: 'right' as const, width: 260 },
];
async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = '';
  try {
    const session = getHospitalSession();
    readOnly.value = isReadOnlySession(session);
    const result = await fetchPaymentSyncTasks({ ...filters }, session);
    if (current === generation) tasks.value = [...result];
  } catch (cause) {
    if (current === generation)
      error.value = handleHospitalError(cause, '同步任务加载失败');
  } finally {
    if (current === generation) loading.value = false;
  }
}
function openAction(task: AdminPaymentSyncTask, type: 'retry' | 'review') {
  if (
    readOnly.value ||
    busy.value ||
    (type === 'retry' ? !taskCanRetry(task) : !taskCanReview(task))
  )
    return;
  selected.value = task;
  action.value = type;
  reason.value = '';
  actionError.value = '';
}
function closeAction() {
  if (!busy.value) {
    selected.value = undefined;
    reason.value = '';
    actionError.value = '';
  }
}
async function submit() {
  const task = selected.value;
  if (
    !task ||
    readOnly.value ||
    busy.value ||
    (action.value === 'review' && !reason.value.trim()) ||
    (action.value === 'retry' ? !taskCanRetry(task) : !taskCanReview(task))
  )
    return;
  busy.value = true;
  actionError.value = '';
  try {
    const session = getHospitalSession();
    if (action.value === 'retry')
      await retryPaymentSyncTask(task.taskId, session);
    else
      await markPaymentSyncTaskManualReview(
        task.taskId,
        reason.value.trim(),
        session,
      );
    message.success(
      action.value === 'retry' ? '同步任务已重新排队' : '同步任务已转人工复核',
    );
    selected.value = undefined;
    reason.value = '';
    await load();
  } catch (cause) {
    actionError.value = handleHospitalError(
      cause,
      '任务处理失败。请刷新核对任务状态后再操作。',
    );
  } finally {
    busy.value = false;
  }
}
watch(
  () => route.query.aggregateId,
  (value) => {
    filters.aggregateId = typeof value === 'string' ? value : '';
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation++;
});
</script>

<template>
  <Page
    title="支付同步任务"
    description="查看医院、医保和微信的拉取、对账与回写任务，按需要转人工复核。"
  >
    <Alert
      v-if="readOnly"
      message="当前账号仅可查看同步任务。"
      type="info"
      show-icon
      class="mb-4"
    />
    <Card title="同步任务">
      <form class="mb-4 flex flex-wrap gap-3" @submit.prevent="load">
        <Input
          v-model:value="filters.aggregateId"
          placeholder="支付账本编号"
          aria-label="支付账本编号"
          style="width: 330px"
          allow-clear
        />
        <Select
          v-model:value="filters.status"
          allow-clear
          placeholder="全部状态"
          :options="
            [
              'pending',
              'in_progress',
              'succeeded',
              'failed',
              'manual_review',
            ].map((value) => ({ value, label: label(value) }))
          "
          aria-label="任务状态"
          style="width: 140px"
        />
        <Select
          v-model:value="filters.source"
          allow-clear
          placeholder="全部来源"
          :options="
            ['his', 'medical_insurance', 'wechat_pay'].map((value) => ({
              value,
              label: label(value),
            }))
          "
          aria-label="任务来源"
          style="width: 140px"
        />
        <Select
          v-model:value="filters.kind"
          allow-clear
          placeholder="全部类型"
          :options="
            ['pull', 'reconcile', 'writeback'].map((value) => ({
              value,
              label: label(value),
            }))
          "
          aria-label="任务类型"
          style="width: 130px"
        />
        <Button type="primary" html-type="submit" :loading="loading"
          >查询</Button
        ><Button :loading="loading" @click="load">刷新</Button>
      </form>
      <Alert
        v-if="error"
        :message="error"
        type="error"
        show-icon
        class="mb-4"
      />
      <div class="mb-3 text-sm text-muted-foreground">
        最多展示最近 100
        条匹配任务。重新排队会重新执行对应同步工作，提交前请确认业务状态。
      </div>
      <Table
        :columns="columns"
        :data-source="tasks"
        row-key="taskId"
        :loading="loading"
        :scroll="{ x: 1840 }"
        :pagination="{ pageSize: 10, showSizeChanger: false }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'updatedAt'">{{
            formatAdminTime(record.updatedAt)
          }}</template>
          <template v-else-if="column.key === 'source'"
            ><div>{{ label(record.source) }}</div>
            <div class="text-sm text-muted-foreground">
              {{ label(record.kind) }}
            </div></template
          >
          <template v-else-if="column.key === 'status'"
            ><Tag :color="statusColor(record.status)">{{
              label(record.status)
            }}</Tag></template
          >
          <template v-else-if="column.key === 'attempts'"
            >{{ record.attempts }} / {{ record.maxAttempts }}</template
          >
          <template v-else-if="column.key === 'nextRunAt'"
            ><div>{{ formatAdminTime(record.nextRunAt) }}</div>
            <div class="text-sm text-muted-foreground">
              领取至
              {{
                record.claimedUntil ? formatAdminTime(record.claimedUntil) : '—'
              }}
            </div></template
          >
          <template v-else-if="column.key === 'actions'"
            ><Space wrap
              ><Button
                size="small"
                @click="
                  router.push({
                    path: '/hospital/payments/ledger',
                    query: { aggregateId: record.aggregateId },
                  })
                "
                >账本</Button
              ><template v-if="!readOnly"
                ><Button
                  size="small"
                  :disabled="
                    busy || !taskCanRetry(record as AdminPaymentSyncTask)
                  "
                  @click="openAction(record as AdminPaymentSyncTask, 'retry')"
                  >重新排队</Button
                ><Button
                  size="small"
                  :disabled="
                    busy || !taskCanReview(record as AdminPaymentSyncTask)
                  "
                  @click="openAction(record as AdminPaymentSyncTask, 'review')"
                  >转人工</Button
                ></template
              ></Space
            ></template
          >
        </template>
      </Table>
    </Card>
    <Modal
      :open="!!selected"
      :title="action === 'retry' ? '确认重新排队' : '转人工复核'"
      :confirm-loading="busy"
      :closable="!busy"
      :mask-closable="false"
      :keyboard="!busy"
      :cancel-button-props="{ disabled: busy }"
      :ok-button-props="{ disabled: action === 'review' && !reason.trim() }"
      @cancel="closeAction"
      @ok="submit"
    >
      <Alert
        v-if="actionError"
        :message="actionError"
        type="error"
        show-icon
        class="mb-4"
      />
      <p>任务：{{ selected?.taskId }}</p>
      <p class="mt-2">
        {{
          action === 'retry'
            ? '此操作将重新执行该同步任务，请确认医院及支付平台的实际状态。'
            : '请填写需要人工处理的原因。'
        }}
      </p>
      <Input.TextArea
        v-if="action === 'review'"
        v-model:value="reason"
        :disabled="busy"
        :maxlength="200"
        :rows="3"
        class="mt-3"
        placeholder="人工复核原因"
      />
    </Modal>
  </Page>
</template>
