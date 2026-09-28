# Especificación — Juego de Dominó Online

## 1. Objetivo

Construir un juego de dominó online para **4 jugadores**, utilizando el conjunto estándar de **28 fichas Double-Six**, desde `[0|0]` hasta `[6|6]`.

La primera versión debe enfocarse exclusivamente en:

* Crear una partida.
* Generar una sala identificada mediante un código.
* Permitir que hasta 4 jugadores se unan a una sala.
* Esperar a que estén los 4 jugadores.
* Repartir las 28 fichas.
* Permitir jugar la partida en tiempo real.
* Sincronizar el estado del juego entre los 4 jugadores.

Esta versión es un **MVP/prototipo funcional**.

---

# 2. Tecnologías obligatorias

## Frontend

* React
* TypeScript
* Vite
* CSS

No es obligatorio utilizar Tailwind CSS.

## Backend

* Node.js
* TypeScript
* Socket.IO

## Persistencia

La partida se guarda en **SQLite**, en una capa propia y separada
(`backend/src/persistence/`) que es la única que escribe SQL. El resto del
backend —Game Engine, `RoomManager` y los handlers de Socket.IO— solo la usa a
través de su interfaz (`createGame`, `saveGame`, `getGame`, `updateGame`,
`deleteGame`, `gameExists`, …), de modo que las reglas de juego no contienen
ninguna consulta SQL y no dependen del almacenamiento.

Detalle en `frontend/src/components/specs/persistencia-partida.md`.

El estado guardado es completo (jugadores, manos, tablero, turno, marcador,
ronda, configuración y fichas del pozo) y se escribe **antes** de confirmar
cualquier cambio al cliente: si SQLite falla, el cambio se deshace y el jugador
recibe un error, nunca una jugada que el servidor no pueda recuperar.

---

# 3. Tecnologías que NO deben implementarse todavía

Para mantener el proyecto simple, no implementar en esta versión:

* PostgreSQL
* Redis
* JWT
* Registro de usuarios
* Login
* Cuentas de usuario
* Matchmaking
* Sistema de ranking
* Estadísticas
* Historial de partidas
* Microservicios
* Docker
* NestJS
* Sistema de pagos
* Chat
* Sistema de amigos

Estas funcionalidades podrán agregarse posteriormente.

---

# 4. Arquitectura

La aplicación debe utilizar una arquitectura cliente-servidor.

```text
┌──────────────────────┐
│      Jugador 1       │
│   React + TypeScript │
└──────────┬───────────┘
           │
           │ WebSocket
           │
┌──────────▼───────────┐
│                      │
│   Node.js + Socket.IO│
│                      │
│   Game Engine        │
│   Room Manager       │
│   Game State         │
│   Persistencia       │
└──────────┼─ SQLite ──┘
           │
           │ WebSocket
     ┌─────┼─────┬─────┐
     ▼     ▼     ▼     ▼
   J1      J2    J3    J4
```

El servidor debe ser **autoritativo**.

El cliente nunca debe decidir por sí mismo si una jugada es válida.

---

# 5. Responsabilidad del servidor

El servidor debe controlar:

* Creación de salas.
* Código de sala.
* Jugadores conectados.
* Asignación de posición de jugador.
* Estado de la partida.
* Baraja/conjunto de fichas.
* Repartición de fichas.
* Tablero.
* Turno actual.
* Validación de jugadas.
* Cambio de turno.
* Finalización de la partida.
* Persistencia del estado de la partida.
* Reconexión de un jugador que recarga o pierde la conexión.

El frontend debe encargarse principalmente de:

* Renderizar la interfaz.
* Mostrar las fichas.
* Mostrar el tablero.
* Mostrar los jugadores.
* Mostrar el turno.
* Enviar acciones del jugador al servidor.
* Recibir y renderizar el estado actualizado.
* Conservar el código de sala y el id de jugador para poder reconectar.

El frontend no guarda más que eso: es una representación del estado que
envía el servidor.

---

# 6. Sistema de salas

Un jugador debe poder crear una partida.

Al crearla, el servidor debe generar un identificador de sala único.

Ejemplo:

```text
A7K92
```

Los demás jugadores podrán ingresar ese código para unirse.

