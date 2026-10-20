import { describe, expect, test } from 'vitest';

import {
  isRetiredPageEntry,
  removeRetiredPageSearchHistory,
  retiredPageReplacement,
} from './retired-page-state';

const HOSTNAME = 'synthetic-admin.test';
const SEARCH_KEY = `__search-history-${HOSTNAME}__`;

function memoryStorage(raw?: string) {
  const values = new Map<string, string>([
    ['synthetic-other-setting', 'keep-this-value'],
  ]);
  if (raw !== undefined) values.set(SEARCH_KEY, raw);
  const reads: string[] = [];
  const writes: Array<{ key: string; value: string }> = [];
  const storage: Pick<Storage, 'getItem' | 'setItem'> = {
    getItem(key) {
      reads.push(key);
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      writes.push({ key, value });
      values.set(key, value);
    },
  };
  return { reads, storage, values, writes };
}

describe('retired business page entry identity', () => {
  test('matches only the retired route name, path or fullPath', () => {
    expect(isRetiredPageEntry({ name: 'HospitalLogs' })).toBe(true);
    expect(isRetiredPageEntry({ path: '/hospital/logs' })).toBe(true);
    expect(isRetiredPageEntry({ fullPath: '/hospital/logs' })).toBe(true);
    expect(isRetiredPageEntry({ name: 'HospitalPaymentSimple' })).toBe(true);
    expect(isRetiredPageEntry({ path: '/hospital/payments/simple' })).toBe(
      true,
    );
    expect(isRetiredPageEntry({ fullPath: '/hospital/payments/simple' })).toBe(
      true,
    );
    expect(
      isRetiredPageEntry({
        name: 'OldTabWithoutRouteName',
        path: '/hospital/payments/records',
        fullPath: '/hospital/logs?level=error',
      }),
    ).toBe(true);
    expect(isRetiredPageEntry({ name: '实时日志' })).toBe(false);
    expect(isRetiredPageEntry({ name: '支付展示' })).toBe(false);
    expect(isRetiredPageEntry({ key: '/hospital/logs' })).toBe(false);
    expect(isRetiredPageEntry({ key: '/hospital/payments/simple' })).toBe(
      false,
    );
  });

  test('matches query, hash and trailing-slash variants on either path field', () => {
    const paths = [
      '/hospital/logs/',
      '/hospital/logs///',
      '/hospital/logs?level=error',
      '/hospital/logs#record',
      '/hospital/logs/?level=warn#record',
      '/hospital/logs///#record?level=info',
      '/hospital/payments/simple/',
      '/hospital/payments/simple///',
      '/hospital/payments/simple?mode=viewer',
      '/hospital/payments/simple#record',
      '/hospital/payments/simple/?mode=viewer#record',
      '/hospital/payments/simple///#record?mode=viewer',
    ];
    for (const path of paths) {
      expect(isRetiredPageEntry({ path })).toBe(true);
      expect(isRetiredPageEntry({ fullPath: path })).toBe(true);
    }
  });

  test('preserves adjacent paths and external URLs', () => {
    const paths = [
      '/hospital/log',
      '/hospital/logs2',
      '/hospital/logs-archive',
      '/hospital/logs/archive',
      '/hospital/payments/records?return=/hospital/logs',
      '/hospital/payments/records?return=/hospital/payments/simple',
      '/hospital/payments/simple2',
      '/hospital/payments/simple-archive',
      '/hospital/payments/simple/archive',
      '/other/hospital/payments/simple',
      '/other/hospital/logs',
      'https://external.test/hospital/logs',
      'https://external.test/hospital/logs/?level=error#record',
      '//external.test/hospital/logs',
      '#/hospital/logs',
      'https://external.test/hospital/payments/simple',
      'https://external.test/hospital/payments/simple/?mode=viewer#record',
      '//external.test/hospital/payments/simple',
      '#/hospital/payments/simple',
    ];
    for (const path of paths) {
      expect(isRetiredPageEntry({ name: 'UnrelatedRoute', path })).toBe(false);
      expect(isRetiredPageEntry({ fullPath: path })).toBe(false);
    }
  });

  test('does not treat malformed entries as a target', () => {
    for (const entry of [
      undefined,
      null,
      false,
      0,
      'HospitalLogs',
      [],
      {},
      { path: 1 },
      { fullPath: null },
    ]) {
      expect(isRetiredPageEntry(entry)).toBe(false);
    }
  });
});

