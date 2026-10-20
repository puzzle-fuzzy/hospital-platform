function isRetiredLogPath(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value.split(/[?#]/, 1)[0]?.replace(/\/+$/, '') === '/hospital/logs';
}

export function isRetiredLogEntry(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    entry.name === 'HospitalLogs' ||
    isRetiredLogPath(entry.path) ||
    isRetiredLogPath(entry.fullPath)
  );
}

export function removeRetiredLogSearchHistory(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  hostname: string,
): void {
  const key = `__search-history-${hostname}__`;
  try {
    const raw = storage.getItem(key);
    if (!raw) return;
    const history: unknown = JSON.parse(raw);
    if (!Array.isArray(history)) return;
    const remaining = history.filter((entry) => !isRetiredLogEntry(entry));
    if (remaining.length !== history.length) {
      storage.setItem(key, JSON.stringify(remaining));
    }
  } catch {
    // Optional local history must not prevent the application from starting.
  }
}
