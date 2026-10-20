const RETIRED_PATHS = new Set(['/hospital/logs', '/hospital/payments/simple']);
const RETIRED_NAMES = new Set(['HospitalLogs', 'HospitalPaymentSimple']);

function normalizePath(value: unknown): string {
  return typeof value === 'string'
    ? (value.split(/[?#]/, 1)[0]?.replace(/\/+$/, '') ?? '')
    : '';
}

function isRetiredPagePath(value: unknown): boolean {
  return RETIRED_PATHS.has(normalizePath(value));
}

export function retiredPageReplacement(value: unknown): string | undefined {
  return normalizePath(value) === '/hospital/payments/simple'
    ? '/hospital/payments/records'
    : undefined;
}

export function isRetiredPageEntry(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    (typeof entry.name === 'string' && RETIRED_NAMES.has(entry.name)) ||
    isRetiredPagePath(entry.path) ||
    isRetiredPagePath(entry.fullPath)
  );
}

export function removeRetiredPageSearchHistory(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  hostname: string,
): void {
  const key = `__search-history-${hostname}__`;
  try {
    const raw = storage.getItem(key);
    if (!raw) return;
    const history: unknown = JSON.parse(raw);
    if (!Array.isArray(history)) return;
    const remaining = history.filter((entry) => !isRetiredPageEntry(entry));
    if (remaining.length !== history.length) {
      storage.setItem(key, JSON.stringify(remaining));
    }
  } catch {
    // Optional local history must not prevent the application from starting.
  }
}
