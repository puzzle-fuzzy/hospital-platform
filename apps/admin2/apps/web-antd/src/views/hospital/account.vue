<script setup lang="ts">
import { Page } from '@vben/common-ui';
import { Card, Descriptions, DescriptionsItem, Tag } from 'ant-design-vue';
import { isReadOnlySession } from '#/hospital/api';
import { getHospitalSession } from '#/hospital/session';
defineOptions({ name: 'HospitalAccount' });

const session = getHospitalSession();
const readOnly = isReadOnlySession(session);
</script>
<template>
  <Page title="账号信息" description="当前管理会话与权限">
    <Card>
      <Descriptions :column="1" bordered>
        <DescriptionsItem label="账号">{{ session.username }}</DescriptionsItem>
        <DescriptionsItem label="权限"
          ><Tag :color="readOnly ? 'blue' : 'green'">{{
            readOnly ? '只读查看' : '运营管理'
          }}</Tag></DescriptionsItem
        >
        <DescriptionsItem label="管理端"
          >Admin 2.0 · Vue 3 / Vben 5.7.0</DescriptionsItem
        >
        <DescriptionsItem label="会话"
          >会话失效后需要重新登录，实际操作权限由服务器核验。</DescriptionsItem
        >
      </Descriptions>
    </Card>
  </Page>
</template>
