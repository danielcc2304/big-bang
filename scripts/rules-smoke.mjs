import { readFile } from 'node:fs/promises';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

const rules = await readFile(new URL('../firebase.database.rules.json', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({
  projectId: 'demo-bang',
  database: { rules },
});

const now = Date.now();
const room = {
  code: 'ABC123',
  status: 'LOBBY',
  createdAt: now,
  hostUid: 'host',
  maxPlayers: 4,
  characterMode: 'OFFICIAL',
  seats: {
    0: { number: 0, playerId: 'player-host', ownerUid: 'host', reconnectHash: null, isBot: false, joinedAt: now },
  },
  players: {
    'player-host': { uid: 'host', playerId: 'player-host', displayName: 'Host', connected: true, lastSeen: now },
  },
  coordinator: { coordinatorId: 'host', coordinatorEpoch: 1, leaseUntil: now + 12_000, heartbeat: now },
  commands: {},
};

try {
  const host = env.authenticatedContext('host').database();
  const guest = env.authenticatedContext('guest').database();
  const stranger = env.authenticatedContext('stranger').database();
  const recoverer = env.authenticatedContext('recoverer').database();

  // createRoom reserves a fresh code with a transaction, whose preflight read
  // must be allowed while the room path is still empty.
  await assertSucceeds(host.ref('rooms/EMPTY1').get());
  await assertSucceeds(host.ref('rooms/ABC123').set(room));
  await assertSucceeds(host.ref('seatProofs/ABC123/0').set('a'.repeat(64)));
  await assertFails(recoverer.ref('reconnectClaims/ABC123/recoverer').set({ hash: 'b'.repeat(64), requestedAt: Date.now() }));
  await assertSucceeds(recoverer.ref('reconnectClaims/ABC123/recoverer').set({ hash: 'a'.repeat(64), requestedAt: Date.now() }));
  await assertSucceeds(recoverer.ref('reconnectClaims/ABC123/recoverer').remove());
  await assertSucceeds(guest.ref('rooms/ABC123').get());
  await assertSucceeds(guest.ref('rooms/ABC123/seats/1').set({ number: 1, playerId: 'player-guest', ownerUid: 'guest', reconnectHash: null, isBot: false, joinedAt: now }));
  await assertFails(guest.ref('rooms/ABC123/seats/2').set({ number: 2, playerId: 'player-guest-2', ownerUid: 'guest', reconnectHash: null, isBot: false, joinedAt: now }));
  await assertFails(guest.ref('rooms/ABC123/seats/4').set({ number: 4, playerId: 'player-overflow', ownerUid: 'guest-2', reconnectHash: null, isBot: false, joinedAt: now }));
  await assertSucceeds(guest.ref('rooms/ABC123/players/player-guest').set({ uid: 'guest', playerId: 'player-guest', displayName: 'Guest', connected: true, lastSeen: now }));
  const partialDisconnect = guest.ref('rooms/ABC123/presence/player-guest/partial-disconnect').onDisconnect();
  await assertFails(partialDisconnect.update({ connected: false, lastSeen: { '.sv': 'timestamp' } }));
  const fullDisconnect = guest.ref('rooms/ABC123/presence/player-guest/full-disconnect').onDisconnect();
  await assertSucceeds(fullDisconnect.set({ uid: 'guest', connected: false, connectedAt: now, lastSeen: { '.sv': 'timestamp' } }));
  await fullDisconnect.cancel();
  await assertFails(guest.ref('rooms/ABC123/players/player-guest').update({ uid: 'spoofed' }));
  await assertFails(guest.ref('rooms/ABC123/players/player-guest').update({ lastSeen: Date.now() + 60_000 }));
  await assertSucceeds(guest.ref('rooms/ABC123/presence/player-guest/connection').set({ uid: 'guest', connected: true, connectedAt: now, lastSeen: now }));
  await assertFails(guest.ref('rooms/ABC123/presence/player-guest/connection').update({ lastSeen: Date.now() + 60_000 }));
  await assertFails(stranger.ref('rooms/ABC123/players/player-host').set({ uid: 'stranger', playerId: 'player-host', displayName: 'Spoof', connected: true, lastSeen: now }));
  await assertFails(stranger.ref('rooms/ABC123/presence/player-host/connection').set({ uid: 'stranger', connected: true, connectedAt: now, lastSeen: now }));

  await assertSucceeds(host.ref('rooms/ABC123').update({ status: 'PLAYING', canonical: { revision: 0 } }));
  await assertSucceeds(host.ref('rooms/ABC123').update({ coordinator: { coordinatorId: 'host', coordinatorEpoch: 1, leaseUntil: Date.now() - 1, heartbeat: Date.now() } }));
  await assertFails(stranger.ref('rooms/ABC123/coordinator').set({ coordinatorId: 'stranger', coordinatorEpoch: 2, leaseUntil: Date.now() + 12_000, heartbeat: Date.now() }));
  await assertSucceeds(recoverer.ref('reconnectClaims/ABC123/recoverer').set({ hash: 'a'.repeat(64), requestedAt: Date.now() }));
  await assertSucceeds(recoverer.ref('rooms/ABC123/coordinator').get());
  await assertSucceeds(recoverer.ref('rooms/ABC123/coordinator').set({ coordinatorId: 'recoverer', coordinatorEpoch: 2, leaseUntil: Date.now() + 12_000, heartbeat: Date.now() }));
  await assertSucceeds(recoverer.ref('rooms/ABC123/coordinator').set({ coordinatorId: 'host', coordinatorEpoch: 3, leaseUntil: Date.now() + 12_000, heartbeat: Date.now() }));
  await assertSucceeds(recoverer.ref('reconnectClaims/ABC123/recoverer').remove());

  await assertFails(stranger.ref('rooms/ABC123').get());
  await assertSucceeds(guest.ref('rooms/ABC123/commands/slot-0').set({ submittedByUid: 'guest', submittedAt: Date.now(), command: { commandId: 'guest-command', playerId: 'player-guest', type: 'END_TURN', expectedRevision: 0, createdAt: Date.now(), payload: {} } }));
  await assertFails(guest.ref('rooms/ABC123/commands/slot-0').set({ submittedByUid: 'guest', submittedAt: Date.now(), command: { commandId: 'replacement', playerId: 'player-guest', type: 'END_TURN', expectedRevision: 0, createdAt: Date.now(), payload: {} } }));
  await assertFails(guest.ref('rooms/ABC123/commands/slot-100').set({ submittedByUid: 'guest', submittedAt: Date.now(), command: { commandId: 'overflow', playerId: 'player-guest', type: 'END_TURN', expectedRevision: 0, createdAt: Date.now(), payload: {} } }));
  await assertFails(guest.ref('rooms/ABC123/commands/slot-1').set({ submittedByUid: 'guest', submittedAt: Date.now(), command: { commandId: 'invalid-type', playerId: 'player-guest', type: 'HACK', expectedRevision: 0, createdAt: Date.now(), payload: {} } }));
  await assertFails(guest.ref('rooms/ABC123/commands/slot-2').set({ submittedByUid: 'guest', submittedAt: now, command: { commandId: 'fake', playerId: 'player-host', type: 'END_TURN', expectedRevision: 0, createdAt: now, payload: {} } }));
  await assertSucceeds(host.ref('rooms/ABC123').update({ canonical: { revision: 1 } }));
  await assertSucceeds(host.ref('rooms/ABC123').update({ status: 'ENDED' }));
  await assertFails(host.ref('rooms/ABC123').update({ status: 'PLAYING' }));

  console.log('Firebase rules smoke: OK');
} finally {
  await env.cleanup();
}

