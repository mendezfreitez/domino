# SPEC.md — Sistema de ordenamiento de fichas de dominó

## 1. Objetivo

Implementar la lógica encargada de ordenar y posicionar las **28 fichas del dominó estándar doble-seis**, formando una línea principal jugable y realizando cruces de 90° cuando la línea alcance su longitud máxima definida.

El sistema debe encargarse exclusivamente de determinar:

* Qué ficha se coloca.
* En qué posición se coloca.
* En qué orientación se coloca.
* Qué extremo de la cadena utiliza.
* Cuándo realizar un cruce.
* Cómo posicionar las fichas dobles.
* Cómo evitar solapamientos.
* Cómo mantener una distribución visual clara y consistente.

La lógica debe ser independiente de la representación visual utilizada por el frontend.

---

# 2. Conjunto de fichas

Utilizar un conjunto estándar de dominó doble-seis compuesto por **28 fichas únicas**.

Las fichas son:

```text
[0|0]
[0|1] [1|1]
[0|2] [1|2] [2|2]
[0|3] [1|3] [2|3] [3|3]
[0|4] [1|4] [2|4] [3|4] [4|4]
[0|5] [1|5] [2|5] [3|5] [4|5] [5|5]
[0|6] [1|6] [2|6] [3|6] [4|6] [5|6] [6|6]
```

Cada ficha debe identificarse de forma única.

Ejemplo:

```ts
{
    id: "3-5",
    left: 3,
    right: 5,
    isDouble: false
}
```

Para una ficha doble:

```ts
{
    id: "6-6",
    left: 6,
    right: 6,
    isDouble: true
}
```

---

# 3. Concepto de línea principal

La partida comienza formando una **línea principal horizontal**.

La línea principal debe tener como mínimo:

```text
16 fichas
```

Antes de alcanzar las 16 fichas, no se deben realizar cruces.

La línea debe crecer inicialmente de forma horizontal.

Ejemplo conceptual:

```text
[ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ]
```

---

# 4. Longitud mínima de la línea principal

La línea principal debe contener **como mínimo 16 fichas antes de realizar cualquier cruce**.

Por lo tanto:

```text
cantidad < 16
    ↓
continuar línea recta
```

Cuando:

```text
cantidad >= 16
```

se habilita la posibilidad de realizar un cruce.

El cruce no debe producirse antes de que existan 16 fichas en la línea principal.

---

# 5. Cruces de 90 grados

Una vez alcanzadas las 16 fichas, la cadena debe poder continuar mediante un giro de **90 grados**.

El giro debe producirse en ambos extremos de la línea principal.

Conceptualmente:

```text
                [ ][ ][ ]
                       |
                       |
[ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ]
```

Sin embargo, ambos extremos deben utilizar direcciones opuestas.

## 5.1 Restricción de fichas dobles en el giro

El giro de 90° solo puede ejecutarse sobre una ficha **no doble** conectada a otra **no doble**.

Es decir, la ficha que gira debe cumplir ambas condiciones:

* no ser una ficha doble, y
* estar conectada a una ficha anterior que tampoco sea doble.

Si al alcanzar el umbral el giro correspondiera a:

* una ficha **doble**, o
* una ficha **inmediatamente pegada a una doble** (su ficha anterior en la cadena es doble),

entonces **no se gira**: esa ficha se coloca recta y el cruce queda **pospuesto** hasta que aparezca una ficha no doble que esté conectada a otra no doble.

---

# 6. Regla de dirección de los cruces

Los dos extremos de la cadena deben crecer en direcciones verticales opuestas.

Si el extremo derecho realiza el cruce hacia arriba:

```text
                    [ ]
                    [ ]
                    [ ]
                    |
[ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ]
```

entonces el extremo izquierdo debe realizar el cruce hacia abajo:

```text
[ ]
[ ]
[ ]
 |
[ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ][ ]
```

Por lo tanto:

```text
rightTurn = UP
leftTurn  = DOWN
```

o:

```text
rightTurn = DOWN
leftTurn  = UP
```

Nunca:

```text
rightTurn = UP
leftTurn  = UP
```

ni:

```text
rightTurn = DOWN
leftTurn  = DOWN
```

El objetivo es evitar que ambos extremos crezcan hacia el mismo espacio vertical.

---

# 7. Estado de dirección

La lógica debe mantener explícitamente el estado de dirección de cada extremo.

