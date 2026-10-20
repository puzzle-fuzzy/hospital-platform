<script lang="ts" setup>
import type { VbenFormSchema } from '@vben/common-ui';
import type { CaptchaState } from '#/hospital/types';
import { computed, markRaw, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { AuthenticationLogin, z } from '@vben/common-ui';
import { Alert, Button, Segmented } from 'ant-design-vue';
import { loadCaptcha } from '#/hospital/api';
import CaptchaField from '#/hospital/captcha-field.vue';
import { useAuthStore } from '#/store';

defineOptions({ name: 'Login' });
const authStore = useAuthStore();
const route = useRoute();
const initialMode =
  route.query.mode ?? new URLSearchParams(window.location.search).get('mode');
const loginMode = ref<'operator' | 'viewer'>(
  initialMode === 'viewer' ? 'viewer' : 'operator',
);
const captcha = ref<CaptchaState>({ enabled: true, key: '', image: '' });
const captchaLoading = ref(false);
const captchaError = ref('');
const loginForm = ref<InstanceType<typeof AuthenticationLogin>>();
let generation = 0;
const options = [
  { label: '运营账号', value: 'operator' },
  { label: '只读账号', value: 'viewer' },
];
async function refreshCaptcha() {
  if (loginMode.value !== 'operator') return;
  const request = ++generation;
  captchaLoading.value = true;
  captchaError.value = '';
  try {
    const result = await loadCaptcha();
    if (request === generation) {
      captcha.value = result;
      await loginForm.value?.getFormApi().setFieldValue('captcha', '');
    }
  } catch (error) {
    if (request === generation)
      captchaError.value =
        error instanceof Error ? error.message : '验证码加载失败';
  } finally {
    if (request === generation) captchaLoading.value = false;
  }
}
function changeMode(value: string | number) {
  loginMode.value = value === 'viewer' ? 'viewer' : 'operator';
  generation++;
  captchaLoading.value = false;
  captchaError.value = '';
  loginForm.value?.getFormApi().setFieldValue('password', '');
  loginForm.value?.getFormApi().setFieldValue('captcha', '');
  if (loginMode.value === 'operator') void refreshCaptcha();
}
const formSchema = computed((): VbenFormSchema[] => [
  {
    component: 'VbenInput',
    componentProps: { placeholder: '请输入账号', autocomplete: 'username' },
    fieldName: 'username',
    label: '账号',
    rules: z.string().trim().min(1, '请输入账号'),
  },
  {
    component: 'VbenInputPassword',
    componentProps: {
      placeholder: '请输入密码',
      autocomplete: 'current-password',
    },
    fieldName: 'password',
    label: '密码',
    rules: z.string().min(1, '请输入密码'),
  },
  ...(loginMode.value === 'operator' && captcha.value.enabled
    ? [
        {
          component: markRaw(CaptchaField),
          fieldName: 'captcha',
          label: '验证码',
          componentProps: {
            image: captcha.value.image,
            loading: captchaLoading.value,
            onRefresh: refreshCaptcha,
          },
          rules: z.string().trim().min(1, '请输入图片验证码'),
        },
      ]
    : []),
]);
async function submit(values: Record<string, unknown>) {
  if (
    authStore.loginLoading ||
    (loginMode.value === 'operator' &&
      (captchaLoading.value || captchaError.value))
  )
    return;
  const result = await authStore.authLogin({
    ...values,
    loginMode: loginMode.value,
    captchaKey: captcha.value.key,
    captchaEnabled: captcha.value.enabled,
  });
  if (!result.userInfo && loginMode.value === 'operator')
    await refreshCaptcha();
}
onMounted(() => {
  if (loginMode.value === 'operator') void refreshCaptcha();
});
onBeforeUnmount(() => {
  generation++;
});
</script>
<template>
  <AuthenticationLogin
    ref="loginForm"
    class="hospital-login"
    :form-schema="formSchema"
    :loading="authStore.loginLoading"
    :show-remember-me="true"
    :show-forget-password="false"
    :show-code-login="false"
    :show-qrcode-login="false"
    :show-register="false"
    :show-third-party-login="false"
    @submit="submit"
  >
    <template #title>
      <div class="hospital-login__heading">
        <h1 id="hospital-login-title">登录</h1>
        <Segmented
          size="small"
          :value="loginMode"
          :options="options"
          :disabled="authStore.loginLoading"
          @change="changeMode"
        />
      </div>
      <Alert
        v-if="captchaError"
        class="mb-5"
        :message="captchaError"
        type="error"
        show-icon
      >
        <template #action
          ><Button size="small" @click="refreshCaptcha"
            >重新加载</Button
          ></template
        >
      </Alert>
    </template>
    <template #third-party-login>
      <p class="hospital-login__note">
        {{
          loginMode === 'viewer'
            ? '只读账号可查看支付与日志，不能退费或取消挂号。'
            : '请使用已授权的运营管理账号登录。'
        }}
      </p>
    </template>
  </AuthenticationLogin>
</template>

<style scoped>
.hospital-login__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 28px;
}
.hospital-login__heading h1 {
  margin: 0;
  color: inherit;
  font-size: 28px;
  font-weight: 600;
  line-height: 40px;
}
.hospital-login__note {
  margin: 20px 0 0;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  line-height: 1.8;
}
.hospital-login :deep(input) {
  min-height: 40px;
  border-radius: 6px;
  font-size: 14px;
}
.hospital-login :deep(button[aria-label='login']) {
  height: 42px;
  border-radius: 6px;
  background: #0960bd;
  color: #fff;
  font-size: 16px;
  letter-spacing: 0.5em;
}
.hospital-login :deep(button[aria-label='login']:hover) {
  background: #1473d4;
}
@media (max-width: 420px) {
  .hospital-login__heading {
    gap: 8px;
  }
  .hospital-login__heading h1 {
    font-size: 24px;
  }
}
</style>
