# Dominó Online (MVP)

Juego de dominó **Double-Six** para **4 jugadores en 2 vs 2** en tiempo real, con servidor autoritativo basado en Node.js + Socket.IO y cliente React + TypeScript + Vite.

MVP definido según `SPEC.md`, con **persistencia de la partida en SQLite** y **reconexión tras recargar la página** (ver `frontend/src/components/specs/persistencia-partida.md`).

## Requisitos

- Node.js ≥ 20 (usa el módulo integrado `node:sqlite`, sin compilaciones nativas)

## Estructura

```
domino/
├── backend/              # Servidor autoritativo (Node + TS + Socket.IO)
│   ├── data/             # domino.db: partidas persistidas (se crea solo, no se versiona)
│   └── src/
│       ├── game/         # Game Engine y tipos (sin dependencia de Socket.IO)
│       ├── persistence/  # Capa de SQLite: Database, GameRepository, stateCodec
│       ├── rooms/        # RoomManager (salas), presentador de estado y bloqueos
│       ├── socket/       # Handlers de Socket.IO
│       └── server.ts     # Punto de entrada
├── frontend/             # Cliente (React + TS + Vite)
│   └── src/
│       ├── components/   # Board, DominoTile, PlayerHand, Player
│       ├── pages/        # Home, Lobby, Game
│       ├── services/     # socket.ts (eventos) y session.ts (identidad local)
│       └── types/        # Dominó, Jugador y Partida
├── SPEC.md
└── frontend/src/components/specs/persistencia-partida.md
```

## Puesta en marcha

### 1. Backend

```bash
cd backend
npm install
npm run dev        # http://localhost:3001 (con recarga en caliente)
# o: npm run build && npm start  (compila a dist/ y sirve el build)
```

Al arrancar abre (o crea) `backend/data/domino.db` y guarda ahí cada cambio de
estado de cada sala. Si esa ruta no es escribible, el servidor **no se cae**:
avisa por consola y sigue jugando en memoria.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

### 3. Jugar

1. Abre `http://localhost:5173` en 4 pestañas/navegadores (o dispositivos).
2. El Jugador A pulsa **Crear partida** y comparte el código de 5 caracteres.
3. Los demás pulsan **Unirse** e ingresan el código.
4. Al entrar, el servidor reparte a los jugadores en dos equipos equilibrados (2 y 2). El anfitrión puede **mover** jugadores entre los dos recuadros.
5. Cuando hay 2 jugadores en cada equipo, el anfitrión pulsa **Iniciar partida**: 7 fichas por persona.
6. Cada uno ve únicamente sus propias fichas; el estado del tablero se sincroniza en tiempo real. Gana el **equipo** del jugador que se descargue; si se bloquea, gana el equipo con menos puntos sumados.

### 4. Recargar sin perder la partida

Se puede pulsar **F5** en cualquier momento: al volver a abrir la pestaña, el
cliente envía su identidad local (`roomId` + `playerId`, lo único que guarda en
`localStorage`) y el backend le devuelve el estado completo de esa partida. Lo
mismo funciona tras reiniciar el servidor, porque la partida está en SQLite.

Cerrar la pestaña o perder cobertura **no** abandona la partida: el jugador
sigue en la mesa durante la ventana de gracia (`RECONNECT_GRACE_MS`, 45 s por
defecto) y los demás ven que está esperando. El botón **Abandonar** sí es
definitivo y no espera ese plazo.

## Jugar en red local (WiFi)

Vite y el backend escuchan en todas las interfaces de red, y el cliente se conecta automáticamente al mismo host desde el que se cargó la página (puerto 3001).

1. Averigua la IP local del PC que ejecuta los servidores: `ipconfig` → *Dirección IPv4* (ej. `192.168.100.20`).
2. Los otros 3 dispositivos conectados al mismo WiFi abren `http://192.168.100.20:5173`.
3. Debe permitirse el tráfico entrante en los puertos **3001** y **5173** en el Firewall de Windows (perfil de red privada). Si el juego no carga desde el móvil, agrega las reglas con PowerShell **como administrador**:

```powershell
netsh advfirewall firewall add rule name="Domino Backend LAN (3001)" dir=in action=allow protocol=TCP localport=3001
netsh advfirewall firewall add rule name="Domino Frontend LAN (5173)" dir=in action=allow protocol=TCP localport=5173
```

Para forzar otra URL de servidor, define `VITE_SERVER_URL` (ej. `http://192.168.100.20:3001`) antes de `npm run dev`.

## Reglas implementadas

- Conjunto estándar de 28 fichas `[0|0]` … `[6|6]`, sin duplicados (la ficha `[2|5]` y `[5|2]` son la misma).
- Inicia quien posee la mula `[6|6]`.
- Cada ficha debe coincidir con el extremo izquierdo o derecho del tablero y se coloca rotada según sea necesario.
- Turno rotativo por posición. Si un jugador no tiene fichas jugables, su turno se **salta automáticamente**.
- **Ganador**: primer jugador que vacía su mano (`empty-hand`).
- **Bloqueo**: si nadie puede jugar, gana quien tenga menos puntos en mano (`blocked`).
- Si un jugador se desconecta y no vuelve dentro de la ventana de gracia, la partida finaliza (`player-left`).

