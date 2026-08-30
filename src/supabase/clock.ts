import { requireSupabaseClient } from './client';

let serverTimeOffset = 0;

export const setServerTimeOffset = (offset: number): void => {
  serverTimeOffset = Number.isFinite(offset) ? offset : 0;
};

export const serverNow = (): number => Date.now() + serverTimeOffset;

export const syncServerClock = async (): Promise<void> => {
  try {
    const response = await requireSupabaseClient().rpc('server_now_ms') as unknown as { readonly data: unknown; readonly error: Error | null };
    const { data, error } = response;
    if (error) throw error;
    const serverMilliseconds = typeof data === 'number' ? data : Number(data);
    if (Number.isFinite(serverMilliseconds)) setServerTimeOffset(serverMilliseconds - Date.now());
  } catch {
    // A local clock is a safe fallback for rendering and retry windows. All
    // authorization-sensitive deadlines are checked again inside PostgreSQL.
  }
};
