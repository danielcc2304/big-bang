import type { Character, CharacterName } from '../../types';

export const CHARACTERS: readonly Character[] = [
  { name: 'Bart Cassidy', lives: 4, ability: 'Cada vez que pierde una vida, roba una carta.' },
  { name: 'Black Jack', lives: 4, ability: 'Muestra la segunda carta que roba; si es roja, roba una carta adicional.' },
  { name: 'Calamity Janet', lives: 4, ability: 'Puede usar BANG! como Fallaste! y Fallaste! como BANG!.' },
  { name: 'El Gringo', lives: 3, ability: 'Cada vez que pierde una vida por otro jugador, roba una carta al azar de su mano.' },
  { name: 'Jesse Jones', lives: 4, ability: 'Puede robar su primera carta de la mano de otro jugador.' },
  { name: 'Jourdonnais', lives: 4, ability: 'Se considera que siempre tiene un Barril.' },
  { name: 'Kit Carlson', lives: 4, ability: 'Mira las tres primeras cartas, roba dos y devuelve una al mazo.' },
  { name: 'Lucky Duke', lives: 4, ability: 'En cada desenfunde revela dos cartas y elige el resultado.' },
  { name: 'Paul Regret', lives: 3, ability: 'Los demás jugadores le ven a distancia +1.' },
  { name: 'Pedro Ramirez', lives: 4, ability: 'Puede robar su primera carta de la parte superior del descarte.' },
  { name: 'Rose Doolan', lives: 4, ability: 'Ve a los demás jugadores a distancia -1.' },
  { name: 'Sid Ketchum', lives: 4, ability: 'Puede descartar dos cartas para recuperar una vida.' },
  { name: 'Slab the Killer', lives: 4, ability: 'Se necesitan dos Fallaste! para evitar cada uno de sus BANG!.' },
  { name: 'Suzy Lafayette', lives: 4, ability: 'Cuando se queda sin cartas en la mano, roba una carta.' },
  { name: 'Vulture Sam', lives: 4, ability: 'Recibe todas las cartas de cada jugador eliminado.' },
  { name: 'Willy the Kid', lives: 4, ability: 'Puede jugar cualquier cantidad de cartas BANG! durante su turno.' },
] as const;

export const characterByName = (name: CharacterName): Character => {
  const character = CHARACTERS.find((candidate) => candidate.name === name);
  if (!character) throw new Error(`Personaje desconocido: ${name}`);
  return character;
};