Ejemplo:

```ts
type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

interface ChainEnd {
    direction: Direction;
    hasTurned: boolean;
}
```

Ejemplo:

```ts
leftEnd = {
    direction: "DOWN",
    hasTurned: true
};

rightEnd = {
    direction: "UP",
    hasTurned: true
};
```

---

# 8. Orientación de las fichas

Cada ficha debe poder rotarse según la dirección en la que se está construyendo la cadena.

Direcciones posibles:

```text
UP
DOWN
LEFT
RIGHT
```

Una ficha horizontal debe utilizarse para segmentos horizontales.

Una ficha vertical debe utilizarse para segmentos verticales.

Ejemplo:

```text
Horizontal:

[ 3 | 5 ]

Vertical:

[ 3 ]
[ 5 ]
```

La orientación visual no debe modificar los valores lógicos de la ficha.

---

# 9. Conexión entre fichas

Cada nueva ficha debe conectarse correctamente con la ficha anterior.

Si el extremo disponible contiene:

```text
5
```

la nueva ficha debe contener un:

```text
5
```

en el lado correspondiente.

Ejemplo:

```text
[2|5][5|6]
```

La conexión válida es:

```text
2 - 5 - 6
```

No se debe colocar una ficha que no pueda conectarse con el valor disponible.

---

# 10. Orden de los valores

La lógica debe diferenciar entre:

* valor de conexión
* orientación visual
* posición espacial

No asumir que:

```text
[2|5]
```

y:

```text
[5|2]
```

son fichas diferentes.

Ambas representan la misma ficha física.

La orientación puede cambiar según el extremo en el que se coloque.

---

# 11. Fichas dobles

Las fichas dobles tienen un tratamiento especial.

Una ficha es doble cuando:

```text
left === right
```

Ejemplos:

```text
[0|0]
[1|1]
[2|2]
[3|3]
[4|4]
[5|5]
[6|6]
```

---

# 12. Posicionamiento de fichas dobles

Cuando se coloque una ficha doble, debe posicionarse:

1. Inmediatamente al final de la ficha anterior.
2. De manera perpendicular a la ficha anterior.
3. Centrada respecto al punto de conexión.

Ejemplo:

```text
Ficha anterior:

[ 3 | 5 ]

Doble:

    [ 5 ]
    [ 5 ]
```

La ficha doble debe quedar centrada sobre el punto donde termina la ficha anterior.

Conceptualmente:

```text
───────────────
     [3|5]
        │
       [5]
       [5]
```

No debe colocarse desplazada hacia uno de los lados.

---

# 13. Doble en una línea horizontal

Cuando la línea sea horizontal:

```text
[3|5]
```

un doble debe quedar perpendicular:

```text
    [5]
    [5]
     │
[3|5]
```

La orientación del doble debe ser vertical.

---

# 14. Doble en una línea vertical

Cuando la línea sea vertical, el doble debe ser horizontal.

Ejemplo:

```text
[3]
[5]
 |
[5|5]
```

La ficha doble debe quedar perpendicular a la dirección de la cadena.

---

# 15. Doble y dirección de crecimiento

La regla de perpendicularidad debe mantenerse independientemente de si la cadena está creciendo:

```text
LEFT
RIGHT
UP
DOWN
```

Por lo tanto:

| Dirección de la cadena | Orientación del doble |
| ---------------------- | --------------------- |
| LEFT                   | Vertical              |
| RIGHT                  | Vertical              |
| UP                     | Horizontal            |
| DOWN                   | Horizontal            |

---

# 16. Centrado de los dobles

El centro geométrico del doble debe coincidir con el punto de conexión de la cadena.

No utilizar simplemente las coordenadas de la esquina de la ficha anterior.

Calcular el punto de conexión y utilizarlo como centro del doble.

Conceptualmente:

```ts
double.x = connectionPoint.x - double.width / 2;
double.y = connectionPoint.y - double.height / 2;
```

La fórmula exacta puede variar dependiendo del sistema de coordenadas utilizado.

---

# 17. Separación entre fichas

Debe existir una separación visual uniforme entre fichas.

Definir una constante:

```ts
TILE_GAP
```

Ejemplo:

```ts
const TILE_GAP = 8;
```

No utilizar valores de separación diferentes arbitrariamente para cada ficha.

La separación debe mantenerse consistente tanto:

