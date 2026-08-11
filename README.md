# BANG! Saloon Online

Reconstrucción en React + TypeScript del juego base BANG! para 4–7 jugadores. Incluye partidas locales contra IA, salas online mixtas, reconexión segura, estado canónico por comandos y una interfaz responsive pensada para móvil.

> Este proyecto no incluye ilustraciones, logotipos ni audio propietario. La dirección visual, los símbolos y los sonidos sintetizados son originales. BANG! es una marca de sus respectivos propietarios.

## Inicio rápido

Requisitos: Node.js 20 o superior y npm.

```bash
npm install
npm run dev
```

La aplicación local se abre en `http://localhost:5173`. El modo contra IA funciona sin Firebase.

Comandos disponibles:

```bash
npm run dev          # desarrollo
npm test             # tests Vitest una vez
npm run test:watch   # tests en modo interactivo
npm run build        # TypeScript estricto + bundle de producción
npm run lint         # ESLint
```

## Arquitectura

```text
src/
  components/       UI React y superficies de interacción
  firebase/         inicialización del SDK modular
  game/
    ai/              heurísticas que generan comandos legales
    cards/           catálogo y mazo base de 80 cartas
    characters/      16 personajes del juego base
    engine/          applyCommand, setup, muerte e invariantes
    rules/           roles, distancia y victoria
  hooks/             sesión local, sala online y coordinador
  multiplayer/       salas, identidad, comandos, lease y failover
  styles/            sistema responsive western
  types/             contratos de dominio y multiplayer
  utils/             RNG determinista, IDs y Web Audio
```

El motor es TypeScript puro. Toda acción entra como `GameCommand` con `commandId`, `playerId`, `expectedRevision` y `createdAt`:

```text
applyCommand(estado, comando) → estado nuevo o error sin mutación
```

Antes de aceptar un estado se comprueban invariantes: unicidad de cartas, jugador de turno vivo, vidas válidas y consistencia de Almacén. Los últimos `commandId` aplicados se conservan en el estado para que los reintentos sean idempotentes.

Las secuencias críticas no dependen de promesas abiertas en un navegador. `reaction`, `storeState` y `multiAction` contienen el progreso completo de BANG!/Fallaste!, Duelo, Indios, Gatling y Almacén.

## Multijugador

Firebase mantiene una sala con:

- `canonical`: única copia autoritativa de `GameState`;
- `commands`: cola de comandos de clientes;
- `coordinator`: `coordinatorId`, `coordinatorEpoch`, `leaseUntil` y `heartbeat`;
- `seats`: propietario autenticado por asiento;
- `players`: presencia y última actividad.

Los hashes de recuperación viven fuera de la sala, en `seatProofs`, con lectura limitada al propietario y al coordinador. Las solicitudes de cambio de dispositivo se validan por el coordinador y se eliminan al usarse.

Los clientes no escriben arbitrariamente el estado canónico. El coordinador procesa cada comando dentro de una transacción RTDB y valida lease, epoch y revisión. Si desaparece, un humano conectado puede adquirir atómicamente el lease vencido; el coordinador antiguo queda cercado por el epoch y no puede seguir escribiendo.

La IA usa exactamente el mismo canal de comandos. Su conocimiento separado solo contiene el Sheriff público y puntuaciones de sospecha; no consulta roles secretos ajenos.

## Configurar Firebase

1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com/).
2. Añade una aplicación Web al proyecto.
3. En **Build → Authentication → Sign-in method**, activa **Anonymous**. La identidad anónima persistente protege la propiedad del asiento sin pedir una cuenta al jugador.
4. En **Build → Realtime Database**, crea una base. Elige la región más cercana a tus jugadores.
5. Copia `.env.example` como `.env.local`.
6. En **Project settings → General → Your apps → SDK setup and configuration**, completa:

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://tu-proyecto-default-rtdb.europe-west1.firebasedatabase.app
VITE_FIREBASE_PROJECT_ID=tu-proyecto
VITE_FIREBASE_APP_ID=...
```

7. Instala Firebase CLI si no lo tienes e inicia sesión:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
```

8. Publica `firebase.database.rules.json` desde la consola de Realtime Database o con:

```bash
firebase deploy --only database
```

Para usar el comando anterior puedes crear un `firebase.json` local que apunte a las reglas:

```json
{
  "database": { "rules": "firebase.database.rules.json" }
}
```

No uses reglas globales `.read: true` / `.write: true`. No añadas cuentas de servicio, claves privadas ni credenciales Admin al frontend. `.env`, `.firebase/` y variantes locales ya están ignoradas por Git.

