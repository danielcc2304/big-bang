import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CharacterMode, GameCommand, Room } from './types';
import { useLocalGame } from './hooks/useLocalGame';
import { useOnlineRoom } from './hooks/useOnlineRoom';
import { useOnlineDriver } from './hooks/useOnlineDriver';
import { GameBoard } from './components/GameBoard';
import { isFirebaseConfigured } from './firebase/client';
import { createRoom, endOnlineRoom, enqueueCommand, joinRoom, reconnectToRoom, startOnlineGame, type RoomIdentity } from './multiplayer/roomService';
import { loadReconnectToken } from './multiplayer/identity';
import { sound } from './utils/sound';
import wantedFriend from './assets/wanted-friend.jpg';

interface LocalConfig { readonly name: string; readonly count: 4 | 5 | 6 | 7; readonly seed: number }

const LocalSession = ({ config, onExit }: { readonly config: LocalConfig; readonly onExit: () => void }) => {
  const setups = useMemo(() => Array.from({ length: config.count }, (_, index) => ({ id: index === 0 ? 'you' : `bot-${index}`, name: index === 0 ? config.name : ['Coyote', 'Maverick', 'Sombra', 'Ruby', 'Doc', 'Rattler'][index - 1]!, kind: index === 0 ? 'HUMAN' as const : 'AI' as const })), [config]);
  const game = useLocalGame(setups, config.seed);
  return <GameBoard state={game.state} viewerId="you" error={game.error} dispatch={game.dispatch} onExit={onExit} />;
};

const OnlineLobby = ({ room, identity, error, onStart, onExit }: { readonly room: Room; readonly identity: RoomIdentity; readonly error: string | null; readonly onStart: () => void; readonly onExit: () => void }) => {
  const isHost = room.hostUid === identity.uid;
  const invite = `${location.origin}${location.pathname}?room=${room.code}`;
  return <main className="lobby-screen"><header className="lobby-header"><button className="brand-button" onClick={onExit}><b>BANG!</b><span>SALOON ONLINE</span></button><span className="online-status"><i /> CONECTADO</span></header><section className="lobby-content"><span className="eyebrow">SALA ONLINE</span><h1>Reúne a la cuadrilla</h1><p className="lobby-lede">Comparte el código. Las plazas libres se completarán con pistoleros de IA al comenzar.</p><p className="lobby-variant">Personajes: <b>{room.characterMode === 'DRAFT_TWO' ? 'cada jugador elige entre dos aleatorios' : 'reparto aleatorio oficial'}</b></p><div className="room-code"><span>{room.code}</span><button onClick={() => void navigator.clipboard.writeText(room.code)}>Copiar código</button><button onClick={() => void navigator.clipboard.writeText(invite)}>Copiar invitación</button></div><div className="seat-list">{Array.from({ length: room.maxPlayers }, (_, number) => { const seat = room.seats[number]; const player = seat ? room.players[seat.playerId] : null; return <div key={number} className={seat ? 'occupied' : ''}><span>0{number + 1}</span><b>{player?.displayName ?? 'Plaza libre'}</b><em>{seat ? (player?.connected ? 'En línea' : 'Reconectando') : 'IA al iniciar'}</em></div>; })}</div>{isHost ? <button className="primary-action lobby-start" onClick={onStart}>Empezar partida</button> : <p className="waiting-copy">Esperando a que el host inicie la partida…</p>}{error && <p className="form-error">{error}</p>}<details className="recovery-details"><summary>Clave de recuperación</summary><code>{identity.reconnectToken}</code><p>Guárdala si quieres recuperar tu asiento desde otro dispositivo.</p></details></section></main>;
};

