import type { Card, Equipment, GameState, Player } from '../../types';
import { determineWinner } from '../rules/victory';

export const replacePlayer = (state: GameState, nextPlayer: Player): GameState => ({
  ...state,
  players: state.players.map((player) => player.id === nextPlayer.id ? nextPlayer : player),
});

export const playerById = (state: GameState, id: string): Player | undefined => state.players.find((player) => player.id === id);

export const drawCards = (state: GameState, count: number): { readonly state: GameState; readonly cards: readonly Card[] } => {
  let deck = [...state.deck];
  let discard = [...state.discard];
  const cards: Card[] = [];
  for (let index = 0; index < count; index += 1) {
    if (deck.length === 0) {
      deck = discard.reverse();
      discard = [];
    }
    const card = deck.shift();
    if (card) cards.push(card);
  }
  return { state: { ...state, deck, discard }, cards };
};

export const allEquipmentCards = (equipment: Equipment): readonly Card[] => [
  equipment.weapon, equipment.barrel, equipment.mustang, equipment.scope, equipment.jail, equipment.dynamite,
].filter((card): card is Card => card !== null);

const emptyEquipment = (): Equipment => ({ weapon: null, barrel: null, mustang: null, scope: null, jail: null, dynamite: null });

const checkSuzy = (state: GameState, playerId: string): GameState => {
  const player = playerById(state, playerId);
  if (!player?.alive || player.character.name !== 'Suzy Lafayette' || player.hand.length > 0) return state;
  const draw = drawCards(state, 1);
  return replacePlayer(draw.state, { ...player, hand: draw.cards });
};

export const healPlayer = (state: GameState, playerId: string, amount: number): GameState => {
  const player = playerById(state, playerId);
  if (!player?.alive) return state;
  return replacePlayer(state, { ...player, lives: Math.min(player.maxLives, player.lives + amount) });
};

export const eliminatePlayer = (state: GameState, victimId: string, killerId: string | null): GameState => {
  const victim = playerById(state, victimId);
  if (!victim?.alive) return state;
  const spoils = [...victim.hand, ...allEquipmentCards(victim.equipment)];
  let next = replacePlayer(state, { ...victim, alive: false, lives: 0, hand: [], equipment: emptyEquipment() });
  const vulture = next.players.find((player) => player.alive && player.character.name === 'Vulture Sam');
  if (vulture) next = replacePlayer(next, { ...vulture, hand: [...vulture.hand, ...spoils] });
  else next = { ...next, discard: [...next.discard, ...spoils] };

  const killer = killerId ? playerById(next, killerId) : undefined;
  if (killer?.alive && victim.role === 'OUTLAW') {
    const draw = drawCards(next, 3);
    next = replacePlayer(draw.state, { ...killer, hand: [...killer.hand, ...draw.cards] });
  }
  if (killer?.alive && killer.role === 'SHERIFF' && victim.role === 'DEPUTY') {
    next = replacePlayer(next, { ...killer, hand: [], equipment: emptyEquipment() });
    next = { ...next, discard: [...next.discard, ...killer.hand, ...allEquipmentCards(killer.equipment)] };
  }
  const winner = determineWinner(next);
  return winner ? { ...next, winner, turn: { ...next.turn, phase: 'GAME_OVER' } } : next;
};

export const damagePlayer = (state: GameState, victimId: string, amount: number, attackerId: string | null): GameState => {
  const victim = playerById(state, victimId);
  if (!victim?.alive) return state;
  let next = replacePlayer(state, { ...victim, lives: victim.lives - amount });
  const updatedVictim = playerById(next, victimId)!;
  if (updatedVictim.character.name === 'Bart Cassidy') {
    const draw = drawCards(next, amount);
    next = replacePlayer(draw.state, { ...updatedVictim, hand: [...updatedVictim.hand, ...draw.cards] });
  }
  if (attackerId && updatedVictim.character.name === 'El Gringo') {
    const attacker = playerById(next, attackerId);
    const gringo = playerById(next, victimId);
    if (attacker && gringo) {
      const stolen = attacker.hand.slice(0, amount);
      next = replacePlayer(next, { ...attacker, hand: attacker.hand.slice(stolen.length) });
      next = replacePlayer(next, { ...gringo, hand: [...gringo.hand, ...stolen] });
    }
  }
  if ((playerById(next, victimId)?.lives ?? 0) <= 0) next = eliminatePlayer(next, victimId, attackerId);
  if (attackerId) next = checkSuzy(next, attackerId);
  return next;
};

export const nextLivingPlayerId = (state: GameState, playerId: string): string => {
  const ordered = [...state.players].sort((a, b) => a.seat - b.seat);
  const index = ordered.findIndex((player) => player.id === playerId);
  for (let offset = 1; offset <= ordered.length; offset += 1) {
    const candidate = ordered[(index + offset) % ordered.length];
    if (candidate?.alive) return candidate.id;
  }
  return playerId;
};

export const discardFromHand = (state: GameState, playerId: string, cardIds: readonly string[]): GameState => {
  const player = playerById(state, playerId);
  if (!player) return state;
  const selected = new Set(cardIds);
  const discarded = player.hand.filter((card) => selected.has(card.id));
  const next = replacePlayer(state, { ...player, hand: player.hand.filter((card) => !selected.has(card.id)) });
  return checkSuzy({ ...next, discard: [...next.discard, ...discarded] }, playerId);
};