Una sala puede contener como máximo:

```text
4 jugadores
```

No se debe permitir que un quinto jugador se una a una partida completa.

---

# 7. Flujo de creación de partida

El flujo mínimo debe ser:

```text
Jugador
   │
   ▼
Crear partida
   │
   ▼
Servidor genera roomId
   │
   ▼
Jugador entra automáticamente a la sala
   │
   ▼
Se muestra código de sala
   │
   ▼
Otros jugadores ingresan el código
   │
   ▼
Se unen a la sala
   │
   ▼
Cuando existen 4 jugadores
   │
   ▼
Comienza la partida
```

---

# 8. Jugadores

Cada jugador debe tener como mínimo:

```typescript
interface Player {
    id: string;
    name: string;
    position: number;
    team: number;   // 0 | 1, usado por el match por puntos (§29)
}
```

El `id` es lo que permite reconocer al jugador cuando vuelve a conectarse: es
la única identidad que el servidor necesita y no requiere autenticación
(§3).

Las posiciones deben ser:

```text
0
1
2
3
```

La posición determina el orden de los jugadores y puede utilizarse para determinar los turnos.

El nombre puede ser temporal y no requiere autenticación.

---

# 9. Dominó

La partida debe utilizar exactamente **28 fichas**.

El conjunto debe contener todas las combinaciones desde:

```text
[0|0]
```

hasta:

```text
[6|6]
```

Las fichas son:

```text
[0|0]
[0|1]
[0|2]
[0|3]
[0|4]
[0|5]
[0|6]

[1|1]
[1|2]
[1|3]
[1|4]
[1|5]
[1|6]

[2|2]
[2|3]
[2|4]
[2|5]
[2|6]

[3|3]
[3|4]
[3|5]
[3|6]

[4|4]
[4|5]
[4|6]

[5|5]
[5|6]

[6|6]
```

No deben existir fichas duplicadas.

Por ejemplo:

```text
[2|5]
```

y:

```text
[5|2]
```

representan la misma ficha y no deben existir simultáneamente como fichas independientes.

---

# 10. Representación de una ficha

Utilizar una estructura similar a:

```typescript
interface DominoTile {
    id: string;
    left: number;
    right: number;
}
```

Ejemplo:

```typescript
{
    id: "2-5",
    left: 2,
    right: 5
}
```

Los valores permitidos deben estar entre `0` y `6`.

---

# 11. Repartición

Como existen:

```text
28 fichas
4 jugadores
```

cada jugador recibe:

```text
7 fichas
```

Por lo tanto:

```text
4 × 7 = 28
```

En esta modalidad no deben quedar fichas restantes.

La repartición debe realizarse exclusivamente en el servidor.

---

# 12. Estado de la partida

El servidor debe mantener un estado similar a:

```typescript
interface GameState {
    roomId: string;
    players: Player[];                    // id, nombre, posición y equipo
    hands: Record<string, DominoTile[]>;  // mano completa de cada jugador
    board: DominoTile[];                  // fichas colocadas, de izquierda a derecha
    boardAnchorId: string | null;         // ficha con la que abrió la ronda (el ancla)
    bunk: DominoTile[];                   // fichas del pozo (vacío en esta variante)
    currentPlayer: string | null;
    status: "waiting" | "playing" | "round-over" | "finished";
    winnerId: string | null;
    winnerTeam: number | null;
    winnerReason: "empty-hand" | "blocked" | "player-left" | null;
    blockedById: string | null;
    teamScores: [number, number];
    roundNumber: number;
    currentStarterId: string | null;
    matchWinnerTeam: number | null;
    targetScore: number;
    readyForNextRound: string[];
    revision: number;                     // contador monotónico de cambios de estado
}
```

El estado debe pertenecer a una sala concreta.

Este estado es **persistente**: es exactamente el objeto que se serializa y se
guarda en SQLite (ver §13), de modo que una partida recargada o tras un reinicio
del backend se reconstruye desde aquí y no desde memoria del proceso.

Reglas sobre el estado:

* El servidor es el único que escribe. Ningún cliente puede modificarlo ni
  competir por escribirlo: el frontend es una representación del estado del
  servidor.
