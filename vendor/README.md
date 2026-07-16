# Librería local de LiveKit

El cliente de voz busca este archivo:

```text
vendor/livekit-client.umd.min.js
```

No se incluye automáticamente porque es una dependencia externa. En el servidor, cópialo desde una instalación controlada de `livekit-client` o genera un bundle local y súbelo a esta carpeta.

Mientras el archivo no exista, el botón de voz aparecerá pero mostrará que falta la librería.