describe('retired business page search history migration', () => {
  test('removes only target entries from mixed history while preserving order and unrelated data', () => {
    const remaining = [
      {
        name: '支付记录',
        path: '/hospital/payments/records',
        extra: 'unchanged',
      },
      { name: '归档记录', path: '/hospital/logs/archive' },
      { name: '外部页面', path: 'https://external.test/hospital/logs' },
      null,
      'synthetic-malformed-entry',
      { name: '同步任务', path: '/hospital/payments/sync' },
    ];
    const history = [
      remaining[0],
      { name: '实时日志', path: '/hospital/logs?level=warn#record' },
      {
        name: '支付展示',
        path: '/hospital/payments/simple?mode=viewer#record',
      },
      remaining[1],
      { name: 'HospitalLogs', path: '/synthetic-previous-path' },
      {
        name: 'HospitalPaymentSimple',
        path: '/synthetic-previous-payment-path',
      },
      remaining[2],
      remaining[3],
      { fullPath: '/hospital/logs///#record' },
      { fullPath: '/hospital/payments/simple///#record' },
      remaining[4],
      remaining[5],
    ];
    const fixture = memoryStorage(JSON.stringify(history));
    removeRetiredPageSearchHistory(fixture.storage, HOSTNAME);
    expect(fixture.reads).toEqual([SEARCH_KEY]);
    expect(fixture.writes).toEqual([
      { key: SEARCH_KEY, value: JSON.stringify(remaining) },
    ]);
    expect(fixture.values.get('synthetic-other-setting')).toBe(
      'keep-this-value',
    );
  });

  test('writes an empty list when every entry targets either retired page', () => {
    const fixture = memoryStorage(
      JSON.stringify([
        { name: 'HospitalLogs' },
        { path: '/hospital/logs/' },
        { fullPath: '/hospital/logs?q=synthetic' },
        { name: 'HospitalPaymentSimple' },
        { path: '/hospital/payments/simple/' },
        { fullPath: '/hospital/payments/simple?mode=viewer#record' },
      ]),
    );
    removeRetiredPageSearchHistory(fixture.storage, HOSTNAME);
    expect(fixture.writes).toEqual([{ key: SEARCH_KEY, value: '[]' }]);
  });

  test('does not rewrite unchanged history or its original formatting', () => {
    const raw =
      '[\n  { "name": "支付记录", "path": "/hospital/payments/records" }\n]';
    const fixture = memoryStorage(raw);
    removeRetiredPageSearchHistory(fixture.storage, HOSTNAME);
    expect(fixture.writes).toEqual([]);
    expect(fixture.values.get(SEARCH_KEY)).toBe(raw);
  });

  test('repeated cleanup is idempotent and performs no extra write', () => {
    const fixture = memoryStorage(
      JSON.stringify([
        { path: '/hospital/logs' },
        { path: '/hospital/payments/simple' },
        { path: '/hospital/payments/day' },
      ]),
    );
    removeRetiredPageSearchHistory(fixture.storage, HOSTNAME);
    removeRetiredPageSearchHistory(fixture.storage, HOSTNAME);
    expect(fixture.writes).toHaveLength(1);
    expect(JSON.parse(fixture.values.get(SEARCH_KEY) ?? 'null')).toEqual([
      { path: '/hospital/payments/day' },
    ]);
  });

  test('missing, damaged JSON or non-array data does not block startup or cause a write', () => {
    for (const raw of [
      undefined,
      '',
      '{unfinished',
      'null',
      '42',
      '"synthetic"',
      '{"path":"/hospital/logs"}',
    ]) {
      const fixture = memoryStorage(raw);
      expect(() =>
        removeRetiredPageSearchHistory(fixture.storage, HOSTNAME),
      ).not.toThrow();
      expect(fixture.writes).toEqual([]);
      expect(fixture.values.get(SEARCH_KEY)).toBe(raw);
    }
  });

  test('storage read exceptions are optional and never trigger a write', () => {
    let writes = 0;
    const storage: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem() {
        throw new Error('Synthetic storage read unavailable');
      },
      setItem() {
        writes += 1;
      },
    };
    expect(() =>
      removeRetiredPageSearchHistory(storage, HOSTNAME),
    ).not.toThrow();
    expect(writes).toBe(0);
  });

  test('storage write exceptions do not block startup or alter unrelated keys', () => {
    const fixture = memoryStorage('[{"path":"/hospital/logs"}]');
    const storage: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: fixture.storage.getItem,
      setItem() {
        throw new Error('Synthetic storage quota unavailable');
      },
    };
    expect(() =>
      removeRetiredPageSearchHistory(storage, HOSTNAME),
    ).not.toThrow();
    expect(fixture.values.get(SEARCH_KEY)).toBe('[{"path":"/hospital/logs"}]');
    expect(fixture.values.get('synthetic-other-setting')).toBe(
      'keep-this-value',
    );
  });
});

describe('retired business page replacement', () => {
  test('maps only the retired payment display page to payment records', () => {
    for (const path of [
      '/hospital/payments/simple',
      '/hospital/payments/simple/',
      '/hospital/payments/simple///',
      '/hospital/payments/simple?mode=viewer',
      '/hospital/payments/simple#record',
      '/hospital/payments/simple/?mode=viewer#record',
      '/hospital/payments/simple///#record?mode=viewer',
    ]) {
      expect(retiredPageReplacement(path)).toBe('/hospital/payments/records');
    }
  });

  test('does not replace logs, active pages, adjacent paths or external URLs', () => {
    for (const path of [
      '/hospital/logs',
      '/hospital/logs/',
      '/hospital/logs?mode=viewer#record',
      '/hospital/payments/records',
      '/hospital/payments/simple2',
      '/hospital/payments/simple-archive',
      '/hospital/payments/simple/archive',
      '/other/hospital/payments/simple',
      '/hospital/payments/records?return=/hospital/payments/simple',
      '/auth/login?redirect=%2Fhospital%2Fpayments%2Fsimple',
      'https://external.test/hospital/payments/simple',
      'https://external.test/hospital/payments/simple/?mode=viewer#record',
      '//external.test/hospital/payments/simple',
      '#/hospital/payments/simple',
      'HospitalPaymentSimple',
      undefined,
      null,
      false,
      0,
      [],
      { path: '/hospital/payments/simple' },
    ]) {
      expect(retiredPageReplacement(path)).toBeUndefined();
    }
  });
});
