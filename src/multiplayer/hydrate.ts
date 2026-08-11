import type { CharacterDraftState, Equipment, GameState, Player, Room, Seat, StoreState } from '../types';

const emptyEquipment = (): Equipment => ({
  weapon: null,
  barrel: null,
  mustang: null,
  scope: null,
  jail: null,
  dynamite: null,
});

const hydratePlayer = (player: Player): Player => ({
  ...player,
  lifeMarkerCharacter: player.lifeMarkerCharacter ?? null,
  hand: player.hand ?? [],
  equipment: { ...emptyEquipment(), ...(player.equipment ?? {}) },
});

const hydrateStoreState = (storeState: StoreState | null | undefined): StoreState | null => storeState ? ({
  ...storeState,
  cards: storeState.cards ?? [],
  order: storeState.order ?? [],
  pickedBy: storeState.pickedBy ?? {},
}) : null;

const hydrateCharacterDraft = (draft: CharacterDraftState | null | undefined): CharacterDraftState | null => draft ? ({
  ...draft,
  optionsByPlayer: draft.optionsByPlayer ?? {},
  chosenByPlayer: draft.chosenByPlayer ?? {},
}) : null;

export const hydrateGameState = (state: GameState): GameState => ({
  ...state,
  players: (state.players ?? []).map(hydratePlayer),
  deck: state.deck ?? [],
  discard: state.discard ?? [],
  reaction: state.reaction ?? null,
  storeState: hydrateStoreState(state.storeState),
  multiAction: state.multiAction ?? null,
  characterDraft: hydrateCharacterDraft(state.characterDraft),
  processedCommandIds: state.processedCommandIds ?? [],
  logs: state.logs ?? [],
  winner: state.winner ?? null,
});

const hydrateSeat = (seat: Seat): Seat => ({
  ...seat,
  ownerUid: seat.ownerUid ?? null,
  reconnectHash: seat.reconnectHash ?? null,
});

export const hydrateRoom = (room: Room): Room => ({
  ...room,
  seats: Object.fromEntries(Object.entries(room.seats ?? {}).map(([key, seat]) => [key, hydrateSeat(seat)])),
  players: room.players ?? {},
  canonical: room.canonical ? hydrateGameState(room.canonical) : null,
  commands: room.commands ?? {},
});
