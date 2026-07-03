# Configuración de Supabase

1. Crea un proyecto en Supabase.
2. Activa **Authentication → Providers → Anonymous Sign-Ins**.
3. Abre **SQL Editor** y ejecuta, en orden:
   - `migrations/202607020001_invitation_rooms.sql`
   - `migrations/202607020002_player_profiles.sql`
   - `migrations/202607020003_admin_dashboard.sql`
   - `migrations/202607020004_profile_code_hotfix.sql`
   - `migrations/202607020005_wallet_history_notifications.sql`
   - `migrations/202607020006_poker_rooms.sql`
   - `migrations/202607020007_online_domino.sql`
   - `migrations/202607030008_admin_points_and_invites.sql`
   - `migrations/202607030009_room_admin_controls.sql`
   - `migrations/202607030010_join_active_rooms.sql`
   - `migrations/202607030011_join_room_ambiguity_hotfix.sql`
   - `migrations/202607030012_join_room_return_type_hotfix.sql`
   - `migrations/202607030013_domino_team_builder.sql`
   - `migrations/202607030014_numbered_lineup_and_spectators.sql`
4. Copia la **Project URL** y la **Publishable key** en `js/supabase-config.js`.
5. No uses `service_role` ni una secret key en archivos del navegador.

La migración crea perfiles, salas, participantes, códigos de invitación, RLS, suscripciones Realtime y funciones protegidas para crear/unirse, administrar créditos, expulsar participantes y cambiar el estado de la sala.

Esta etapa implementa la antesala. La sincronización y validación servidor-autoritativa de cada jugada debe añadirse posteriormente mediante Edge Functions; el campo `game_state` y `state_version` quedan reservados para ello.
