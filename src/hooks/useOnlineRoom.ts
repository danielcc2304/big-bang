import { onValue, ref, serverTimestamp, update } from 'firebase/database';
import { useEffect, useState } from 'react';
import { firebaseServices } from '../firebase/client';
import { setServerTimeOffset } from '../firebase/clock';
import { hydrateRoom } from '../multiplayer/hydrate';
import type { ConnectionState, Room } from '../types';

const initialConnection: ConnectionState = { connected: false, syncing: false, localRevision: 0, serverRevision: 0, pingMs: null, lastUpdateAt: null, errors: [] };

export const useOnlineRoom = (code: string | null, playerId?: string, uid?: string, connectionId?: string): { readonly room: Room | null; readonly connection: ConnectionState; readonly retry: () => void } => {
  const [room, setRoom] = useState<Room | null>(null);
  const [connection, setConnection] = useState<ConnectionState>(initialConnection);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setRoom(null);
    setConnection(initialConnection);
    const services = firebaseServices();
    if (!services || !code) return;
    const connectedUnsubscribe = onValue(ref(services.database, '.info/connected'), (snapshot) => setConnection((current) => ({ ...current, connected: snapshot.val() === true })), (error) => setConnection((current) => ({ ...current, lastUpdateAt: Date.now(), errors: [...current.errors.slice(-4), error.message] })));
    const clockUnsubscribe = onValue(ref(services.database, '.info/serverTimeOffset'), (snapshot) => setServerTimeOffset(Number(snapshot.val() ?? 0)));
    const startedAt = performance.now();
    const roomUnsubscribe = onValue(ref(services.database, `rooms/${code}`), (snapshot) => {
      try {
        const value = snapshot.val() as Room | null;
        const next = value ? hydrateRoom(value) : null;
        setRoom(next);
        setConnection((current) => ({ ...current, syncing: false, serverRevision: next?.canonical?.revision ?? 0, pingMs: Math.round(performance.now() - startedAt), lastUpdateAt: Date.now() }));
      } catch (error) {
        setRoom(null);
        setConnection((current) => ({ ...current, syncing: false, lastUpdateAt: Date.now(), errors: [...current.errors.slice(-4), error instanceof Error ? error.message : 'La sala contiene datos inválidos.'] }));
      }
    }, (error) => setConnection((current) => ({ ...current, syncing: false, lastUpdateAt: Date.now(), errors: [...current.errors.slice(-4), error.message] })));
    const heartbeat = playerId && uid && connectionId
      ? window.setInterval(() => {
        void update(ref(services.database, `rooms/${code}/presence/${playerId}/${connectionId}`), { uid, connected: true, lastSeen: serverTimestamp() }).catch((error: unknown) => {
          setConnection((current) => ({ ...current, errors: [...current.errors.slice(-4), error instanceof Error ? error.message : 'No se pudo actualizar la presencia.'] }));
        });
      }, 5000)
      : undefined;
    return () => { connectedUnsubscribe(); clockUnsubscribe(); roomUnsubscribe(); if (heartbeat !== undefined) window.clearInterval(heartbeat); };
  }, [attempt, code, connectionId, playerId, uid]);
  return { room, connection, retry: () => setAttempt((current) => current + 1) };
};
