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

No utilizar base de datos en esta primera versión.

El estado de las salas y partidas debe mantenerse en memoria RAM del servidor.

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
│                      │
└──────────┬───────────┘
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

El frontend debe encargarse principalmente de:

* Renderizar la interfaz.
* Mostrar las fichas.
* Mostrar el tablero.
* Mostrar los jugadores.
* Mostrar el turno.
* Enviar acciones del jugador al servidor.
* Recibir y renderizar el estado actualizado.

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
}
```

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
    players: Player[];
    hands: Record<string, DominoTile[]>;
    board: DominoTile[];
    currentPlayer: string;
    status: "waiting" | "playing" | "finished";
}
```

El estado debe pertenecer a una sala concreta.

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
```

Debe poder almacenar varias partidas simultáneamente.

Ejemplo conceptual:

```typescript
Map<string, Room>
```

No utilizar una base de datos.

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
create_room
join_room
start_game
play_tile
```

### Servidor → cliente

```text
room_created
room_updated
game_started
game_updated
invalid_move
game_finished
player_joined
player_left
```

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
│   │   │   └── socket.ts
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

No se requiere persistencia de partidas.

Si el servidor se reinicia, las partidas existentes pueden perderse.

---

# 28. Evolución futura

Estas funcionalidades quedan explícitamente fuera del MVP y podrán agregarse posteriormente:

```text
Base de datos
     ↓
Usuarios
     ↓
Login
     ↓
Persistencia
     ↓
Historial
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

No implementar ninguna de ellas hasta que el MVP descrito anteriormente esté funcionando correctamente.

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
* Si un jugador se desconecta durante una ronda, la partida pasa directamente a `finished`
  (razón `player-left`), sin ofrecer "Siguiente ronda".
