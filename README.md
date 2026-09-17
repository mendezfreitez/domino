# Dominó Online (MVP)

Juego de dominó **Double-Six** para **4 jugadores en 2 vs 2** en tiempo real, con servidor autoritativo basado en Node.js + Socket.IO y cliente React + TypeScript + Vite.

MVP definido según `SPEC.md`.

## Requisitos

- Node.js ≥ 20

## Estructura

```
domino/
├── backend/              # Servidor autoritativo (Node + TS + Socket.IO)
│   └── src/
│       ├── game/         # Game Engine y tipos (sin dependencia de Socket.IO)
│       ├── rooms/        # RoomManager (salas en memoria)
│       ├── socket/       # Handlers de Socket.IO
│       └── server.ts     # Punto de entrada
├── frontend/             # Cliente (React + TS + Vite)
│   └── src/
│       ├── components/   # Board, DominoTile, PlayerHand, Player
│       ├── pages/        # Home, Lobby, Game
│       ├── services/     # socket.ts
│       └── types/        # Dominó, Jugador y Partida
└── SPEC.md
```

## Puesta en marcha

### 1. Backend

```bash
cd backend
npm install
npm run dev        # http://localhost:3001 (con recarga en caliente)
# o: npm run build && npm start  (compila a dist/ y sirve el build)
```

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

### Jugar en red local (WiFi)

Vite y el backend escuchan en todas las interfaces de red, y el cliente se conecta automáticamente al mismo host desde el que se cargó la página (puerto 3001).

1. Averigua la IP local del PC que ejecuta los servidores: `ipconfig` → *Dirección IPv4* (ej. `192.168.100.20`).
2. Los otros 3 dispositivos conectados al mismo WiFi abren `http://192.168.100.20:5173`.
3. Debe permitirse el tráfico entrante en los puertos **3001** y **5173** en el Firewall de Windows (perfil de red privado). Si el juego no carga desde el móvil, agrega las reglas con PowerShell **como administrador**:

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
- Si un jugador se desconecta a mitad de partida, la partida finaliza (`player-left`).

## Autoridad del servidor

Todo el estado vive en memoria del servidor (`RoomManager` → `Map<string, Room>`). El cliente nunca decide la validez de una jugada; envía `play_tile` y el servidor valida:

1. ¿El jugador pertenece a la sala?
2. ¿La partida está activa?
3. ¿Es su turno?
4. ¿Posee la ficha?
5. ¿Puede colocarse en algún extremo del tablero?

## Eventos Socket.IO

**Cliente → servidor:** `create_room`, `join_room`, `start_game`, `play_tile`

**Servidor → cliente:** `room_created`, `room_updated`, `game_started`, `game_updated`, `invalid_move`, `game_finished`, `player_joined`, `player_left`, `room_error`

La mano de cada jugador se envía **solo** a ese jugador (`getPublicState`).

## Pruebas

```bash
cd backend
npm test                # Game Engine: 48 aserciones
npm run test:integration  # Salas + 2 vs 2 + partida completa por Socket.IO
npm run typecheck
```

```bash
cd frontend
npm run build           # tsc -b + vite build
npm run typecheck
```

## Configuración

| Variable          | Lugar     | Default               |
| ----------------- | --------- | --------------------- |
| `PORT`            | backend   | `3001`                |
| `VITE_SERVER_URL` | frontend  | host de la página + `:3001` |

## Fuera del alcance del MVP

Base de datos, usuarios, login, matchmaking, ranking, estadísticas, chat, persistencia y escalabilidad (ver `SPEC.md`). Las salas viven solo en RAM y se pierden al reiniciar el servidor.