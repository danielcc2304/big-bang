import { readFile } from 'node:fs/promises';

const rules = JSON.parse(await readFile(new URL('../firebase.database.rules.json', import.meta.url), 'utf8'));
if (!rules || typeof rules !== 'object' || !rules.rules || typeof rules.rules !== 'object') {
  throw new Error('firebase.database.rules.json debe contener un objeto rules válido.');
}
const root = rules.rules;
const room = root.rooms?.$roomId;
const command = room?.commands?.$commandId;
if (root['.read'] !== false || root['.write'] !== false || typeof room?.['.read'] !== 'string' || typeof room?.['.write'] !== 'string' || !room['.read'].includes('auth') || !room['.write'].includes('auth')) {
  throw new Error('Las reglas RTDB deben mantener el acceso global cerrado y exigir auth en las salas.');
}
if (typeof command?.['.write'] !== 'string' || !command['.write'].includes('matches') || typeof room.players?.$playerId?.['.validate'] !== 'string' || typeof room.presence?.$playerId?.$connectionId?.['.validate'] !== 'string') {
  throw new Error('Faltan validaciones de comandos o presencia en las reglas RTDB.');
}
console.log('Firebase Realtime Database rules: OK');