* Todo campo que afecte al desarrollo del juego vive en `GameState`. Si un campo
  no está ahí, no se persiste y la partida se rompe al reconectar.
* Cada cambio incrementa `revision`. El cliente descarta cualquier estado con una
  `revision` menor que la que ya tiene, lo que evita que una reconexión vea
  un estado atrasado.
* El estado que sale hacia un jugador concreto no es `GameState`: es el estado
  público derivado de él (mano propia, conteos de manos, tablero, turnos,
  marcador) más la información de sesión. Las manos de los demás nunca viajan al
  cliente (ver §20).
* `board` es una cadena que crece por los dos extremos, así que por sí solo no
  basta para redibujarla: una lista ordenada de izquierda a derecha no dice por
  qué lado se colocó cada ficha. `boardAnchorId` guarda cuál fue la primera ficha
  de la ronda y nunca cambia (se pone al abrir la ronda y se reinicia con ella):
  con ese dato el cliente reproduce la cadena en el mismo orden y con los mismos
  lados, y el tablero se ve igual aunque la partida se abra a medias (ver §21).
  Un tablero no vacío siempre tiene ancla, y con el tablero vacío el ancla es
  `null`.

---

# 13. Room Manager

El backend debe tener un componente responsable de administrar las salas.

Responsabilidades:

```text
createRoom()
joinRoom()
leaveRoom()
getRoom()
removeRoom()
loadRoomForPlayer()   // rehidratación tras recargar o reconectar
```

Debe poder almacenar varias partidas simultáneamente.

Ejemplo conceptual:

```typescript
Map<string, Room>
```

## Persistencia

El estado en memoria no es suficiente: si el proceso se reinicia, la partida se
pierde y el jugador que recarga la página vuelve a un juego que ya no existe.

La persistencia va en una **capa aparte**, sin SQL dentro de la lógica de juego.
El Game Engine y el Room Manager no escriben consultas: hablan con un
repositorio a través de una interfaz de este estilo:

```typescript
createGame()
saveGame()
getGame()
updateGame()
deleteGame()
gameExists()
```

Responsabilidades de esa capa:

* abrir SQLite, crear el esquema y cerrarlo de forma ordenada;
* serializar y validar el `GameState` completo al leer y al escribir, de forma
  que un estado corrupto se rechace con un error explícito en lugar de
  devolver una partida imposible; el ancla se valida como lo que es (un id de
  texto que está en el tablero, y `null` solo si el tablero está vacío), y una
  partida guardada antes de que existiera el campo se carga asumiendo el ancla
  en la primera ficha, que es lo que se hacía por defecto;
* reflejar la lista de jugadores para poder localizar la sala de un jugador;
* degradar en modo memoria si la base de datos no está disponible, sin tumbar el
  servidor: la partida sigue siendo jugable y el cliente recibe un aviso de que
  no está persistida.

Reglas de consistencia:

* una jugada no está "aplicada" hasta que se ha guardado. El flujo es
  *instantánea → mutación → `revision++` → persistir → difundir*: si el guardado
  falla, se restaura el estado anterior y se lanza el error. Nunca se difunde un
  estado que luego se pierde.
* se persiste en cada cambio relevante: jugar, robar, pasar, cambio de turno,
  marcador, inicio y fin de ronda, entrada y salida de jugadores.
* las mutaciones concurrentes sobre la misma sala se serializan, de modo que dos
  sockets no puedan persistir el mismo estado a la vez.

El Room Manager escribe siempre a través de esa capa (`commit()`), y es también
el punto de entrada de la reconexión (`loadRoomForPlayer()`): busca primero en
memoria, y si no está, la recupera de la base de datos, valida que el jugador
pertenece a la sala y devuelve el estado completo listo para enviarle.

## Reconexión

El cliente guarda solo dos cosas en el navegador: el código de sala y su id de
jugador. Con eso basta para volver a la partida; no guarda ni manos ni tablero.

```text
Jugador recarga la página
   │
   ▼
El cliente se conecta y envía resume_session { roomId, playerId }
   │
   ▼
loadRoomForPlayer()
   │
   ├── ► en memoria: se usa esa sala
   └── ► no está: se recupera de SQLite y se rehidrata
   │
   ▼
¿El jugador pertenece a esa sala?
   │
   ├── no ► resume_failed (sala no encontrada / no persistida / estado dañado)
   └── sí ► room_resumed con el estado público completo de ese jugador
```

