# Casino Nocturno

Mini casino local y responsivo construido con HTML, CSS y JavaScript puro. Funciona sin backend, dependencias externas ni conexión a internet.

> Todos los saldos son créditos ficticios. Este proyecto no utiliza ni entrega dinero real.

## Juegos

- **Blackjack:** mesa para personas y bots, apuestas, rendición y dealer manual o automático.
- **Ruleta:** variantes europea y americana, rueda numerada y apuestas interiores y exteriores.
- **Tres y Dos:** cinco participantes, premios secundarios opcionales, manos ordenables y bots.
- **Dominó:** doble-seis clásico por parejas y Pintintín individual.

Los cuatro juegos comparten tres diseños visuales: Casino clásico, Esmeralda circular y Nocturno moderno. Las preferencias y partidas locales se guardan mediante `localStorage`.

## Ejecutar localmente

No necesita instalación. Abre `index.html` en un navegador moderno.

Para comprobar la lógica con Node.js:

```bash
npm test
```

## Publicar en GitHub Pages

1. Crea un repositorio nuevo y sube el contenido completo de esta carpeta.
2. En el repositorio, abre **Settings → Pages**.
3. Selecciona **Deploy from a branch**.
4. Elige la rama `main`, carpeta `/ (root)`, y guarda.
5. GitHub mostrará la dirección pública cuando termine la publicación.

Todos los enlaces son relativos y el archivo `.nojekyll` está incluido, por lo que no se requiere un proceso de compilación.

## Estructura

```text
index.html             Vestíbulo del casino
blackjack.html         Blackjack
roulette.html          Ruleta
tres-y-dos.html        Tres y Dos
domino.html            Dominó
css/                    Diseños y estilos responsivos
js/                     Lógica e interfaz de los juegos
tests/                  Pruebas de Blackjack y mesa
```

## Estado del proyecto

Esta versión funciona de forma local en una sola pantalla. La arquitectura del Blackjack deja preparado un gateway para añadir salas con códigos de invitación mediante un servidor en una versión futura.

## Licencia

No se ha concedido una licencia de reutilización. Antes de publicar, el propietario puede elegir una licencia como MIT si desea permitir copias, modificaciones y redistribución.
