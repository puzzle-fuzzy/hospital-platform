import {
  ApiError,
  isReadOnlySession,
  loadSession,
  login,
  logout,
} from '#/hospital/api';

export namespace AuthApi {
  export interface LoginParams {
    username?: string;
    password?: string;
    loginMode?: 'operator' | 'viewer';
    captcha?: string;
    captchaKey?: string;
    captchaEnabled?: boolean;
  }
  export interface LoginResult {
    accessToken: string;
  }
  export interface RefreshTokenResult {
    data: string;
    status: number;
  }
}

export async function loginApi(
  data: AuthApi.LoginParams,
): Promise<AuthApi.LoginResult> {
  const session = await login(
    {
      username: data.username ?? '',
      password: data.password ?? '',
      loginMode: data.loginMode ?? 'operator',
      ...(data.captcha ? { captcha: data.captcha } : {}),
    },
    {
      enabled: data.captchaEnabled !== false,
      key: data.captchaKey ?? '',
      image: '',
    },
  );
  return { accessToken: session.accessToken };
}

export async function refreshTokenApi(): Promise<AuthApi.RefreshTokenResult> {
  throw new ApiError('会话已失效，请重新登录', 401);
}

export async function logoutApi() {
  const session = loadSession();
  if (session) await logout(session);
}

export async function getAccessCodesApi(): Promise<string[]> {
  const session = loadSession();
  if (!session) throw new ApiError('请先登录', 401);
  return isReadOnlySession(session)
    ? ['hospital:read']
    : [
        'hospital:read',
        'hospital:refund',
        'hospital:registration',
        'hospital:sync',
        'hospital:raw',
      ];
}