* horizontalmente
* verticalmente

---

# 18. Prevención de solapamientos

Ninguna ficha debe solaparse con otra.

Antes de confirmar la posición de una ficha:

1. Calcular su bounding box.
2. Compararla con las fichas existentes.
3. Verificar que no exista una intersección no permitida.
4. Si existe una colisión, recalcular la posición.

La lógica debe considerar especialmente:

* dobles
* cruces
* esquinas
* cambios de dirección
* crecimiento vertical.

---

# 19. Cruces y espacio disponible

El sistema debe reservar suficiente espacio alrededor de cada cruce.

Nunca colocar una ficha vertical directamente encima de otra ficha que pueda provocar solapamiento.

Debe existir suficiente separación para que las fichas sean visualmente distinguibles.

---

# 20. Estructura recomendada de una ficha posicionada

Separar los datos de la ficha de su posición visual.

Ejemplo:

```ts
interface DominoTile {
    id: string;
    left: number;
    right: number;
    isDouble: boolean;
}
```

Y:

```ts
interface PositionedTile {
    tile: DominoTile;

    x: number;
    y: number;

    rotation: 0 | 90 | 180 | 270;

    direction: Direction;

    connectionSide?: "LEFT" | "RIGHT" | "TOP" | "BOTTOM";
}
```

Esto permite que la lógica del juego sea independiente del renderizado.

---

# 21. Estado de cada extremo

La cadena debe mantener información independiente para ambos extremos.

Ejemplo:

```ts
interface ChainEnd {
    x: number;
    y: number;

    direction: Direction;

    connectionValue: number;

    hasTurned: boolean;

    turnDirection?: "UP" | "DOWN";
}
```

Debe existir:

```ts
leftEnd
rightEnd
```

---

# 22. Cambio de dirección

Antes de alcanzar las 16 fichas:

```text
LEFT  ←────────────→ RIGHT
```

Después de alcanzar las 16 fichas:

```text
LEFT  └────────────┘ RIGHT
       ↓          ↑
```

Cada extremo puede continuar verticalmente.

El sistema debe conservar la dirección después del giro.

Ejemplo:

```text
RIGHT
  ↓
  ↓
  ↓
```

Una vez que el extremo derecho gira hacia arriba:

```ts
direction = "UP"
```

las siguientes fichas deben continuar hacia arriba hasta que la lógica determine otro cambio de dirección.

---

# 23. Alternancia de cruces

El sistema debe mantener una configuración consistente de cruces.

Ejemplo inicial:

```ts
rightTurnDirection = "UP";
leftTurnDirection = "DOWN";
```

Si se utiliza la configuración inversa:

```ts
rightTurnDirection = "DOWN";
leftTurnDirection = "UP";
```

No se debe permitir que ambos extremos tengan la misma dirección vertical.

---

# 24. Límites del tablero

El sistema debe ser consciente del área disponible.

Definir:

```ts
BOARD_WIDTH
BOARD_HEIGHT
```

o, preferentemente, utilizar un sistema de coordenadas lógico que posteriormente pueda escalarse al tamaño real del tablero.

Si una cadena se aproxima al límite:

1. Intentar continuar utilizando el espacio disponible.
2. Si no es posible, evaluar un nuevo cambio de dirección.
3. Nunca colocar fichas fuera del área jugable.
4. Nunca resolver una colisión simplemente ocultando una ficha.

---

# 25. Coordenadas lógicas

La lógica de ordenamiento debe trabajar idealmente con coordenadas lógicas.

Ejemplo:

```text
(0,0)
(1,0)
(2,0)
...
```

El renderer posteriormente puede convertir estas coordenadas a píxeles.

Esto permite que el sistema funcione correctamente independientemente del tamaño de pantalla.

---

# 26. Escalabilidad visual

El algoritmo no debe depender de valores absolutos como:

```text
x = 500
y = 300
```

Las posiciones deben calcularse a partir de:

* tamaño de ficha
* separación
* posición del origen
* dirección
* dimensiones del tablero.

Esto permitirá posteriormente adaptar el tablero a:

* escritorio
* tablet
* móvil
* diferentes resoluciones.

---

# 27. Regla de prioridad de colocación

Cuando se coloque una ficha, seguir este orden:

```text
1. Determinar extremo válido.
2. Determinar valor de conexión.
3. Determinar dirección actual.
4. Determinar orientación de la ficha.
5. Calcular punto de conexión.
6. Calcular posición.
7. Aplicar reglas especiales para dobles.
8. Comprobar colisiones.
9. Comprobar límites.
10. Confirmar posición.
11. Actualizar estado del extremo.
```

---

# 28. Integridad del conjunto

Cada una de las 28 fichas debe existir solamente una vez.

No se debe permitir:

```text
[3|5]
[3|5]
```

simultáneamente como dos fichas distintas.

Utilizar el `id` de la ficha para garantizar unicidad.

Ejemplo:

```ts
id = `${Math.min(left, right)}-${Math.max(left, right)}`
```

Por ejemplo:

```text
[5|3] → "3-5"
[3|5] → "3-5"
```

---

# 29. Estado de fichas utilizadas

Mantener un registro de las fichas que ya fueron colocadas.

Ejemplo:

```ts
const usedTiles = new Set<string>();
```

Antes de colocar una ficha:

```ts
if (usedTiles.has(tile.id)) {
    // ficha ya utilizada
}
```

Después de colocarla:

```ts
usedTiles.add(tile.id);
```

---

# 30. Separación entre lógica de juego y layout

No mezclar la lógica de:

```text
¿Puede jugar esta ficha?
```

con:

```text
¿Dónde debe dibujarse esta ficha?
```

La validación de jugadas debe ser independiente del algoritmo de posicionamiento.

Por ejemplo:

```ts
canPlaceTile(tile, end)
```

debe responder si la ficha puede conectarse.

Mientras:

```ts
calculateTilePosition(tile, end)
```

debe determinar dónde colocarla.

---

# 31. Funciones recomendadas

La implementación debería dividirse en funciones pequeñas.

Como mínimo considerar:

```ts
createDominoSet()
```

Crea las 28 fichas.

```ts
isDouble(tile)
```

Determina si una ficha es doble.

```ts
canConnect(tile, end)
```

Determina si una ficha puede conectarse con un extremo.

```ts
getTileOrientation(tile, direction)
```

Determina la orientación visual.

```ts
calculateConnectionPoint(tile, end)
```

Calcula el punto donde se conecta la ficha.

```ts
calculateTilePosition(tile, end)
```

Calcula la posición de la ficha.

```ts
calculateDoublePosition(tile, end)
```

Calcula específicamente la posición centrada y perpendicular de un doble.

```ts
shouldTurn(chain)
```

Determina si debe producirse un cruce.

```ts
getTurnDirection(end)
```

Determina hacia dónde debe girar el extremo.

```ts
checkCollision(position, placedTiles)
```

Comprueba colisiones.

```ts
placeTile(tile, end)
```

Coloca una ficha y actualiza el estado.

---

# 32. Regla fundamental del algoritmo

La prioridad de las reglas debe ser:

```text
CONEXIÓN
    ↓
DIRECCIÓN
    ↓
CRUCE
    ↓
ORIENTACIÓN
    ↓
POSICIÓN
    ↓
COLISIÓN
```

Una ficha nunca debe colocarse únicamente porque exista espacio visual.

Debe respetar primero las reglas del dominó.

---

# 33. Ejemplo conceptual completo

Supongamos que la línea alcanza 16 fichas:

```text
[1][2][3][4][5][6][7][8][9][10][11][12][13][14][15][16]
```

A partir de ese momento:

```text
                 [17]
                 [18]
                 [19]
                   |
[1][2][3]...[15][16]
```

Mientras el extremo contrario:

```text
                   |
[1][2][3]...[15][16]
                   |
                  [X]
                  [X]
```

debe crecer en la dirección vertical opuesta.

La representación exacta dependerá del sistema de coordenadas, pero la regla fundamental es:

```text
extremo izquierdo  → dirección vertical A
extremo derecho    → dirección vertical opuesta
```

---

# 34. Reglas para dobles después de un cruce

Los dobles deben seguir siendo perpendiculares a la dirección actual de la cadena.

Por ejemplo, si el extremo está creciendo:

```text
UP
```

un doble debe ser:

```text
────────
```

Si el extremo está creciendo:

```text
RIGHT
```

un doble debe ser:

```text
│
│
```

La perpendicularidad depende de la dirección actual, no de la dirección inicial de la partida.

---

# 35. No modificar la lógica de conexión por razones visuales

