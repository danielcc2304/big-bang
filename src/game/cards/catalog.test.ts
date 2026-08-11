import { describe, expect, it } from 'vitest';
import { CARD_CATALOG } from './catalog';

describe('catálogo oficial en español', () => {
  it('usa los nombres publicados en el reglamento español', () => {
    expect({
      bang: CARD_CATALOG.BANG.label,
      panic: CARD_CATALOG.PANIC.label,
      catBalou: CARD_CATALOG.CAT_BALOU.label,
      indians: CARD_CATALOG.INDIANS.label,
      gatling: CARD_CATALOG.GATLING.label,
      jail: CARD_CATALOG.JAIL.label,
      scope: CARD_CATALOG.SCOPE.label,
      carabine: CARD_CATALOG.REV_CARABINE.label,
    }).toEqual({
      bang: '¡BANG!',
      panic: '¡Pánico!',
      catBalou: 'La Ingenua Explosiva',
      indians: '¡Indios!',
      gatling: 'Ametralladora Gatling',
      jail: 'Cárcel',
      scope: 'Mira Telescópica',
      carabine: 'Carabina Revólver',
    });
  });
});