### Reconexión

Al reservar un asiento se crea un secreto de recuperación largo. Firebase solo almacena su SHA-256 en una rama protegida; el secreto queda en el dispositivo y también puede copiarse desde el lobby para recuperarlo en otro. Conocer el nombre de un jugador no permite reclamar su asiento. Para cambiar de dispositivo debe quedar algún coordinador humano conectado que valide la solicitud; el dispositivo original puede volver directamente gracias a su identidad anónima persistente.

## Despliegue en Vercel

1. Sube el repositorio a GitHub, GitLab o Bitbucket.
2. En Vercel, elige **Add New → Project** e importa el repositorio.
3. Vercel detectará Vite. Los valores esperados son:
   - Build command: `npm run build`
   - Output directory: `dist`
   - Install command: `npm install`
4. En **Project Settings → Environment Variables**, añade las cinco variables `VITE_FIREBASE_*` anteriores para Production, Preview y Development según corresponda.
5. Despliega. `vercel.json` ya redirige rutas e invitaciones a `index.html`.
6. Añade el dominio final de Vercel en **Firebase Authentication → Settings → Authorized domains**.

No subas `.env.local` a Vercel ni al repositorio; usa siempre el panel de variables.

## Reglas implementadas

- reparto correcto y aleatorio de roles para 4/5/6/7;
- Sheriff público y +1 vida;
- 16 personajes base y preparación oficial con marcador;
- mazo base de 80 cartas;
- BANG!, Fallaste!, Cerveza, Saloon, Diligencia, Wells Fargo, Pánico, Cat Balou, Indios, Gatling, Duelo y Almacén;
- Prisión, Dinamita, Barril, Mustang, Appaloosa y las cinco armas;
- Volcanic como carta equipada real y robable/descartable;
- recompensa por eliminar Forajido y penalización del Sheriff al eliminar Ayudante;
- Vulture Sam, Suzy Lafayette, Bart Cassidy, El Gringo, Calamity Janet, Slab the Killer, Willy the Kid y habilidades de preparación/draw activas;
- victoria de la Ley, Forajidos y Renegado;
- selector explícito de cartas a conservar al finalizar un turno humano.

## Tests

La suite cubre 37 casos de motor y concurrencia, entre ellos roles, barajado, Sheriff, BANG/Fallaste, Slab, Calamity, Willy, Volcanic, Barril, Prisión, Dinamita, Pánico/Cat Balou sobre Volcanic, Duelo, Indios, Gatling, ciclo completo de Almacén, doble tap, carrera por una carta, descarte, muerte, recompensas, Vulture Sam, victoria, reconexión, comandos duplicados, revisión antigua, invariantes, failover del coordinador y 30 simulaciones largas de partidas completas controladas por IA.

## Decisiones frente al HTML legado

El HTML `bang_saloon_online_v4_13_self_healing.html` se usó como inventario funcional: cartas, personajes, mesa, audio, modos de juego y recuperaciones. No se portaron sus variables globales, renderizado imperativo, esperas `await` en RAM, polling ni escrituras amplias del estado. Cuando había conflicto, se priorizó la regla oficial solicitada; en particular, una Volcanic equipada nunca se infiere por `weaponRange > 1`.

## Limitaciones conocidas

- La variante online permite que todos los humanos elijan simultáneamente entre dos personajes aleatorios; las elecciones concurrentes se serializan de forma autoritativa antes de repartir las manos.
- Las habilidades con decisión durante el robo de Jesse Jones, Kit Carlson y Pedro Ramirez tienen estructura de conocimiento preparada, pero la primera IA usa el robo estándar. Las habilidades automáticas y las activas de combate sí están modeladas.
- Las reglas de Firebase proporcionadas son un punto de partida endurecido para autenticación anónima y autoridad de coordinador. Antes de operar una comunidad pública conviene añadir App Check, límites de tamaño/frecuencia y limpieza automática de salas terminadas.
- En el despliegue exclusivamente cliente descrito aquí, los miembros autenticados de una sala reciben el estado canónico completo para poder asumir el lease. La interfaz oculta manos y roles ajenos, pero un usuario que inspeccione directamente el tráfico podría verlos. Un entorno competitivo con protección anti-trampas requiere mover el procesador de comandos a Cloud Functions o a un servidor de confianza y publicar vistas privadas por UID.
- Los sonidos se sintetizan con Web Audio; no se incluyen muestras realistas externas.
