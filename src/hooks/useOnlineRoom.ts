import { onValue, ref, serverTimestamp, update } from 'firebase/database';
import { useEffect, useState } from 'react';
import { firebaseServices } from '../firebase/client';
import { setServerTimeOffset } from '../firebase/clock';
import { hydrateRoom } from '../multiplayer/hydrate';
import { markPresenceOffline, refreshPresence } from '../multiplayer/roomService';
import type { ConnectionState, Room } from '../types';

const initialConnection: ConnectionState = { connected: false, syncing: false, localRevision: 0, serverRevision: 0, pingMs: null, lastUpdateAt: null, errors: [] };

export const useOnlineRoom = (code: string | null, playerId?: string, uid?: string, connectionId?: string): { readonly room: Room | null; readonly connection: ConnectionState; readonly retry: () => void } => {
  const [room, setRoom] = useState<Room | null>(null);
  const [connection, setConnection] = useState<ConnectionState>(initialConnection);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setRoom(null);
    setConnection({ ...initialConnection, syncing: Boolean(code) });
    const services = firebaseServices();
    if (!services || !code) return;
    const presence = playerId && uid && connectionId ? { playerId, uid, connectionId } : null;
    const recordError = (error: unknown, fallback: string): void => {
      const message = error instanceof Error ? error.message : fallback;
      setConnection((current) => current.errors.at(-1) === message ? current : { ...current, lastUpdateAt: Date.now(), errors: [...current.errors.slice(-4), message] });
    };
    const connectedUnsubscribe = onValue(ref(services.database, '.info/connected'), (snapshot) => {
      const connected = snapshot.val() === true;
      setConnection((current) => ({ ...current, connected }));
      // Firebase drops onDisconnect handlers after a transport restart. Re-arm
      // the handler and the active connection record whenever RTDB reconnects.
      if (connected && presence) void refreshPresence(code, presence.playerId, presence.uid, presence.connectionId).catch((error: unknown) => recordError(error, 'No se pudo restaurar la presencia.'));
    }, (error) => recordError(error, 'No se pudo comprobar la conexión.'));
    const clockUnsubscribe = onValue(ref(services.database, '.info/serverTimeOffset'), (snapshot) => setServerTimeOffset(Number(snapshot.val() ?? 0)));
    const startedAt = performance.now();
    const roomUnsubscribe = onValue(ref(services.database, `rooms/${code}`), (snapshot) => {
      try {
        const value = snapshot.val() as Room | null;
        const next = value ? hydrateRoom(value) : null;
        setRoom(next);
        setConnection((current) => ({ ...current, syncing: false, serverRevision: next?.canonical?.revision ?? 0, pingMs: Math.round(performance.now() - startedAt), lastUpdateAt: Date.now(), errors: [] }));
      } catch (error) {
        setRoom(null);
        setConnection((current) => ({ ...current, syncing: false, lastUpdateAt: Date.now(), errors: [...current.errors.slice(-4), error instanceof Error ? error.message : 'La sala contiene datos inválidos.'] }));
      }
    }, (error) => setConnection((current) => ({ ...current, syncing: false, lastUpdateAt: Date.now(), errors: [...current.errors.slice(-4), error.message] })));
    const heartbeat = presence
      ? window.setInterval(() => {
        void update(ref(services.database, `rooms/${code}/presence/${presence.playerId}/${presence.connectionId}`), { uid: presence.uid, connected: true, lastSeen: serverTimestamp() }).catch((error: unknown) => recordError(error, 'No se pudo actualizar la presencia.'));
      }, 5000)
      : undefined;
    return () => {
      connectedUnsubscribe(); clockUnsubscribe(); roomUnsubscribe();
      if (heartbeat !== undefined) window.clearInterval(heartbeat);
      if (presence) void markPresenceOffline(code, presence.playerId, presence.uid, presence.connectionId).catch(() => undefined);
    };
  }, [attempt, code, connectionId, playerId, uid]);
  return { room, connection, retry: () => setAttempt((current) => current + 1) };
};

