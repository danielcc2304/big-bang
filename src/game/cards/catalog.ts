import type { CardKind, CardName } from '../../types';

export interface CardDefinition {
  readonly name: CardName;
  readonly label: string;
  readonly kind: CardKind;
  readonly icon: string;
  readonly description: string;
  readonly range?: number;
}

export const CARD_CATALOG: Readonly<Record<CardName, CardDefinition>> = {
  BANG: { name: 'BANG', label: 'BANG!', kind: 'BROWN', icon: '✦', description: 'Dispara a un jugador dentro del alcance de tu arma.' },
  MISSED: { name: 'MISSED', label: '¡Fallaste!', kind: 'BROWN', icon: '◌', description: 'Evita un BANG! recibido.' },
  BEER: { name: 'BEER', label: 'Cerveza', kind: 'BROWN', icon: '♨', description: 'Recupera una vida. No funciona cuando solo quedan dos jugadores.' },
  SALOON: { name: 'SALOON', label: 'Saloon', kind: 'BROWN', icon: '♨', description: 'Todos los jugadores vivos recuperan una vida.' },
  STAGECOACH: { name: 'STAGECOACH', label: 'Diligencia', kind: 'BROWN', icon: '↠', description: 'Roba dos cartas.' },
  WELLS_FARGO: { name: 'WELLS_FARGO', label: 'Wells Fargo', kind: 'BROWN', icon: '↠', description: 'Roba tres cartas.' },
  PANIC: { name: 'PANIC', label: 'Pánico', kind: 'BROWN', icon: '⌁', description: 'Roba una carta de un jugador a distancia 1.' },
  CAT_BALOU: { name: 'CAT_BALOU', label: 'Cat Balou', kind: 'BROWN', icon: '×', description: 'Descarta una carta de cualquier jugador.' },
  INDIANS: { name: 'INDIANS', label: 'Indios', kind: 'BROWN', icon: '⇶', description: 'Los demás descartan un BANG! o pierden una vida.' },
  GATLING: { name: 'GATLING', label: 'Gatling', kind: 'BROWN', icon: '✺', description: 'Los demás juegan Fallaste! o pierden una vida.' },
  DUEL: { name: 'DUEL', label: 'Duelo', kind: 'BROWN', icon: '⚔', description: 'Alternad BANG!; quien no responda pierde una vida.' },
  GENERAL_STORE: { name: 'GENERAL_STORE', label: 'Almacén', kind: 'BROWN', icon: '▦', description: 'Revela una carta por jugador vivo y elegid por turno.' },
  JAIL: { name: 'JAIL', label: 'Prisión', kind: 'BLUE', icon: '⌗', description: 'El objetivo desenfunda al comenzar su turno; con corazones escapa.' },
  DYNAMITE: { name: 'DYNAMITE', label: 'Dinamita', kind: 'BLUE', icon: '✹', description: 'Picas 2–9 causa tres daños; si no, pasa al siguiente jugador.' },
  BARREL: { name: 'BARREL', label: 'Barril', kind: 'BLUE', icon: '◉', description: 'Antes de responder a BANG!, corazones cuenta como un Fallaste!.' },
  MUSTANG: { name: 'MUSTANG', label: 'Mustang', kind: 'BLUE', icon: '♞', description: 'Aumenta en uno la distancia a la que te ven.' },
  SCOPE: { name: 'SCOPE', label: 'Appaloosa', kind: 'BLUE', icon: '⌖', description: 'Reduce en uno la distancia a la que ves a los demás.' },
  VOLCANIC: { name: 'VOLCANIC', label: 'Volcanic', kind: 'WEAPON', icon: '⌁', description: 'Alcance 1. Permite jugar cualquier cantidad de BANG!.', range: 1 },
  SCHOFIELD: { name: 'SCHOFIELD', label: 'Schofield', kind: 'WEAPON', icon: '⌁', description: 'Arma de alcance 2.', range: 2 },
  REMINGTON: { name: 'REMINGTON', label: 'Remington', kind: 'WEAPON', icon: '⌁', description: 'Arma de alcance 3.', range: 3 },
  REV_CARABINE: { name: 'REV_CARABINE', label: 'Rev. Carabine', kind: 'WEAPON', icon: '⌁', description: 'Arma de alcance 4.', range: 4 },
  WINCHESTER: { name: 'WINCHESTER', label: 'Winchester', kind: 'WEAPON', icon: '⌁', description: 'Arma de alcance 5.', range: 5 },
};

export const WEAPON_NAMES: readonly CardName[] = ['VOLCANIC', 'SCHOFIELD', 'REMINGTON', 'REV_CARABINE', 'WINCHESTER'];