El cliente aplica el estado recibido como si fuera uno más del juego: mismo
tablero, mismo turno, mismo marcador y misma mano. La única protección es
`revision`: si el estado que llega es anterior al que ya tiene, lo descarta.

Perder la conexión no es abandonar. Se abre una ventana de gracia configurable
(`RECONNECT_GRACE_MS`): durante ella el jugador sigue en la mesa, marcado como
"esperando" para el resto, y si vuelve se le reencola sin cambiar nada. Abandonar
es una acción explícita (`leave_game`) que no espera esa ventana.

---

# 14. Game Engine

La lógica del dominó debe estar separada de Socket.IO.

Crear un componente/clase responsable exclusivamente de las reglas del juego.

Ejemplo:

```typescript
class DominoGame {

    createTiles();

    shuffleTiles();

    dealTiles();

    canPlayTile();

    playTile();

    nextTurn();

    hasWinner();
}
```

El Game Engine no debe depender de React.

Tampoco debe depender directamente de Socket.IO.

Esto permitirá probar las reglas del dominó independientemente de la comunicación online.

---

# 15. Validación de jugadas

Cuando un jugador quiera colocar una ficha:

```text
Frontend
   │
   │ playTile
   ▼
Backend
   │
   ├── ¿El jugador existe?
   ├── ¿La partida está activa?
   ├── ¿Es su turno?
   ├── ¿El jugador posee la ficha?
   ├── ¿La ficha puede colocarse?
   │
   ▼
Actualizar GameState
   │
   ▼
Enviar nuevo estado a los jugadores
```

El cliente nunca debe modificar directamente el estado oficial de la partida.

---

# 16. Comunicación Socket.IO

Utilizar Socket.IO para toda la comunicación en tiempo real relacionada con la partida.

Eventos mínimos:

### Cliente → servidor

```text
create_room        // crear sala
join_room          // unirse a una sala
resume_session     // reconectar: { roomId, playerId }
leave_game         // abandonar la partida (definitivo, no espera la gracia)
start_game         // el host inicia la partida
move_player        // cambiar de equipo en el lobby
swap_players       // intercambiar posiciones en el lobby
play_tile          // jugar una ficha
pass_turn          // pasar el turno
start_next_round   // siguiente ronda del match por puntos
```

### Servidor → cliente

```text
room_created          // el creador recibe su sala y su id de jugador
room_updated          // la sala cambia (estado de espera)
room_resumed          // reconexión correcta: id de jugador + estado completo
resume_failed         // reconexión rechazada: mensaje y código
room_error            // error puntual de una acción del cliente
player_joined         // alguien entra en la sala
player_left           // alguien abandona definitivamente
player_disconnected   // alguien perdió la conexión (entra en la ventana de gracia)
player_reconnected    // alguien volvió dentro del plazo
game_started          // la partida empezó
game_updated          // nuevo estado público (enviado a cada jugador por separado)
player_passed         // un jugador pasó
round_started         // empezó una ronda nueva
game_finished         // la ronda o el match terminou
invalid_move          // jugada o acción no permitida
```

`game_updated` se emite una vez por jugador, con el estado público ya filtrado
(§20): cada uno recibe su mano y los conteos de las demás.

Los nombres pueden modificarse si existe una convención mejor, pero deben mantenerse consistentes.

---

# 17. Crear sala

El cliente envía:

```text
create_room
```

El servidor:

1. Genera un `roomId`.
2. Crea la sala.
3. Crea/asigna el jugador.
4. Agrega al jugador a la sala.
5. Devuelve el código de sala.

Ejemplo conceptual:

```typescript
socket.emit("create_room");
```

Respuesta:

```typescript
{
    roomId: "A7K92",
    playerId: "...",
    position: 0
}
```

---

# 18. Unirse a una sala

El cliente debe poder introducir:

```text
Código de partida
```

y enviar:

```text
join_room
```

Ejemplo:

```typescript
socket.emit("join_room", {
    roomId: "A7K92",
    playerName: "Daniel"
});
```

El servidor debe:

1. Comprobar que la sala existe.
2. Comprobar que tiene menos de 4 jugadores.
3. Crear/asignar el jugador.
4. Asignar una posición.
5. Añadirlo a la sala.
6. Notificar a los jugadores existentes.

---

# 19. Inicio de partida

Cuando existan 4 jugadores:

```text
Player 1
Player 2
Player 3
Player 4
```

el servidor debe poder iniciar la partida.

Al iniciar:

1. Crear las 28 fichas.
2. Mezclarlas.
3. Repartir 7 fichas a cada jugador.
4. Crear el tablero vacío.
5. Determinar el jugador inicial.
6. Cambiar el estado a `playing`.
7. Enviar el estado inicial a los jugadores.

---

# 20. Privacidad de las fichas

Un jugador **no debe recibir las fichas de los demás jugadores**.

El servidor debe enviar a cada cliente únicamente:

```text
Sus propias fichas
+
Información pública de la partida
```

La mano de los demás jugadores debe mostrarse únicamente como cantidad de fichas.

Ejemplo:

```text
Jugador 1: 7 fichas
Jugador 2: 7 fichas
Jugador 3: 7 fichas
Jugador 4: 7 fichas
```

Pero el Jugador 1 solamente debe conocer el contenido de su propia mano.

---

# 21. Tablero

El frontend debe mostrar las fichas jugadas en el tablero.

Conceptualmente:

```text
              [6|4]
                 │
[2|6] ───────── [6|6] ───────── [6|3]
                                      │
                                    [3|1]
```

La representación visual puede evolucionar posteriormente.

La primera versión debe priorizar que las fichas puedan jugarse correctamente sobre el tablero antes que tener una presentación gráfica avanzada.

## El tablero se dibuja siempre igual

Las fichas ya colocadas no pueden moverse bajo los pies del jugador, ni al crecer
la cadena ni al recargar la página. Para poder garantizarlo hace falta que el
estado que llega sea suficiente para reconstruir el tablero por completo, y eso
incluye dos cosas:

* **el ancla de la cadena** (`boardAnchorId`, §12): la ficha con la que empezó la
  ronda. Las fichas se añaden a los dos extremos, así que la lista ordenada no
  dice por qué lado fue cada una; desde el ancla, el cliente vuelve a colocar cada
  ficha en el mismo orden y con el mismo lado con el que se jugó, y por tanto en la
  misma posición de rejilla;
* **el marco congelado por ronda**: la escala y el origen de la mesa se fijan al
  abrir la ronda (con el centro que tenía la cadena en ese momento, que se vuelve
  a calcular a partir del ancla) y ya no se recalculan al crecer el tablero. Al
  abrir una partida a medias se reconstruye ese mismo marco, no uno nuevo centrado
  sobre lo que haya ahora mismo, porque si no el tablero entero se desplazaría
  respecto de lo que ven los demás jugadores.

Con las dos cosas, la posición en pantalla de cada ficha es la misma antes y
después de recargar, y los cuatro jugadores ven las fichas en el mismo sitio.

---

# 22. Turnos

El servidor debe mantener:

```typescript
currentPlayer
```

Solamente ese jugador puede realizar una jugada.

Después de una jugada válida:

```text
Jugador 1
   ↓
Jugador 2
   ↓
Jugador 3
   ↓
Jugador 4
   ↓
Jugador 1
```

El servidor debe determinar el siguiente turno.

---

# 23. Estado del frontend

El frontend puede utilizar React State inicialmente.

No es obligatorio incorporar Zustand en esta primera versión.

Si el estado comienza a crecer considerablemente, posteriormente puede incorporarse Zustand.

---

# 24. Estructura inicial del proyecto

Se recomienda separar frontend y backend:

