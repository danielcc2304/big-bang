import { useEffect, useState } from 'react';
import { supabaseServices } from '../supabase/client';
import { serverNow, syncServerClock } from '../supabase/clock';
import { getRoomSnapshot, setPresenceOffline, subscribeToRoom, updatePresence } from '../multiplayer/supabaseRepository';
import type { ConnectionState, Room } from '../types';

const initialConnection: ConnectionState = { connected: false, syncing: false, localRevision: 0, serverRevision: 0, pingMs: null, lastUpdateAt: null, errors: [] };

export const useOnlineRoom = (code: string | null, playerId?: string, uid?: string, connectionId?: string): { readonly room: Room | null; readonly connection: ConnectionState; readonly retry: () => void } => {
  const [room, setRoom] = useState<Room | null>(null);
  const [connection, setConnection] = useState<ConnectionState>(initialConnection);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setRoom(null);
    setConnection(initialConnection);
    if (!supabaseServices() || !code) return undefined;
    let cancelled = false;
    let reloadInFlight = false;
    const startedAt = performance.now();
    const reportError = (error: unknown): void => {
      const message = error instanceof Error ? error.message : 'No se pudo sincronizar la sala.';
      if (cancelled) return;
      setConnection((current) => ({ ...current, connected: false, syncing: false, lastUpdateAt: Date.now(), errors: [...current.errors.slice(-4), message] }));
    };
    const reload = async (): Promise<void> => {
      if (reloadInFlight || cancelled) return;
      reloadInFlight = true;
      setConnection((current) => ({ ...current, syncing: true }));
      try {
        const next = await getRoomSnapshot(code);
        if (cancelled) return;
        setRoom(next);
        setConnection((current) => ({
          ...current,
          connected: true,
          syncing: false,
          serverRevision: next?.canonical?.revision ?? 0,
          pingMs: Math.round(performance.now() - startedAt),
          lastUpdateAt: Date.now(),
        }));
      } catch (error) {
        reportError(error);
      } finally {
        reloadInFlight = false;
      }
    };
    void syncServerClock().then(reload).catch(reportError);
    const unsubscribe = subscribeToRoom(code, () => { void reload(); }, reportError);
    const heartbeat = playerId && uid && connectionId
      ? window.setInterval(() => {
        void updatePresence(code, playerId, connectionId, serverNow()).catch(reportError);
      }, 5_000)
      : undefined;
    const markOffline = (): void => {
      if (playerId && connectionId) void setPresenceOffline(code, playerId, connectionId, serverNow()).catch(() => undefined);
    };
    window.addEventListener('pagehide', markOffline);
    return () => {
      cancelled = true;
      unsubscribe();
      if (heartbeat !== undefined) window.clearInterval(heartbeat);
      window.removeEventListener('pagehide', markOffline);
      markOffline();
    };
  }, [attempt, code, connectionId, playerId, uid]);
  return { room, connection, retry: () => setAttempt((current) => current + 1) };
};
