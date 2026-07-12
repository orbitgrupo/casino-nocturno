# Casino Nocturno

Mini casino responsivo construido con HTML, CSS y JavaScript puro, con partidas locales y servicios online mediante Supabase.

> Todos los saldos son créditos ficticios. Este proyecto no utiliza ni entrega dinero real.

## Juegos

- **Blackjack:** mesa para personas y bots, apuestas, rendición y dealer manual o automático.
- **Ruleta:** variantes europea y americana, rueda numerada y apuestas interiores y exteriores.
- **Tres y Dos:** cinco participantes, premios secundarios opcionales, manos ordenables y bots.
- **Dominó:** doble-seis clásico por parejas y Pintintín individual, con manos reordenables mediante arrastrar y soltar.
- **Póker:** Texas Hold’em local con cartas comunitarias, apuestas y cuatro bots.
- **Dados:** juego local tipo craps con línea de pase, no pase, campo, craps, once y hardways.

Los seis juegos comparten tres diseños visuales: Casino clásico, Esmeralda circular y Nocturno moderno. Las preferencias y partidas locales se guardan mediante `localStorage`.

## Círculo de confianza

El acceso online es privado. La administración crea cada perfil y recibe una invitación de acceso de un solo uso junto con una clave de recuperación. Los códigos vencen, se almacenan únicamente como hash y el dashboard permite renovar o revocar el acceso. Tras cinco intentos fallidos, el dispositivo queda bloqueado temporalmente.

## Ejecutar localmente

No necesita instalación. Abre `index.html` en un navegador moderno.

Para comprobar la lógica con Node.js:

```bash
npm test
```

## Publicar en GitHub Pages o servidor propio

1. Crea un repositorio nuevo y sube el contenido completo de esta carpeta.
2. Publica la carpeta raíz como sitio estático.
3. Si usas Nginx, copia los archivos al directorio público configurado.
4. Si usas Supabase, ejecuta primero las migraciones pendientes.

Todos los enlaces son relativos y el archivo `.nojekyll` está incluido, por lo que no se requiere un proceso de compilación.

## Estructura

```text
index.html             Vestíbulo del casino
blackjack.html         Blackjack
roulette.html          Ruleta
tres-y-dos.html        Tres y Dos
domino.html            Dominó
poker.html             Póker
dados.html             Dados
css/                   Diseños y estilos responsivos
js/                    Lógica e interfaz de los juegos
tests/                 Pruebas de Blackjack y mesa
```

## Estado del proyecto

Los juegos siguen funcionando localmente. Además, cada mesa incluye una antesala opcional preparada para Supabase con códigos de invitación, anfitrión jugador o moderador, participantes en tiempo real y administración protegida de créditos.

Para activarla, sigue [las instrucciones de Supabase](supabase/README.md). Hasta configurar la URL, la clave publicable, Auth anónimo y la migración SQL, el botón **Sala online** mostrará el estado pendiente de configuración.

Dominó dispone de asientos, manos privadas, turnos y bots sincronizados mediante funciones protegidas de Supabase. Dados queda preparado para sala online y control de participantes; la lógica actual del lanzamiento es local.

## Licencia

No se ha concedido una licencia de reutilización. Antes de publicar, el propietario puede elegir una licencia como MIT si desea permitir copias, modificaciones y redistribución.
