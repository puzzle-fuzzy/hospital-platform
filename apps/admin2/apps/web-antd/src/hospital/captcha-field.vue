<script setup lang="ts">
import { Input } from 'ant-design-vue';
defineProps<{
  modelValue?: string;
  image: string;
  loading: boolean;
  onRefresh: () => void;
}>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();
</script>
<template>
  <div class="flex w-full items-center gap-3">
    <Input
      :value="modelValue"
      placeholder="图片验证码"
      autocomplete="off"
      aria-label="图片验证码"
      @update:value="emit('update:modelValue', $event)"
    />
    <button
      type="button"
      class="h-10 w-32 shrink-0 overflow-hidden rounded border"
      :disabled="loading"
      aria-label="刷新验证码"
      @click="onRefresh"
    >
      <img
        v-if="image && !loading"
        :src="image"
        class="h-full w-full object-contain"
        alt="验证码，点击刷新"
      />
      <span v-else>{{ loading ? '加载中' : '刷新验证码' }}</span>
    </button>
  </div>
</template>
