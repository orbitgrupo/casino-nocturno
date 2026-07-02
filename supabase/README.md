# Configuración de Supabase

1. Crea un proyecto en Supabase.
2. Activa **Authentication → Providers → Anonymous Sign-Ins**.
3. Abre **SQL Editor**, pega y ejecuta `migrations/202607020001_invitation_rooms.sql`.
4. Copia la **Project URL** y la **Publishable key** en `js/supabase-config.js`.
5. No uses `service_role` ni una secret key en archivos del navegador.

La migración crea perfiles, salas, participantes, códigos de invitación, RLS, suscripciones Realtime y funciones protegidas para crear/unirse, administrar créditos, expulsar participantes y cambiar el estado de la sala.

Esta etapa implementa la antesala. La sincronización y validación servidor-autoritativa de cada jugada debe añadirse posteriormente mediante Edge Functions; el campo `game_state` y `state_version` quedan reservados para ello.