## Autoridad del servidor y persistencia

Todo el estado de juego vive en el servidor. El cliente nunca decide la validez
de una jugada: envía `play_tile` y el servidor valida

1. ¿El jugador pertenece a la sala?
2. ¿La partida está activa?
3. ¿Es su turno?
4. ¿Posee la ficha?
5. ¿Puede colocarse en algún extremo del tablero?

La capa `backend/src/persistence/` es la **única** que sabe SQL. Expone una
interfaz de guardado completo (`createGame`, `saveGame`, `getGame`,
`updateGame`, `deleteGame`, `gameExists`, `listGames`, `getPlayers`,
`findRoomIdByPlayer`) y el resto del backend solo la usa a través de esa
interfaz. El Game Engine no sabe que existe una base de datos.

El ciclo de un cambio de estado es siempre el mismo, y en este orden
(`RoomManager.commit`):

1. Se copia el estado anterior de la sala.
2. Se aplica el cambio en memoria.
3. Se incrementa la revisión del estado.
4. **Se escribe en SQLite.**
5. Solo si SQLite confirma, se difunde el cambio a los clientes.

Si el guardado falla, la sala vuelve al estado anterior y el jugador recibe un
error: nunca se le confirma una jugada que el servidor no puede recuperar. Dos
jugadas que llegan a la vez se serializan por sala (`RoomLocks`), de modo que la
segunda ve el tablero que dejó la primera.

## Reconexión

Al abrir la página, el cliente manda su identidad local y el backend decide qué
pasa (`RoomManager.loadRoomForPlayer`):

| Situación                              | Resultado                                                    |
| -------------------------------------- | ------------------------------------------------------------ |
| La sala está en memoria                | Se devuelve tal cual (`recoveredFrom: "memory"`)              |
| El backend se reinició                 | Se reconstruye desde SQLite (`recoveredFrom: "database"`)     |
| El jugador no pertenece a la partida   | `resume_failed` con `not-a-member`                            |
| La partida ya no existe                | `resume_failed` con `not-found`                               |
| El estado guardado está corrupto       | `resume_failed` con `corrupt`                                 |
| No hay base de datos y no está en RAM  | `resume_failed` con `persistence-unavailable`                 |

Cuando el servidor acepta la sesión, responde con `room_resumed` y a
continuación con el estado completo (`game_updated`) **para ese jugador**:
`getGameStateForPlayer` incluye su mano y solo el *conteo* de fichas de los
demás. Cada estado lleva su `revision`, de modo que el cliente descarta un
`game_updated` que haya llegado tarde.

## Eventos Socket.IO

**Cliente → servidor:** `create_room`, `join_room`, `resume_session`,
`leave_game`, `start_game`, `move_player`, `swap_players`, `play_tile`,
`pass_turn`, `start_next_round`

**Servidor → cliente:** `room_created`, `room_resumed`, `resume_failed`,
`room_updated`, `game_started`, `game_updated`, `game_finished`, `player_joined`,
`player_left`, `player_disconnected`, `player_reconnected`, `player_passed`,
`invalid_move`, `room_error`

La mano de cada jugador se envía **solo** a ese jugador (`getGameStateForPlayer`).

## Pruebas

```bash
cd backend
npm test                  # Game Engine puro
npm run test:persistence  # Capa SQLite: códec de estado + CRUD
npm run test:integration  # Salas + 2 vs 2 + partida completa por Socket.IO
npm run test:reconnect    # Criterio de aceptación: recarga, reinicio y errores
npm run test:all          # Todo lo anterior
npm run typecheck
```

```bash
cd frontend
npm run build           # tsc -b + vite build
npm run typecheck
```

`npm run test:reconnect` es la prueba que replica el criterio de aceptación: el
jugador 2 recarga, la partida sigue igual y continúa; el backend se reinicia a
mitad de partida y la partida se recupera de SQLite; una sesión inventada, una
sala inexistente o un estado corrupto se rechazan con un mensaje claro; y sin
base de datos el juego sigue siendo jugable, solo que sin recuperar.

## Configuración

| Variable             | Lugar    | Default                  | Qué hace                                                                 |
| -------------------- | -------- | ------------------------ | ------------------------------------------------------------------------ |
| `PORT`               | backend  | `3001`                   | Puerto de escucha                                                        |
| `DB_PATH`            | backend  | `data/domino.db`         | Fichero SQLite donde se guardan las partidas                             |
| `PERSISTENCE`        | backend  | `true`                   | `false` desactiva SQLite: el juego sigue, pero no sobrevive al reinicio  |
| `RECONNECT_GRACE_MS` | backend  | `45000`                  | Tiempo que un jugador puede estar desconectado sin que se le dé por ajeno. `0` = abandono inmediato |
| `VITE_SERVER_URL`    | frontend | host de la página + `:3001` | URL del backend a la que se conecta el cliente                        |

## Fuera del alcance del MVP

Usuarios, login, matchmaking, ranking, estadísticas, chat y escalabilidad (ver
`SPEC.md`). No hay cuentas: la identidad es un `playerId` que genera el
servidor y el cliente conserva en `localStorage`.