const OnlineSession = ({ identity, onExit }: { readonly identity: RoomIdentity; readonly onExit: () => void }) => {
  const { room, connection } = useOnlineRoom(identity.code);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  useOnlineDriver(identity.code, room, identity.uid);
  const visibleError = error ?? connection.errors.at(-1) ?? null;
  const dispatch = useCallback((next: GameCommand): boolean => {
    void enqueueCommand(identity.code, next, identity.uid).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'No se pudo enviar la acción.'));
    return true;
  }, [identity.code, identity.uid]);
  if (!room) return <main className="loading-screen"><div className="brand-mark">BANG!</div><p>{connection.lastUpdateAt ? 'La sala ya no está disponible.' : 'Abriendo las puertas del saloon…'}</p>{connection.lastUpdateAt && <button className="primary-action" onClick={onExit}>Volver</button>}</main>;
  if (room.status === 'LOBBY') return <OnlineLobby room={room} identity={identity} error={visibleError} onExit={onExit} onStart={() => void startOnlineGame(room.code, identity.uid).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'No se pudo empezar.'))} />;
  if (room.status === 'ENDED' || !room.canonical) return <main className="loading-screen"><div className="brand-mark">PARTIDA FINALIZADA</div><button className="primary-action" onClick={onExit}>Volver</button></main>;
  if (!room.canonical.players.some((player) => player.id === identity.playerId)) return <main className="loading-screen"><div className="brand-mark">ASIENTO NO DISPONIBLE</div><p>Tu identidad ya no pertenece a esta partida. Vuelve a entrar con la clave de recuperación.</p><button className="primary-action" onClick={onExit}>Volver</button></main>;
  const canEnd = room.hostUid === identity.uid && room.coordinator.coordinatorId === identity.uid;
  return <><GameBoard state={room.canonical} viewerId={identity.playerId} error={visibleError} dispatch={dispatch} onExit={onExit} syncLabel={connection.connected ? 'ONLINE' : 'SIN CONEXIÓN'} />{canEnd && <button className="finish-online" onClick={() => setConfirmEnd(true)}>Finalizar partida online</button>}{confirmEnd && <div className="modal-backdrop"><section className="game-modal" role="dialog" aria-modal="true"><span className="eyebrow">FINALIZAR PARTIDA ONLINE</span><h2>¿Seguro que quieres finalizar la partida para todos?</h2><div className="modal-actions"><button onClick={() => setConfirmEnd(false)}>Cancelar</button><button className="danger-action" onClick={() => void endOnlineRoom(room.code, identity.uid).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'No se pudo finalizar.'))}>Sí, finalizar</button></div></section></div>}</>;
};

