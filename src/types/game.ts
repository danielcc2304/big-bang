export type Role = 'SHERIFF' | 'DEPUTY' | 'OUTLAW' | 'RENEGADE';
export type Suit = 'SPADES' | 'HEARTS' | 'DIAMONDS' | 'CLUBS';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export type CardName =
  | 'BANG' | 'MISSED' | 'BEER' | 'SALOON' | 'STAGECOACH' | 'WELLS_FARGO'
  | 'PANIC' | 'CAT_BALOU' | 'INDIANS' | 'GATLING' | 'DUEL' | 'GENERAL_STORE'
  | 'JAIL' | 'DYNAMITE' | 'BARREL' | 'MUSTANG' | 'SCOPE'
  | 'VOLCANIC' | 'SCHOFIELD' | 'REMINGTON' | 'REV_CARABINE' | 'WINCHESTER';

export type CardKind = 'BROWN' | 'BLUE' | 'WEAPON';

export interface Card {
  readonly id: string;
  readonly name: CardName;
  readonly kind: CardKind;
  readonly suit: Suit;
  readonly rank: Rank;
}

export type CharacterName =
  | 'Bart Cassidy' | 'Black Jack' | 'Calamity Janet' | 'El Gringo'
  | 'Jesse Jones' | 'Jourdonnais' | 'Kit Carlson' | 'Lucky Duke'
  | 'Paul Regret' | 'Pedro Ramirez' | 'Rose Doolan' | 'Sid Ketchum'
  | 'Slab the Killer' | 'Suzy Lafayette' | 'Vulture Sam' | 'Willy the Kid';

export interface Character {
  readonly name: CharacterName;
  readonly lives: 3 | 4;
  readonly ability: string;
}

export interface CharacterDraftState {
  readonly optionsByPlayer: Readonly<Record<string, readonly [CharacterName, CharacterName]>>;
  readonly chosenByPlayer: Readonly<Record<string, CharacterName>>;
}

export interface Equipment {
  readonly weapon: Card | null;
  readonly barrel: Card | null;
  readonly mustang: Card | null;
  readonly scope: Card | null;
  readonly jail: Card | null;
  readonly dynamite: Card | null;
}

export interface Player {
  readonly id: string;
  readonly seat: number;
  readonly name: string;
  readonly kind: 'HUMAN' | 'AI';
  readonly role: Role;
  readonly character: Character;
  readonly lifeMarkerCharacter: Character | null;
  readonly lives: number;
  readonly maxLives: number;
  readonly alive: boolean;
  readonly hand: readonly Card[];
  readonly equipment: Equipment;
  readonly bangsPlayedThisTurn: number;
}

export type GamePhase =
  | 'CHARACTER_CHOICE' | 'TURN_START' | 'DRAW' | 'PLAY' | 'DISCARD'
  | 'WAITING_REACTION' | 'STORE' | 'MULTI_ACTION' | 'GAME_OVER';

export type ReactionType = 'BANG' | 'INDIANS' | 'DUEL' | 'GATLING';

export interface Reaction {
  readonly id: string;
  readonly type: ReactionType;
  readonly sourcePlayerId: string;
  readonly targetPlayerId: string;
  readonly requiredCards: number;
  readonly cardsPlayed: number;
  readonly createdAt: number;
}

export interface StoreState {
  readonly id: string;
  readonly cards: readonly Card[];
  readonly order: readonly string[];
  readonly currentIndex: number;
  readonly currentPlayerId: string;
  readonly pickedBy: Readonly<Record<string, string>>;
}

export interface MultiActionState {
  readonly id: string;
  readonly type: 'GATLING' | 'INDIANS';
  readonly sourcePlayerId: string;
  readonly targets: readonly string[];
  readonly currentTargetIndex: number;
}

export interface TurnState {
  readonly number: number;
  readonly currentPlayerId: string;
  readonly phase: GamePhase;
  readonly pendingDiscardCount: number;
}

export interface GameLogEntry {
  readonly id: string;
  readonly revision: number;
  readonly message: string;
  readonly tone: 'NORMAL' | 'ACTION' | 'DANGER' | 'SYSTEM';
}

export type Winner = 'LAW' | 'OUTLAWS' | 'RENEGADE';

export interface GameState {
  readonly gameId: string;
  readonly seed: number;
  readonly revision: number;
  readonly players: readonly Player[];
  readonly deck: readonly Card[];
  readonly discard: readonly Card[];
  readonly turn: TurnState;
  readonly reaction: Reaction | null;
  readonly storeState: StoreState | null;
  readonly multiAction: MultiActionState | null;
  readonly characterDraft: CharacterDraftState | null;
  readonly processedCommandIds: readonly string[];
  readonly logs: readonly GameLogEntry[];
  readonly winner: Winner | null;
}

interface CommandBase {
  readonly commandId: string;
  readonly playerId: string;
  readonly expectedRevision: number;
  readonly createdAt: number;
}

export type GameCommand =
  | (CommandBase & { readonly type: 'PLAY_CARD'; readonly payload: { readonly cardId: string; readonly targetPlayerId?: string; readonly targetCardId?: string; readonly targetCardChoice?: 'RANDOM_HAND' } })
  | (CommandBase & { readonly type: 'DRAW_CARDS'; readonly payload: { readonly firstCardSource?: 'DECK' | 'DISCARD' } })
  | (CommandBase & { readonly type: 'SELECT_TARGET'; readonly payload: { readonly targetPlayerId: string } })
  | (CommandBase & { readonly type: 'END_TURN'; readonly payload: Record<string, never> })
  | (CommandBase & { readonly type: 'DISCARD_CARDS'; readonly payload: { readonly cardIds: readonly string[] } })
  | (CommandBase & { readonly type: 'REACTION'; readonly payload: { readonly cardIds: readonly string[] } })
  | (CommandBase & { readonly type: 'STORE_PICK'; readonly payload: { readonly cardId: string } })
  | (CommandBase & { readonly type: 'CHARACTER_CHOICE'; readonly payload: { readonly characterName: CharacterName } })
  | (CommandBase & { readonly type: 'USE_CHARACTER_ABILITY'; readonly payload: { readonly cardIds?: readonly string[]; readonly targetPlayerId?: string } })
  | (CommandBase & { readonly type: 'RESOLVE_TURN_START'; readonly payload: Record<string, never> });

export interface CommandSuccess {
  readonly ok: true;
  readonly state: GameState;
}

export interface CommandFailure {
  readonly ok: false;
  readonly state: GameState;
  readonly error: { readonly code: string; readonly message: string };
}

export type CommandResult = CommandSuccess | CommandFailure;
