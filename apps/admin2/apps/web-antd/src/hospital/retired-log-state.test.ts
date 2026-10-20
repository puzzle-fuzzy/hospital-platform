import { describe, expect, test } from 'vitest';

import {
  isRetiredLogEntry,
  removeRetiredLogSearchHistory,
} from './retired-log-state';

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

describe('retired real-time log entry identity', () => {
  test('matches only the retired route name, path or fullPath', () => {
    expect(isRetiredLogEntry({ name: 'HospitalLogs' })).toBe(true);
    expect(isRetiredLogEntry({ path: '/hospital/logs' })).toBe(true);
    expect(isRetiredLogEntry({ fullPath: '/hospital/logs' })).toBe(true);
    expect(
      isRetiredLogEntry({
        name: 'OldTabWithoutRouteName',
        path: '/hospital/payments/simple',
        fullPath: '/hospital/logs?level=error',
      }),
    ).toBe(true);
    expect(isRetiredLogEntry({ name: '实时日志' })).toBe(false);
    expect(isRetiredLogEntry({ key: '/hospital/logs' })).toBe(false);
  });

  test('matches query, hash and trailing-slash variants on either path field', () => {
    const paths = [
      '/hospital/logs/',
      '/hospital/logs///',
      '/hospital/logs?level=error',
      '/hospital/logs#record',
      '/hospital/logs/?level=warn#record',
      '/hospital/logs///#record?level=info',
    ];
    for (const path of paths) {
      expect(isRetiredLogEntry({ path })).toBe(true);
      expect(isRetiredLogEntry({ fullPath: path })).toBe(true);
    }
  });

  test('preserves adjacent paths and external URLs', () => {
    const paths = [
      '/hospital/log',
      '/hospital/logs2',
      '/hospital/logs-archive',
      '/hospital/logs/archive',
      '/hospital/payments/simple?return=/hospital/logs',
      '/other/hospital/logs',
      'https://external.test/hospital/logs',
      'https://external.test/hospital/logs/?level=error#record',
      '//external.test/hospital/logs',
      '#/hospital/logs',
    ];
    for (const path of paths) {
      expect(isRetiredLogEntry({ name: 'UnrelatedRoute', path })).toBe(false);
      expect(isRetiredLogEntry({ fullPath: path })).toBe(false);
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
      expect(isRetiredLogEntry(entry)).toBe(false);
    }
  });
});

describe('retired real-time log search history migration', () => {
  test('removes only target entries from mixed history while preserving order and unrelated data', () => {
    const remaining = [
      {
        name: '支付展示',
        path: '/hospital/payments/simple',
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
      remaining[1],
      { name: 'HospitalLogs', path: '/synthetic-previous-path' },
      remaining[2],
      remaining[3],
      { fullPath: '/hospital/logs///#record' },
      remaining[4],
      remaining[5],
    ];
    const fixture = memoryStorage(JSON.stringify(history));
    removeRetiredLogSearchHistory(fixture.storage, HOSTNAME);
    expect(fixture.reads).toEqual([SEARCH_KEY]);
    expect(fixture.writes).toEqual([
      { key: SEARCH_KEY, value: JSON.stringify(remaining) },
    ]);
    expect(fixture.values.get('synthetic-other-setting')).toBe(
      'keep-this-value',
    );
  });

  test('writes an empty list when every entry targets the retired page', () => {
    const fixture = memoryStorage(
      JSON.stringify([
        { name: 'HospitalLogs' },
        { path: '/hospital/logs/' },
        { fullPath: '/hospital/logs?q=synthetic' },
      ]),
    );
    removeRetiredLogSearchHistory(fixture.storage, HOSTNAME);
    expect(fixture.writes).toEqual([{ key: SEARCH_KEY, value: '[]' }]);
  });

  test('does not rewrite unchanged history or its original formatting', () => {
    const raw =
      '[\n  { "name": "支付记录", "path": "/hospital/payments/records" }\n]';
    const fixture = memoryStorage(raw);
    removeRetiredLogSearchHistory(fixture.storage, HOSTNAME);
    expect(fixture.writes).toEqual([]);
    expect(fixture.values.get(SEARCH_KEY)).toBe(raw);
  });

  test('repeated cleanup is idempotent and performs no extra write', () => {
    const fixture = memoryStorage(
      JSON.stringify([
        { path: '/hospital/logs' },
        { path: '/hospital/payments/day' },
      ]),
    );
    removeRetiredLogSearchHistory(fixture.storage, HOSTNAME);
    removeRetiredLogSearchHistory(fixture.storage, HOSTNAME);
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
        removeRetiredLogSearchHistory(fixture.storage, HOSTNAME),
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
      removeRetiredLogSearchHistory(storage, HOSTNAME),
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
      removeRetiredLogSearchHistory(storage, HOSTNAME),
    ).not.toThrow();
    expect(fixture.values.get(SEARCH_KEY)).toBe('[{"path":"/hospital/logs"}]');
    expect(fixture.values.get('synthetic-other-setting')).toBe(
      'keep-this-value',
    );
  });
});