Si una ficha debe conectarse por un determinado extremo, su orientación visual puede cambiar.

Nunca modificar los valores internos de la ficha solamente para conseguir una orientación determinada.

Ejemplo:

```text
Ficha lógica:

[2|6]
```

Puede visualizarse como:

```text
[2|6]
```

o:

```text
[6|2]
```

pero continúa siendo:

```text
2-6
```

---

# 36. Resultado esperado

El algoritmo debe producir una colección de fichas posicionadas similar a:

```ts
[
    {
        tile: {...},
        x: ...,
        y: ...,
        rotation: ...,
        direction: ...
    },
    ...
]
```

La colección debe permitir al frontend renderizar directamente el tablero.

El frontend no debería tener que calcular:

* cruces
* posiciones
* orientación
* conexión
* separación
* colisiones.

Todo eso debe ser responsabilidad del sistema de ordenamiento.

---

# 37. Criterios de aceptación

La implementación será considerada correcta cuando:

* [ ] Existan exactamente 28 fichas únicas.
* [ ] La línea principal tenga al menos 16 fichas antes del primer cruce.
* [ ] La línea inicial sea horizontal.
* [ ] Las fichas se conecten correctamente.
* [ ] Los extremos puedan continuar la cadena.
* [ ] Los cruces sean de 90°.
* [ ] El giro se posponga si toca en una ficha doble o en una ficha pegada a una doble.
* [ ] El extremo izquierdo y derecho utilicen direcciones verticales opuestas.
* [ ] Las fichas dobles sean detectadas correctamente.
* [ ] Los dobles se coloquen inmediatamente después de la ficha anterior.
* [ ] Los dobles sean perpendiculares a la dirección de la cadena.
* [ ] Los dobles estén centrados respecto al punto de conexión.
* [ ] No existan solapamientos accidentales.
* [ ] Exista una separación uniforme entre fichas.
* [ ] Las fichas no salgan del área jugable.
* [ ] Una misma ficha no pueda colocarse dos veces.
* [ ] La lógica de posicionamiento sea independiente del renderizado.
* [ ] El sistema funcione independientemente de la resolución de pantalla.
* [ ] Las posiciones puedan convertirse posteriormente a coordenadas/píxeles del frontend.

---

# 37.1 Estabilidad del tablero al redibujar

La cadena debe construirse de forma **incremental**:

* El **ancla** es la **primera ficha de la ronda** (la semilla), nunca la "ficha central" del tablero actual.
* Las fichas nuevas se añaden **solo a los extremos** de la cadena ya existente.
* Las fichas ya colocadas **conservan siempre sus coordenadas de rejilla**: no se reordenan ni se re-anclan al crecer el tablero.

El renderizado debe usar un **marco fijo por ronda**:

* La **escala** (`tileH`) y el **origen** de render se calculan **una sola vez por ronda** a partir del tamaño del contenedor y de una cabida reservada típica del serpentín (una partida completa de 28 fichas suele ocupar ~40 unidades de ancho × ~26 de alto; el ancho puede crecer algo más si el giro se pospone por dobles).
* **Nunca** se recalculan al crecer la cadena (solo al redimensionar la ventana o al iniciar una ronda nueva).
* En consecuencia, la **posición en píxeles** de cada ficha ya dibujada no cambia durante toda la ronda.

Si la cadena crece más allá de la cabida reservada (partida extrema o ventana muy pequeña), el área del tablero permite **desplazarse** (scroll) para ver los extremos: la vista se mueve, no las fichas.

Criterios adicionales:

* [ ] Las fichas ya colocadas no cambian de posición al redibujar el tablero.
* [ ] El ancla de la cadena permanece fija durante toda la ronda.
* [ ] La escala y el origen de render se fijan al inicio de la ronda y solo se recalculan al redimensionar la ventana.
* [ ] Las fichas nuevas se añaden únicamente a los extremos de la cadena.

---

# 38. Regla de oro

La representación visual nunca debe romper la lógica del dominó.

El algoritmo debe priorizar siempre:

```text
1. Validez de la conexión
2. Continuidad de la cadena
3. Reglas de cruces
4. Reglas especiales de dobles
5. Espaciado
6. Colisiones
7. Límites del tablero
8. Representación visual
```

La finalidad es producir una cadena de dominó **válida, ordenada, simétrica en su comportamiento espacial, sin solapamientos y visualmente clara**.
