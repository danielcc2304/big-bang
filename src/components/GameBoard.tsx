import { useEffect, useMemo, useState } from 'react';
import type { Card, GameCommand, GameState, Player } from '../types';
import { command } from '../game/engine';
import { CARD_CATALOG } from '../game/cards/catalog';
import { distanceBetween } from '../game/rules/distance';
import { sound } from '../utils/sound';
import { CardView } from './CardView';
import { PlayerPanel } from './PlayerPanel';

interface GameBoardProps {
  readonly state: GameState;
  readonly viewerId: string;
  readonly error: string | null;
  readonly dispatch: (command: GameCommand) => boolean;
  readonly onExit: () => void;
  readonly syncLabel?: string;
}

const TARGET_CARDS = new Set(['BANG', 'PANIC', 'CAT_BALOU', 'DUEL', 'JAIL']);

export const GameBoard = ({ state, viewerId, error, dispatch, onExit, syncLabel = 'LOCAL' }: GameBoardProps) => {
  const viewer = state.players.find((player) => player.id === viewerId)!;
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [inspected, setInspected] = useState<Player | null>(null);
  const [reactionCards, setReactionCards] = useState<readonly string[]>([]);
  const [keepCards, setKeepCards] = useState<readonly string[]>([]);
  const [debug, setDebug] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(sound.enabled);
  const selectedCard = viewer.hand.find((card) => card.id === selectedCardId);
  const topDiscard = state.discard.at(-1);
  const topDiscardDefinition = topDiscard ? CARD_CATALOG[topDiscard.name] : null;
  const isHumanTurn = state.turn.currentPlayerId === viewerId && viewer.alive;
  const canPlay = isHumanTurn && state.turn.phase === 'PLAY' && !state.reaction && !state.storeState;

  useEffect(() => { setReactionCards([]); }, [state.reaction?.id]);
  useEffect(() => { if (state.turn.phase !== 'DISCARD') setKeepCards([]); }, [state.turn.phase]);
  useEffect(() => {
    if (state.turn.currentPlayerId === viewerId && state.turn.phase === 'TURN_START') dispatch(command(state, viewerId, 'RESOLVE_TURN_START', {}));
    else if (state.turn.currentPlayerId === viewerId && state.turn.phase === 'DRAW') dispatch(command(state, viewerId, 'DRAW_CARDS', {}));
  }, [dispatch, state, viewerId]);

  const opponents = useMemo(() => state.players.filter((player) => player.id !== viewerId), [state.players, viewerId]);

  const playCard = (card: Card): void => {
    if (!canPlay) return;
    if (TARGET_CARDS.has(card.name) || card.name === 'MISSED' && viewer.character.name === 'Calamity Janet') setSelectedCardId(card.id);
    else {
      dispatch(command(state, viewerId, 'PLAY_CARD', { cardId: card.id }));
      setSelectedCardId(null);
      sound.play(card.kind === 'BROWN' ? 'select' : 'equip');
    }
  };

  const targetPlayer = (target: Player): void => {
    if (!selectedCard) return;
    const publicCard = Object.values(target.equipment).find((card): card is Card => card !== null);
    const payload = { cardId: selectedCard.id, targetPlayerId: target.id, ...(publicCard && (selectedCard.name === 'PANIC' || selectedCard.name === 'CAT_BALOU') ? { targetCardId: publicCard.id } : {}) };
    if (dispatch(command(state, viewerId, 'PLAY_CARD', payload))) {
      sound.play(selectedCard.name === 'BANG' ? 'bang' : 'select');
      setSelectedCardId(null);
    }
  };

  const toggleReaction = (cardId: string): void => setReactionCards((current) => current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId]);
  const resolveReaction = (cardIds: readonly string[]): void => {
    dispatch(command(state, viewerId, 'REACTION', { cardIds }));
    sound.play(cardIds.length > 0 ? 'missed' : 'damage');
  };

  const endTurn = (): void => { dispatch(command(state, viewerId, 'END_TURN', {})); setSelectedCardId(null); };
  const toggleKeep = (cardId: string): void => setKeepCards((current) => current.includes(cardId) ? current.filter((id) => id !== cardId) : current.length < viewer.lives ? [...current, cardId] : current);
  const confirmKeep = (): void => {
    const discards = viewer.hand.filter((card) => !keepCards.includes(card.id)).map((card) => card.id);
    dispatch(command(state, viewerId, 'DISCARD_CARDS', { cardIds: discards }));
  };

  const status = state.winner ? 'Partida terminada' : state.reaction ? `${state.players.find((p) => p.id === state.reaction?.targetPlayerId)?.name ?? ''} debe responder` : state.storeState ? `Almacén: elige ${state.players.find((p) => p.id === state.storeState?.currentPlayerId)?.name ?? ''}` : `${state.players.find((p) => p.id === state.turn.currentPlayerId)?.name ?? ''} · ${state.turn.phase}`;

  return (
    <main className="game-shell">
      <header className="game-topbar">
        <button className="brand-button" onClick={onExit}><b>BANG!</b><span>SALOON ONLINE</span></button>
        <div className="sync-strip"><i className={`sync-dot ${syncLabel === 'LOCAL' ? 'local' : ''}`} /> {syncLabel} <span>r{state.revision}</span></div>
        <nav>
          <button className="icon-button" onClick={() => { sound.setEnabled(!soundEnabled); setSoundEnabled(!soundEnabled); }} aria-label="Alternar sonido">{soundEnabled ? '♪' : '×♪'}</button>
          <button className="icon-button" onClick={() => setDebug(!debug)} aria-label="Panel de depuración">···</button>
        </nav>
      </header>

      <section className="turn-banner"><span>{status}</span><em>Turno {state.turn.number}</em></section>
      {error && <div className="error-toast" role="alert">{error}</div>}

      <section className="saloon-table" aria-label="Mesa de juego">
        <div className="table-brand" aria-hidden="true">SALOON<span>EST. 1876</span></div>
        <div className="opponent-grid">
          {opponents.map((player) => <PlayerPanel key={player.id} player={player} state={state} viewerId={viewerId} targetable={Boolean(selectedCard && player.alive)} onSelect={() => targetPlayer(player)} onInspect={() => setInspected(player)} />)}
        </div>
        <div className="table-center">
          <div className="deck-pile"><span>✦</span><small>{state.deck.length}</small></div>
          <div className="phase-seal"><b>{state.turn.phase.replaceAll('_', ' ')}</b><span>REVISIÓN {state.revision}</span></div>
          <div className="discard-pile" aria-label={topDiscardDefinition ? `Último descarte: ${topDiscardDefinition.label}` : 'Pila de descartes vacía'}><strong>{topDiscardDefinition?.label ?? 'Descarte'}</strong><span aria-hidden="true">{topDiscardDefinition?.icon ?? '○'}</span><small>{state.discard.length}</small></div>
        </div>
        <div className="viewer-panel">
          <PlayerPanel player={viewer} state={state} viewerId={viewerId} targetable={false} onSelect={() => undefined} onInspect={() => setInspected(viewer)} />
        </div>
      </section>

      <section className="hand-section">
        <div className="hand-heading"><span>TU MANO</span><small>Desliza ↔ para recorrer · ↕ dentro de una carta para leer</small></div>
        <div className="card-rail" data-testid="hand">
          {viewer.hand.map((card) => <CardView key={card.id} card={card} selected={selectedCardId === card.id} disabled={!canPlay} onClick={() => playCard(card)} />)}
        </div>
      </section>

      <footer className="action-dock">
        <button className="secondary-action" onClick={() => setInspected(viewer)}>Tu ficha</button>
        {viewer.character.name === 'Sid Ketchum' && <button className="secondary-action" disabled={!canPlay || viewer.hand.length < 2 || viewer.lives >= viewer.maxLives} onClick={() => dispatch(command(state, viewerId, 'USE_CHARACTER_ABILITY', { cardIds: viewer.hand.slice(0, 2).map((card) => card.id) }))}>Curar</button>}
        <button className="primary-action" disabled={!canPlay} onClick={endTurn}>Terminar turno</button>
      </footer>

      <aside className="history-panel"><h2>Últimos movimientos</h2>{state.logs.slice(-8).reverse().map((entry) => <p key={entry.id} data-tone={entry.tone}>{entry.message}</p>)}</aside>

      {state.reaction?.targetPlayerId === viewerId && (
        <div className="modal-backdrop"><section className="game-modal" role="dialog" aria-modal="true"><span className="eyebrow">REACCIÓN</span><h2>{state.reaction.type}</h2><p>Necesitas {state.reaction.requiredCards - state.reaction.cardsPlayed} carta(s) válida(s).</p><div className="card-rail modal-rail">{viewer.hand.filter((card) => state.reaction?.type === 'INDIANS' || state.reaction?.type === 'DUEL' ? card.name === 'BANG' || viewer.character.name === 'Calamity Janet' && card.name === 'MISSED' : card.name === 'MISSED' || viewer.character.name === 'Calamity Janet' && card.name === 'BANG').map((card) => <CardView key={card.id} card={card} selected={reactionCards.includes(card.id)} onClick={() => toggleReaction(card.id)} />)}</div><div className="modal-actions"><button onClick={() => resolveReaction([])}>Recibir daño</button><button className="primary-action" disabled={reactionCards.length < state.reaction.requiredCards - state.reaction.cardsPlayed} onClick={() => resolveReaction(reactionCards)}>Responder</button></div></section></div>
      )}

      {state.storeState?.currentPlayerId === viewerId && (
        <div className="modal-backdrop"><section className="game-modal wide" role="dialog" aria-modal="true"><span className="eyebrow">ALMACÉN</span><h2>Elige una carta</h2><p>La elección se aplica una sola vez y la carta desaparece del escaparate al instante.</p><div className="card-rail modal-rail">{state.storeState.cards.map((card) => <CardView key={card.id} card={card} onClick={() => { dispatch(command(state, viewerId, 'STORE_PICK', { cardId: card.id })); sound.play('store'); }} />)}</div></section></div>
      )}

      {state.turn.phase === 'DISCARD' && state.turn.currentPlayerId === viewerId && (
        <div className="modal-backdrop"><section className="game-modal wide" role="dialog" aria-modal="true"><span className="eyebrow">FIN DEL TURNO</span><h2>Elige {viewer.lives} cartas para conservar</h2><p>Has seleccionado {keepCards.length} de {viewer.lives}. Las demás se descartarán al confirmar.</p><div className="card-rail modal-rail">{viewer.hand.map((card) => <CardView key={card.id} card={card} selected={keepCards.includes(card.id)} onClick={() => toggleKeep(card.id)} />)}</div><div className="modal-actions"><button className="primary-action" disabled={keepCards.length !== viewer.lives} onClick={confirmKeep}>Conservar estas cartas</button></div></section></div>
      )}

      {inspected && <div className="drawer-backdrop" onClick={() => setInspected(null)}><aside className="player-drawer" onClick={(event) => event.stopPropagation()}><button className="drawer-close" onClick={() => setInspected(null)}>×</button><span className="eyebrow">FICHA DE JUGADOR</span><h2>{inspected.name}</h2><h3>{inspected.character.name}</h3><p className="ability-copy">{inspected.character.ability}</p><dl><div><dt>Vidas</dt><dd>{inspected.lives}/{inspected.maxLives}</dd></div><div><dt>Mano</dt><dd>{inspected.hand.length}</dd></div><div><dt>Distancia</dt><dd>{distanceBetween(state, viewerId, inspected.id)}</dd></div></dl><h4>Equipo público</h4><p>{Object.values(inspected.equipment).filter((card): card is Card => card !== null).map((card) => CARD_CATALOG[card.name].label).join(' · ') || 'Sin cartas en juego'}</p></aside></div>}

      {state.winner && <div className="modal-backdrop"><section className="game-modal victory"><span className="eyebrow">PARTIDA TERMINADA</span><h2>{state.winner === 'LAW' ? 'La ley prevalece' : state.winner === 'OUTLAWS' ? 'Los Forajidos toman el pueblo' : 'El Renegado queda en pie'}</h2><button className="primary-action" onClick={onExit}>Volver al saloon</button></section></div>}

      {debug && <aside className="debug-panel"><button onClick={() => setDebug(false)}>×</button><b>DEBUG MULTIPLAYER</b><span>local revision: {state.revision}</span><span>server revision: —</span><span>coordinator: local</span><span>epoch: 0</span><span>phase: {state.turn.phase}</span><span>waitingFor: {state.reaction?.targetPlayerId ?? state.storeState?.currentPlayerId ?? '—'}</span><span>command queue: 0</span><span>último error: {error ?? '—'}</span></aside>}
    </main>
  );
};
