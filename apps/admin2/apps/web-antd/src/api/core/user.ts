import type { UserInfo } from '@vben/types';
import { ApiError, isReadOnlySession, loadSession } from '#/hospital/api';

export async function getUserInfoApi(): Promise<UserInfo> {
  const session = loadSession();
  if (!session) throw new ApiError('请先登录', 401);
  const readOnly = isReadOnlySession(session);
  return {
    username: session.username,
    realName: session.username,
    userId: session.username,
    roles: [readOnly ? 'hospital-viewer' : 'hospital-operator'],
    avatar: '/hospital-logo.svg',
    desc: readOnly ? '只读查看' : '运营管理',
    homePath: '/hospital/payments/simple',
    token: session.accessToken,
  };
}
