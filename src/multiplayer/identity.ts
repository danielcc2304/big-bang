import { secureId } from '../utils/random';

const bytesToHex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export const createReconnectToken = (): string => `${secureId('seat')}.${secureId('proof')}`;

export const hashReconnectToken = async (token: string): Promise<string> => {
  const data = new TextEncoder().encode(token);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
};

const storageKey = (roomCode: string): string => `bang:reconnect:${roomCode}`;

export const saveReconnectToken = (roomCode: string, token: string): void => localStorage.setItem(storageKey(roomCode), token);
export const loadReconnectToken = (roomCode: string): string | null => localStorage.getItem(storageKey(roomCode));
export const clearReconnectToken = (roomCode: string): void => localStorage.removeItem(storageKey(roomCode));