```text
domino-online/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Board/
│   │   │   ├── DominoTile/
│   │   │   ├── PlayerHand/
│   │   │   └── Player/
│   │   │
│   │   ├── pages/
│   │   │   ├── Home/
│   │   │   ├── Lobby/
│   │   │   └── Game/
│   │   │
│   │   ├── services/
│   │   │   ├── socket.ts
│   │   │   └── session.ts
│   │   │
│   │   ├── types/
│   │   │   ├── Domino.ts
│   │   │   ├── Player.ts
│   │   │   └── Game.ts
│   │   │
│   │   └── App.tsx
│   │
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── game/
│   │   │   ├── DominoGame.ts
│   │   │   └── game.types.ts
│   │   │
│   │   ├── rooms/
│   │   │   └── RoomManager.ts
│   │   │
│   │   ├── socket/
│   │   │   └── socketHandlers.ts
│   │   │
│   │   ├── persistence/
│   │   │   ├── Database.ts
│   │   │   ├── GameRepository.ts
│   │   │   └── stateCodec.ts
│   │   │
│   │   └── server.ts
│   │
│   └── package.json
│
└── README.md
```

La estructura puede modificarse si existe una razón técnica para hacerlo.

---

# 25. Requisitos funcionales del MVP

El MVP se considera funcional cuando se pueda realizar este flujo completo:

```text
1. Jugador A abre la aplicación.
2. Jugador A crea una partida.
3. El servidor genera un código.
4. Jugador A comparte el código.
5. Jugadores B, C y D ingresan el código.
6. Los cuatro aparecen en el lobby.
7. La partida comienza.
8. Cada jugador recibe 7 fichas.
9. Cada jugador solamente puede ver sus propias fichas.
10. El servidor determina quién comienza.
11. Los jugadores realizan jugadas.
12. El servidor valida cada jugada.
13. El tablero se sincroniza entre los cuatro jugadores.
14. Los turnos avanzan correctamente.
15. La partida puede finalizar cuando corresponda.
```

---

# 26. Requisitos no funcionales

### Autoridad del servidor

Toda operación que afecte el estado de la partida debe validarse en el servidor.

### Sincronización

Todos los jugadores de una misma sala deben recibir el mismo estado público de la partida.

### Seguridad básica

El cliente no debe poder:

* jugar durante el turno de otro jugador;
* jugar una ficha que no posee;
* jugar una ficha inexistente;
* modificar directamente el tablero;
* modificar las fichas de otro jugador;
* entrar a una sala llena.

### Simplicidad

No implementar infraestructura adicional que no sea necesaria para cumplir los requisitos del MVP.

---

# 27. Criterio de finalización

La primera versión estará terminada cuando cuatro navegadores/dispositivos puedan conectarse a una misma sala y jugar una partida completa de dominó Double-Six en tiempo real, con el servidor controlando las reglas y sincronizando correctamente el estado.

## Persistencia y reconexión

Además, la partida debe sobrevivir tanto a recargar la página como a reiniciar el servidor:

* el jugador que recarga vuelve a la misma partida con el mismo tablero, turno, marcador, jugadores y mano, y puede seguir jugando;
* recargar no reordena el tablero: cada ficha conserva su posición en pantalla y las cuatro pantallas siguen mostrando las fichas en el mismo sitio;
* lo mismo ocurre tras reiniciar el backend, porque el estado se recupera de SQLite;
* una recarga o una pérdida de conexión no abandonan la partida: el jugador sigue en la mesa durante una ventana de gracia y los demás ven que está esperando;
* el botón de abandonar sí es definitivo y no espera esa ventana;
* si la partida ya no existe, el jugador no pertenece a ella o el estado guardado está corrupto, el servidor lo rechaza con un mensaje claro en lugar de dejar la interfaz colgada;
* sin base de datos el juego sigue siendo jugable en memoria, y el cliente recibe un aviso de que esa partida no está persistida.

---

# 28. Evolución futura

Estas funcionalidades quedan explícitamente fuera del MVP y podrán agregarse posteriormente:

```text
Base de datos multi-servidor
      ↓
Historial de partidas
      ↓
Estadísticas
      ↓
Ranking
      ↓
Matchmaking
      ↓
Redis
      ↓
Escalabilidad
```

Lo que queda por debajo de la línea ya está resuelto en el MVP: la capa de
persistencia en SQLite y la reconexión del jugador. Lo que sigue pendiente es
todo lo que va *más allá* de una partida: cuentas, historial consultable y
escalado horizontal.

---

# 29. Rondas y match por puntos

Una partida se compone de **rondas** y el objetivo es acumular puntos como **match**.

## Estados

```typescript
type GameStatus = "waiting" | "playing" | "round-over" | "finished";
```

