import packageMetadata from '../../package.json';

interface ReleaseNotes {
  readonly version: string;
  readonly changes: readonly string[];
}

export const APP_VERSION = packageMetadata.version;

export const RELEASE_NOTES: readonly ReleaseNotes[] = [
  {
    version: '1.1.1',
    changes: [
      'Las salas online aceptan correctamente el formato de asientos que devuelve Firebase y ya no muestran el error de colecciones principales.',
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
      'Modo local contra IA y salas online con Firebase.',
      'Motor determinista por comandos, roles secretos y reglas del juego base.',
      'Reconexión de jugadores y mesa adaptada a móvil y escritorio.',
    ],
  },
];
