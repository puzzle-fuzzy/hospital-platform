import { ApiError, loadSession } from './api';
import type { Session } from './types';

export function getHospitalSession(): Session {
  const session = loadSession();
  if (!session) throw new ApiError('请先登录管理后台', 401);
  return session;
}

export function handleHospitalError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 401) {
    window.dispatchEvent(new Event('hospital:session-expired'));
  }
  return error instanceof Error ? error.message : fallback;
}
