import { get, ref, type Database } from 'firebase/database';

let serverTimeOffset = 0;

export const setServerTimeOffset = (offset: number): void => {
  if (Number.isFinite(offset)) serverTimeOffset = offset;
};

export const serverNow = (): number => Date.now() + serverTimeOffset;

export const syncServerClock = async (database: Database): Promise<void> => {
  try {
    const snapshot = await get(ref(database, '.info/serverTimeOffset'));
    setServerTimeOffset(Number(snapshot.val() ?? 0));
  } catch {
    // A temporary clock read failure must not prevent the normal reconnect path.
  }
};
