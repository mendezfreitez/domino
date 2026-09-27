Quiero implementar persistencia y recuperación completa del estado de una partida de dominó.

### Objetivo

Si un jugador recarga la página, cierra y vuelve a abrir el navegador o pierde temporalmente la conexión, NO debe perder su progreso ni el estado de la partida.

Cuando el cliente vuelva a conectarse al backend, debe poder identificar la partida en la que estaba y solicitar su estado actual. El backend debe recuperar el estado persistido y enviárselo al cliente para reconstruir completamente la partida.

### Arquitectura

El backend Node.js debe ser la fuente de verdad del estado de la partida.

Utilizar SQLite para persistir las partidas activas.

La estructura general debe ser:

Cliente React
↓
Socket.IO / WebSocket
↓
Backend Node.js
↓
Game Manager / Game Engine
↓
SQLite

### Estado que debe persistirse

El estado persistido debe contener TODA la información necesaria para reconstruir una partida en curso, incluyendo como mínimo:

* ID de la partida
* Estado de la partida (esperando, en curso, finalizada, etc.)
* Jugadores
* ID de cada jugador
* Posición de cada jugador
* Equipo de cada jugador
* Mano de cada jugador
* Fichas del pozo
* Fichas colocadas en el tablero
* Estado y extremos actuales del tablero
* Turno actual
* Puntaje de cada equipo
* Ronda actual
* Configuración de la partida
* Información necesaria para determinar si un jugador puede jugar
* Cualquier otro estado necesario para reconstruir exactamente la partida actual

El estado debe ser suficiente para que, después de reiniciar el backend, la partida pueda continuar desde exactamente el mismo punto.

### Persistencia

Cada vez que ocurra una modificación relevante en la partida, el backend debe actualizar el estado persistido en SQLite.

Ejemplos:

* Un jugador coloca una ficha.
* Un jugador roba una ficha.
* Un jugador pasa.
* Cambia el turno.
* Cambia el puntaje.
* Comienza una ronda.
* Termina una ronda.
* Se incorpora un jugador.
* Un jugador abandona la partida.
* Cambia cualquier otro dato relevante del estado.

Evitar guardar solamente información parcial. El objetivo es poder reconstruir la partida completa únicamente a partir de los datos persistidos.

### Reconexión

Implementar un mecanismo de reconexión.

Cuando un jugador vuelva a conectarse:

1. El cliente debe conservar alguna identificación necesaria para saber a qué partida y jugador pertenece.
2. Debe conectarse nuevamente al backend.
3. Debe enviar el ID de la partida y su ID de jugador.
4. El backend debe buscar la partida en memoria.
5. Si no está en memoria, debe cargarla desde SQLite.
6. El backend debe validar que el jugador pertenece a esa partida.
7. El backend debe enviar al cliente el estado actual completo de la partida.
8. El cliente debe reconstruir su interfaz utilizando ese estado.
9. El jugador debe poder continuar jugando exactamente desde donde estaba antes de recargar.

### Importante: fuente de verdad

No confiar en el estado almacenado en React como fuente de verdad.

React solamente representa el estado recibido desde el backend.

El backend debe ser responsable de:

* Validar movimientos.
* Determinar el turno.
* Mantener las manos de los jugadores.
* Mantener el tablero.
* Mantener los puntajes.
* Mantener el estado de la partida.
* Persistir los cambios.
* Recuperar partidas desde SQLite.

El cliente no debe poder modificar directamente el estado de la partida.

### Estado completo vs estado enviado al cliente

Internamente, el backend debe conservar el estado completo de la partida.

Al enviar información a un jugador, asegurarse de no exponer información que el jugador no debería conocer según las reglas del juego.

Por ejemplo, si las manos de los demás jugadores deben permanecer ocultas, el backend puede conocerlas y persistirlas, pero no debe enviarlas al cliente de forma que sean visibles para ese jugador.

Diseñar una función similar a:

getGameStateForPlayer(game, playerId)

que genere el estado apropiado para cada jugador.

### SQLite

Crear una capa independiente para acceso a SQLite.

No colocar consultas SQL directamente dentro de la lógica del juego.

Crear una abstracción similar a:

* createGame()
* saveGame()
* getGame()
* updateGame()
* deleteGame()
* gameExists()

La lógica del juego debe trabajar con objetos de JavaScript y la capa de persistencia debe encargarse de convertirlos al formato necesario para SQLite.

### Manejo de errores

Implementar correctamente estos casos:

* El jugador intenta reconectarse a una partida inexistente.
* El jugador intenta conectarse a una partida a la que no pertenece.
* La partida existe en SQLite pero no está en memoria.
* SQLite no está disponible.
* El estado almacenado está corrupto.
* El jugador pierde conexión durante una jugada.
* Dos acciones llegan prácticamente al mismo tiempo.
* El backend se reinicia mientras existen partidas activas.

### Consistencia

Una jugada no debe considerarse aplicada correctamente hasta que el estado de la partida haya sido actualizado y persistido de forma segura.

Evitar situaciones donde:

1. El cliente recibe que la jugada ocurrió.
2. El servidor se cae.
3. SQLite todavía contiene el estado anterior.
4. Al reconectarse la partida vuelve atrás.

El estado persistido debe mantenerse consistente con el estado utilizado por el Game Engine.

### Requisitos de implementación

Antes de modificar el código existente:

1. Analiza la arquitectura actual.
2. Identifica dónde se encuentra actualmente el estado de las partidas.
3. Identifica cómo se crean las partidas.
4. Identifica cómo se identifican los jugadores.
5. Identifica cómo funciona actualmente la conexión Socket.IO/WebSocket.
6. Identifica qué información del estado ya existe y cuál falta persistir.
7. Propón los cambios necesarios.
8. Después implementa la solución.

No reescribas partes del proyecto que no sean necesarias.

Mantén la arquitectura existente siempre que sea posible.

### Criterio de aceptación principal

Debe funcionar este escenario:

1. Cuatro jugadores entran a una partida.
2. Comienza la partida.
3. Se reparten las fichas.
4. Se realizan varias jugadas.
5. Cambia el turno varias veces.
6. Cambian los puntajes.
7. El jugador 2 recarga la página.
8. El jugador 2 vuelve a conectarse.
9. El backend identifica su partida.
10. El backend recupera el estado actual.
11. El backend devuelve el estado correspondiente al jugador 2.
12. El cliente reconstruye la partida.
13. El jugador 2 ve exactamente el mismo tablero, turno, puntajes, jugadores y su mano que antes de recargar.
14. La partida continúa normalmente.

También debe funcionar si el backend se reinicia:

1. Existe una partida en curso.
2. El backend se detiene.
3. El backend vuelve a iniciar.
4. Un jugador se reconecta.
5. El backend recupera la partida desde SQLite.
6. La partida continúa desde el estado previamente persistido.

Implementa esta funcionalidad de forma modular, mantenible y preparada para futuras mejoras.