export default function App() {
  const [localConfig, setLocalConfig] = useState<LocalConfig | null>(null);
  const [identity, setIdentity] = useState<RoomIdentity | null>(null);
  const [name, setName] = useState(() => localStorage.getItem('bang:name') ?? 'Pistolero');
  const [count, setCount] = useState<4 | 5 | 6 | 7>(4);
  const [characterMode, setCharacterMode] = useState<CharacterMode>('DRAFT_TWO');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') ?? '');
  const [recovery, setRecovery] = useState('');
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [musicEnabled, setMusicEnabled] = useState(sound.enabled && sound.musicEnabled);
  const configured = isFirebaseConfigured();
  const onHome = !localConfig && !identity;
  useEffect(() => {
    if (!onHome) { sound.stopMusic(); return; }
    setMusicEnabled(sound.enabled && sound.musicEnabled);
    const startMusic = (): void => { if (sound.enabled && sound.musicEnabled) void sound.startMusic(); };
    window.addEventListener('pointerdown', startMusic, { once: true });
    return () => { window.removeEventListener('pointerdown', startMusic); sound.stopMusic(); };
  }, [onHome]);
  if (localConfig) return <LocalSession config={localConfig} onExit={() => setLocalConfig(null)} />;
  if (identity) return <OnlineSession identity={identity} onExit={() => setIdentity(null)} />;
  const remember = (): void => localStorage.setItem('bang:name', name);
  const runOnline = (work: Promise<RoomIdentity>): void => { setOnlineError(null); void work.then((next) => { remember(); sound.play('connect'); setIdentity(next); }).catch((cause: unknown) => { sound.play('error'); setOnlineError(cause instanceof Error ? cause.message : 'No se pudo conectar.'); }); };
  const recover = (): void => { const token = recovery || loadReconnectToken(code); if (!token) { setOnlineError('Introduce la clave de recuperación de ese asiento.'); return; } runOnline(reconnectToRoom(code, token)); };
  const toggleMusic = (): void => {
    const next = !musicEnabled;
    if (next && !sound.enabled) sound.setEnabled(true);
    sound.setMusicEnabled(next);
    setMusicEnabled(next);
  };
  return (
    <main className="home-screen">
      <div className="dust dust-one" /><div className="dust dust-two" />
      <header className="home-nav"><div className="brand-mark">BANG!<span>SALOON ONLINE</span></div><button className={`menu-music-button ${musicEnabled ? 'active' : ''}`} onClick={toggleMusic} aria-pressed={musicEnabled}>{musicEnabled ? '♪ MÚSICA' : '×♪ SILENCIO'}</button><div className={`firebase-badge ${configured ? '' : 'offline'}`}><i />{configured ? 'ONLINE LISTO' : 'FIREBASE PENDIENTE'}</div></header>
      <section className="home-hero"><div className="hero-copy"><span className="eyebrow">EL JUEGO BASE · 4–7 JUGADORES</span><h1>La ley llega<br />al navegador.</h1><p>Roles secretos, duelos y traiciones en una mesa construida para sobrevivir incluso cuando alguien pierde la conexión.</p><div className="mode-tabs"><button className="active">PARTIDA LOCAL</button><a href="#online">SALA ONLINE</a></div><div className="setup-line"><label>Tu nombre<input value={name} maxLength={18} onChange={(event) => setName(event.target.value)} /></label><label>Jugadores<select value={count} onChange={(event) => setCount(Number(event.target.value) as 4 | 5 | 6 | 7)}><option>4</option><option>5</option><option>6</option><option>7</option></select></label></div><button className="hero-action" onClick={() => { remember(); window.scrollTo({ top: 0 }); setLocalConfig({ name: name.trim() || 'Pistolero', count, seed: Date.now() }); }}><span>Entrar al saloon</span><i>→</i></button><small>Juegas contra IA. Personajes y roles se barajan en cada partida.</small></div><div className="hero-visual" aria-hidden="true"><div className="sun-disc" /><div className="saloon-silhouette"><span>SALOON</span></div><div className="wanted-card"><b>WANTED</b><div className="wanted-portrait"><img src={wantedFriend} alt="" /></div><span>DEAD OR ALIVE</span></div></div></section>
      <section className="online-section" id="online"><div><span className="eyebrow">MULTIJUGADOR ROBUSTO</span><h2>Una sala. Una verdad.</h2><p>Junta a la cuadrilla, reparte sospechas y culpa al Wi-Fi cuando te disparen. Si alguien se cae, el saloon guarda el turno y la traición continúa.</p></div><div className="online-form"><label>Nombre<input value={name} maxLength={18} onChange={(event) => setName(event.target.value)} /></label><label>Variante de personajes<select value={characterMode} onChange={(event) => setCharacterMode(event.target.value as CharacterMode)}><option value="DRAFT_TWO">Elegir entre dos aleatorios</option><option value="OFFICIAL">Un personaje aleatorio</option></select></label><div className="online-actions"><button disabled={!configured} onClick={() => runOnline(createRoom(name.trim() || 'Pistolero', count, characterMode))}>Crear sala</button><span>o</span><input aria-label="Código de sala" placeholder="CÓDIGO" value={code} maxLength={6} onChange={(event) => setCode(event.target.value.toUpperCase())} /><button disabled={!configured || code.length < 4} onClick={() => runOnline(joinRoom(code, name.trim() || 'Pistolero'))}>Unirme</button></div><details><summary>Reconectar a un asiento</summary><input placeholder="Clave de recuperación (opcional en este dispositivo)" value={recovery} onChange={(event) => setRecovery(event.target.value)} /><button disabled={!configured || code.length < 4} onClick={recover}>Reconectar</button></details>{onlineError && <p className="form-error">{onlineError}</p>}{!configured && <p className="firebase-help">Copia <code>.env.example</code> a <code>.env.local</code> y completa las variables de Firebase para activar salas online.</p>}</div></section>
      <footer className="home-footer"><span>Motor determinista · IA sin acceso a roles secretos · Firebase RTDB</span><span>HECHO PARA MÓVIL Y ESCRITORIO</span></footer>
    </main>
  );
}
