import type { Card, GameState } from '../../types';

export const collectCards = (state: GameState): readonly Card[] => [
  ...state.deck,
  ...state.discard,
  ...(state.storeState?.cards ?? []),
  ...state.players.flatMap((player) => [
    ...player.hand,
    player.equipment.weapon,
    player.equipment.barrel,
    player.equipment.mustang,
    player.equipment.scope,
    player.equipment.jail,
    player.equipment.dynamite,
  ].filter((card): card is Card => card !== null)),
];

export const validateGameState = (state: GameState): readonly string[] => {
  const errors: string[] = [];
  const ids = collectCards(state).map((card) => card.id);
  if (new Set(ids).size !== ids.length) {
    const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    const locate = (id: string): string[] => {
      const locations: string[] = [];
      if (state.deck.some((card) => card.id === id)) locations.push('mazo');
      if (state.discard.some((card) => card.id === id)) locations.push('descarte');
      if (state.storeState?.cards.some((card) => card.id === id)) locations.push('almacén');
      state.players.forEach((player) => {
        if (player.hand.some((card) => card.id === id)) locations.push(`mano:${player.id}`);
        (Object.entries(player.equipment) as [string, Card | null][]).forEach(([field, card]) => { if (card?.id === id) locations.push(`${field}:${player.id}`); });
      });
      return locations;
    };
    errors.push(`Una misma carta existe en más de una ubicación: ${duplicates.map((id) => `${id} [${locate(id).join(' / ')}]`).join(', ')}.`);
  }
  const current = state.players.find((player) => player.id === state.turn.currentPlayerId);
  if (!current) errors.push('El jugador actual no existe.');
  else if (!current.alive && state.turn.phase !== 'GAME_OVER') errors.push(`Un jugador eliminado no puede tener el turno: ${current.id} en fase ${state.turn.phase}.`);
  state.players.forEach((player) => {
    if (player.lives > player.maxLives) errors.push(`${player.name} supera sus vidas máximas.`);
    if (player.lives < 0) errors.push(`${player.name} tiene vidas negativas.`);
  });
  if (state.storeState) {
    const picked = Object.values(state.storeState.pickedBy);
    if (new Set(picked).size !== picked.length) errors.push('Almacén ha entregado una carta dos veces.');
    if (state.storeState.order[state.storeState.currentIndex] !== state.storeState.currentPlayerId) errors.push('El turno de Almacén no coincide con su índice.');
  }
  return errors;
};

export const assertGameState = (state: GameState): void => {
  const errors = validateGameState(state);
  if (errors.length > 0) throw new Error(errors.join(' '));
};
