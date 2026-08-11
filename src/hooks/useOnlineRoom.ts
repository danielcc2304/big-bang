import { onValue, ref } from 'firebase/database';
import { useEffect, useState } from 'react';
import { firebaseServices } from '../firebase/client';
import { hydrateRoom } from '../multiplayer/hydrate';
import type { ConnectionState, Room } from '../types';

const initialConnection: ConnectionState = { connected: false, syncing: false, localRevision: 0, serverRevision: 0, pingMs: null, lastUpdateAt: null, errors: [] };

export const useOnlineRoom = (code: string | null): { readonly room: Room | null; readonly connection: ConnectionState } => {
  const [room, setRoom] = useState<Room | null>(null);
  const [connection, setConnection] = useState<ConnectionState>(initialConnection);
  useEffect(() => {
    const services = firebaseServices();
    if (!services || !code) return;
    const connectedUnsubscribe = onValue(ref(services.database, '.info/connected'), (snapshot) => setConnection((current) => ({ ...current, connected: snapshot.val() === true })));
    const startedAt = performance.now();
    const roomUnsubscribe = onValue(ref(services.database, `rooms/${code}`), (snapshot) => {
      const value = snapshot.val() as Room | null;
      const next = value ? hydrateRoom(value) : null;
      setRoom(next);
      setConnection((current) => ({ ...current, syncing: false, serverRevision: next?.canonical?.revision ?? 0, pingMs: Math.round(performance.now() - startedAt), lastUpdateAt: Date.now() }));
    }, (error) => setConnection((current) => ({ ...current, errors: [...current.errors.slice(-4), error.message] })));
    return () => { connectedUnsubscribe(); roomUnsubscribe(); };
  }, [code]);
  return { room, connection };
};
