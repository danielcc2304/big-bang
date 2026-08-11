import type { Role } from '../../types';
import type { RandomSource } from '../../utils/random';
import { shuffle } from '../../utils/random';

const ROLE_SETS: Readonly<Record<number, readonly Role[]>> = {
  4: ['SHERIFF', 'OUTLAW', 'OUTLAW', 'RENEGADE'],
  5: ['SHERIFF', 'DEPUTY', 'OUTLAW', 'OUTLAW', 'RENEGADE'],
  6: ['SHERIFF', 'DEPUTY', 'OUTLAW', 'OUTLAW', 'OUTLAW', 'RENEGADE'],
  7: ['SHERIFF', 'DEPUTY', 'DEPUTY', 'OUTLAW', 'OUTLAW', 'OUTLAW', 'RENEGADE'],
};

export const rolesForPlayerCount = (count: number): readonly Role[] => {
  const roles = ROLE_SETS[count];
  if (!roles) throw new Error('BANG! requiere entre 4 y 7 jugadores.');
  return roles;
};

export const dealRoles = (count: number, random: RandomSource): Role[] => shuffle(rolesForPlayerCount(count), random);
