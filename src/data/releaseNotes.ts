import packageMetadata from '../../package.json';

interface ReleaseNotes {
  readonly version: string;
  readonly changes: readonly string[];
}

export const APP_VERSION = packageMetadata.version;

export const RELEASE_NOTES: readonly ReleaseNotes[] = [
  {
    version: '1.2.3',
    changes: [
      'El Barril resuelve sus juicios contra el estado canónico actual, también después de hidratar una partida online.',
      'Los fallos de juicio del Barril quedan registrados y mantienen correctamente la reacción de ¡Fallaste! cuando corresponde.',
    ],
  },
  {
    version: '1.2.2',
    changes: [
      'Al terminar la partida, una pantalla de victoria animada revela el bando, personaje y estado final de cada jugador.',
      'Sid Ketchum permite elegir exactamente las dos cartas que descarta para recuperar una vida.',
      'La IA mejora sus objetivos por equipo, respeta el alcance y evita jugadas ilegales o mejoras de equipo peores.',
    ],
  },
  {
    version: '1.2.1',
    changes: [
      'Los avisos de acción de la mesa desaparecen automáticamente tras unos segundos, también mientras la partida online recibe actualizaciones en tiempo real.',
    ],
  },
  {
    version: '1.2.0',
    changes: [
      'El multijugador deja Firebase y pasa a Supabase Auth anónimo, PostgreSQL y Realtime con snapshots completos y reconciliación segura.',
      'Salas, presencia, reconexión, leases del coordinador, cola de comandos y recibos se procesan con RPCs atómicas, RLS y control de versiones.',
      'La migración incluye validación de permisos, límites de cola, idempotencia y recuperación de asientos sin exponer secretos al navegador.',
    ],
  },
  {
    version: '1.1.2',
    changes: [
      'Kit Carlson y Jesse Jones ya permiten elegir el robo correctamente; las habilidades de Lucky Duke, Suzy Lafayette, El Gringo y Sid Ketchum quedan cubiertas por el motor.',
      'La IA usa objetivos por equipo y sospechas públicas, evita el túnel permanente al Sheriff y mantiene partidas competitivas sin leer roles secretos.',
      'El Almacén y los robos se recuperan de mazos agotados sin dejar la partida bloqueada.',
    ],
  },
  {
    version: '1.1.1',
    changes: [
      'Las salas online aceptan correctamente el formato de asientos que devuelve Supabase y ya no muestran el error de colecciones principales.',
    ],
  },
  {
    version: '1.1.0',
    changes: [
      'Elección simultánea de personaje en online y selección entre dos pistoleros en local.',
      'Partidas online más robustas ante reconexiones, reacciones, Almacén y cambios de coordinador.',
      'Habilidades públicas, Sheriff destacado y objetivo del rol propio siempre visible.',
      'Mejoras de IA, ritmo de turnos, Barril y habilidades como la de Pedro Ramírez.',
      'Cartas en español, nuevos iconos y nombre visible en la pila de descartes.',
      'Portada responsive con música del oeste, controles de sonido y cartel personalizado.',
    ],
  },
  {
    version: '1.0.0',
    changes: [
      'Primera versión jugable del saloon para 4–7 jugadores.',
      'Modo local contra IA y salas online con Supabase Realtime.',
      'Motor determinista por comandos, roles secretos y reglas del juego base.',
      'Reconexión de jugadores y mesa adaptada a móvil y escritorio.',
    ],
  },
];