* `waiting` — sala en el lobby.
* `playing` — ronda en curso.
* `round-over` — ronda terminada: se revelan las manos y se ofrece el botón "Siguiente ronda".
* `finished` — match terminado (un equipo alcanzó el objetivo o un jugador se fue).

## Objetivo del match

* Por defecto, gana el match el primer equipo en alcanzar **100 puntos**.
* El objetivo es **configurable** al crear una partida (constante `MATCH_TARGET_SCORE`,
  opción `targetScore` del constructor de `DominoGame`).
* Al terminar cada ronda (mano vacía o bloqueo), el equipo ganador suma los pips
  acumulados por el equipo rival a su marcador (`teamScores`), que **persiste entre rondas**.

## Jugador inicial de cada ronda

* **Ronda 1:** el jugador que tenga el doble-seis `[6|6]` (si nadie, el primer asiento).
* **Rondas siguientes:** el jugador siguiente al que inició la ronda anterior, en
  **sentido antihorario** (rotación por asientos).

## Transiciones

```text
waiting ──(start_game)──► playing ──(todos jugaron hasta mano vacía o bloqueo)──► round-over
                                                                                       │
                                              (ningún equipo alcanzó el objetivo)      │
round-over ──(start_next_round, cualquier jugador)──► playing                         │
                                                                                       │
                                              (un equipo alcanzó el objetivo)          ▼
                                                                                     finished
```

* `start_next_round`: lo puede emitir **cualquier jugador** de la sala (no solo el host),
  siempre que la partida esté en `round-over`.
* Si un jugador se desconecta durante una ronda, **no** se le expulsa de inmediato: se
  abre una ventana de gracia y el resto sigue jugando con él esperando. Si vuelve
  dentro del plazo, la partida continúa donde estaba. Si el plazo se agota, o si el
  jugador pulsa abandonar, entonces sí: la ronda pasa a `finished` con razón
  `player-left`, sin ofrecer "Siguiente ronda".

---

# 30. Móvil

El juego debe poder jugarse desde un teléfono/tablet **sin pedirle al jugador
que gire el dispositivo**: al entrar a la mesa con una pantalla táctil apuntando
en vertical, la página se rota 90° por CSS y la partida se muestra en
horizontal, ocupando toda la pantalla.

```text
¿(orientation: portrait) and (pointer: coarse)?
   │
   ├── sí ► .game-viewport.game-rotated: la mesa se ve en horizontal
   │        (se escala contra las dimensiones horizontales efectivas)
   └── no ► mesa nativa (escritorio o teléfono ya girado físicamente)
```

Criterios de aceptación:

1. **Entrar y verla en horizontal**: en vertical, al montar la mesa aparece la
   clase `game-rotated` y la partida cubre toda la pantalla en horizontal, sin
   ninguna acción del jugador. Portada y sala se ven en vertical (el giro vive
   solo en la mesa).
2. **Jugar con el dedo**: las fichas de la mano se arrastran con Pointer
   Events (no mouse); `touch-action: none` impide que el navegador robe el
   gesto con el scroll. El suelto resuelve con `elementFromPoint`, que respeta
   el transform/zoom de la mesa rotada.
3. **Tablero legible con desplazamiento**: las fichas del tablero usan el
   tamaño mínimo de escritorio (`MIN_TILE_H`, 42 px) y la vista sigue la última
   jugada si la cadena no cabe.
4. **Girar el teléfono no reordena nada**: al pasar de vertical (rotada) a
   landscape físico (nativa), o viceversa, el tablero sigue siendo la misma
   partida, ficha a ficha, con la misma mano y el mismo turno. El marco de la
   mesa se conserva por ronda (ver «El tablero se dibuja siempre igual»).
5. **El fantasma de arrastre se renderiza fuera del wrapper rotado** (portal a
   `body`): un `position: fixed` hijo de un ancestro con `transform` dependería
   del wrapper girado y sus coordenadas de pantalla se descuadrarían.
6. **Escritorio intacto**: la mesa no se rota con ratón (`pointer: fine`); el
   arrastre con ratón sigue usando el mismo camino de Pointer Events y las
   invariantes de render de escritorio se mantienen.
