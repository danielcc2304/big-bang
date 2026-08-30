# BANG! Saloon Online

Reconstrucción en React + TypeScript del juego base BANG! para 4–7 jugadores. Incluye partidas locales contra IA, salas online mixtas, reconexión segura, estado canónico por comandos y una interfaz responsive pensada para móvil.

> Este proyecto no incluye ilustraciones, logotipos ni audio propietario. La dirección visual, los símbolos y los sonidos sintetizados son originales. BANG! es una marca de sus respectivos propietarios.

## Inicio rápido

Requisitos: Node.js 20 o superior y npm.

```bash
npm install
npm run dev
```

La aplicación local se abre en `http://localhost:5173`. El modo contra IA funciona sin configurar un proyecto Supabase.

```bash
npm run dev              # desarrollo
npm test -- --run        # tests Vitest
npm run lint             # ESLint
npm run build            # TypeScript estricto + bundle de producción
npm run validate:supabase # contrato SQL, RLS y RPCs
```

## Arquitectura

```text
src/
  components/       UI React y superficies de interacción
  game/             motor determinista, cartas, personajes, reglas e IA
  hooks/            sesión local, sala online y automatización
  multiplayer/      salas, identidad, comandos, lease y failover
  supabase/         cliente, autenticación anónima y reloj del servidor
  styles/           sistema responsive western
  types/            contratos de dominio y multiplayer
  utils/             RNG determinista, IDs y Web Audio
supabase/
  migrations/       esquema, RLS y funciones RPC versionadas
```

El motor es TypeScript puro. Toda acción entra como `GameCommand` con `commandId`, `playerId`, `expectedRevision` y `createdAt`:

```text
applyCommand(estado, comando) → estado nuevo o error sin mutación
```

Antes de aceptar un estado se comprueban invariantes: unicidad de cartas, jugador de turno vivo, vidas válidas y consistencia de Almacén. Los últimos `commandId` aplicados se conservan para que los reintentos sean idempotentes.

## Multijugador con Supabase

Supabase sustituye por completo a Firebase. El motor conserva una copia canónica de `GameState` en `public.rooms.state`, mientras PostgreSQL controla las fronteras de concurrencia:

- `rooms`: estado canónico JSONB y versión monotónica para compare-and-swap;
- `room_members`: propiedad de cada asiento y autorización de sala;
- `room_commands`: cola limitada de comandos con slot único e idempotencia;
- `room_command_receipts`: confirmaciones `APPLIED`/`REJECTED`;
- `room_presence`: heartbeat persistente por dispositivo y limpieza por caducidad;
- `seat_proofs` y `reconnect_claims`: recuperación sin exponer hashes al navegador.

El navegador solo puede leer salas autorizadas. Las escrituras pasan por RPC `SECURITY DEFINER` con `search_path` vacío: creación y unión atómica, lease del coordinador, CAS del estado, cola de comandos, reconexión y finalización. Supabase Realtime publica cambios de las tablas y el cliente recarga el snapshot completo, por lo que un evento parcial nunca sustituye al estado local.

La identidad se crea con `supabase.auth.signInAnonymously()`. Activa el proveedor Anonymous en el panel de Supabase antes de probar salas. El heartbeat y la marca `pagehide` sustituyen a `onDisconnect`; el coordinador considera huérfana una conexión después de 12 segundos.

## Configurar Supabase

1. Crea un proyecto en [Supabase](https://supabase.com/dashboard).
2. En **Authentication → Providers**, activa **Anonymous sign-ins**.
3. Copia `.env.example` como `.env.local` y completa la URL y la clave pública del proyecto:

```dotenv
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-o-publishable-key
```

4. En **SQL Editor**, ejecuta [supabase/migrations/0001_online.sql](supabase/migrations/0001_online.sql). La migración crea tablas, índices, RLS, RPCs y publica las tablas en `supabase_realtime`.
5. Comprueba el contrato sin credenciales con `npm run validate:supabase`.

No pongas una `service_role` key en variables `VITE_*`. La clave pública solo permite las operaciones que las políticas y RPCs autorizan.

### Reconexión

Al reservar un asiento se crea un secreto largo en el dispositivo. Supabase solo conserva su SHA-256 en `seat_proofs`; la función `claim_reconnect` compara el hash dentro de una transacción, comprueba que no existe una conexión viva y transfiere el asiento a la nueva identidad anónima. El hash nunca se selecciona desde el navegador.

## Despliegue en Vercel

1. Importa el repositorio en Vercel.
2. Usa `npm run build` como comando de compilación y `dist` como salida.
3. En **Project Settings → Environment Variables**, añade `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` para Production, Preview y Development.
4. Añade los dominios de Vercel permitidos en **Supabase → Authentication → URL Configuration**.
5. Ejecuta la migración SQL en el mismo proyecto Supabase que utilizará Production y Preview.

No subas `.env.local` al repositorio; `.env*` locales están ignorados por Git.

## Reglas implementadas

- reparto correcto y aleatorio de roles para 4/5/6/7;
- Sheriff público y +1 vida;
- 16 personajes base y preparación oficial con marcador;
- mazo base de 80 cartas;
- BANG!, Fallaste!, Cerveza, Saloon, Diligencia, Wells Fargo, Pánico, Cat Balou, Indios, Gatling, Duelo y Almacén;
- Prisión, Dinamita, Barril, Mustang, Appaloosa y las cinco armas;
- Volcanic como carta equipada real y robable/descartable;
- habilidades de personajes, elecciones simultáneas y automatización de IA por el mismo canal de comandos;
- victoria de la Ley, Forajidos y Renegado;
- selector explícito de cartas a conservar al finalizar un turno humano.

## Validación

```bash
npm run validate:supabase
npm test -- --run
npm run lint
npm run build
npm audit --audit-level=high
```

Las pruebas cubren motor, IA, cartas, habilidades, hidratación, comandos, leases, reintentos, reconexión y las invariantes de partidas completas. No dependen de un proyecto Supabase remoto: las RPCs se prueban mediante adaptadores simulados y el SQL se valida de forma estática en CI.

## Limitación de seguridad competitiva

El cliente necesita recibir el estado canónico completo para que cualquier humano pueda asumir el lease tras una caída. La interfaz oculta manos y roles ajenos, pero un usuario avanzado podría inspeccionar el tráfico. Para un entorno competitivo conviene mover el coordinador a un servidor de confianza y publicar vistas privadas por UID.
