# Casino Nocturno

Mini casino local y responsivo construido con HTML, CSS y JavaScript puro. Funciona sin backend, dependencias externas ni conexión a internet.

> Todos los saldos son créditos ficticios. Este proyecto no utiliza ni entrega dinero real.

## Juegos

- **Blackjack:** mesa para personas y bots, apuestas, rendición y dealer manual o automático.
- **Ruleta:** variantes europea y americana, rueda numerada y apuestas interiores y exteriores.
- **Tres y Dos:** cinco participantes, premios secundarios opcionales, manos ordenables y bots.
- **Dominó:** doble-seis clásico por parejas y Pintintín individual, con manos reordenables mediante arrastrar y soltar.

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

Los juegos siguen funcionando localmente. Además, cada mesa incluye una antesala opcional preparada para Supabase con códigos de invitación, anfitrión jugador o moderador, participantes en tiempo real y administración protegida de créditos.

Para activarla, sigue [las instrucciones de Supabase](supabase/README.md). Hasta configurar la URL, la clave publicable, Auth anónimo y la migración SQL, el botón **Sala online** mostrará el estado pendiente de configuración.

La antesala no sincroniza todavía las jugadas. La validación servidor-autoritativa de las reglas y el estado compartido de cada partida corresponde a la siguiente etapa mediante Supabase Edge Functions.

## Licencia

No se ha concedido una licencia de reutilización. Antes de publicar, el propietario puede elegir una licencia como MIT si desea permitir copias, modificaciones y redistribución.
