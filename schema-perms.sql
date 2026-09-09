-- ============================================================
-- Permisos por viaje y por persona
-- ============================================================
-- QUÉ AÑADE
--
--   Hasta ahora el acceso era de todo o nada: Sergio leía TODOS los viajes de
--   Rubén, y nadie más entraba. Esto lo sustituye por concesiones explícitas:
--   una fila por (viaje, persona) que dice si puede leer, si puede editar y
--   qué categorías de datos se le ocultan.
--
--   El objetivo es que la app tenga una pantalla de administrador y que no
--   haya que volver a abrir el editor SQL para el día a día.
--
-- REQUISITO
--
--   schema-auth.sql aplicado. Todo esto se apoya en `auth.uid()` y en la
--   tabla `app_users`.
--
-- QUÉ NO HACE — LÉELO ANTES DE COMPARTIR NADA
--
--   Las categorías ocultan TABLAS ENTERAS, que es lo que la base sabe hacer
--   cumplir de verdad. NO tapan datos escritos a mano dentro de un texto
--   libre: un "N.º de confirmación: 4648869009" en las notas de una parada
--   sigue viéndose aunque ocultes 'reservas'. Postgres filtra filas y
--   columnas; no tacha trozos de un párrafo.
--
--   Sirve para gente de confianza con matices. No para alguien de quien no te
--   fíes. Para eso hace falta la redacción del texto libre, que la app ya sabe
--   hacer en JavaScript y que irá a una tabla aparte más adelante.
--
-- Es idempotente: se puede re-ejecutar sin miedo.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Las concesiones
-- ------------------------------------------------------------
-- `ocultar` lleva las categorías que esa persona NO ve en ese viaje, con los
-- mismos nombres que usará la pantalla de administrador:
--   'dinero'   -> budget_items, shared_expenses
--   'reservas' -> bookings (localizadores, documentos e importes de un golpe)
--   'diario'   -> diary
--   'maleta'   -> packing_items

create table if not exists trip_shares (
  trip_id    uuid not null references trips(id)      on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  can_edit   boolean not null default false,
  ocultar    jsonb   not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index if not exists trip_shares_user_idx on trip_shares(user_id);

alter table trip_shares enable row level security;


-- ------------------------------------------------------------
-- 2. Quién manda
-- ------------------------------------------------------------
-- Admin = el perfil dueño. Es quien reparte permisos y el único que ve la
-- lista completa de personas.

create or replace function app_is_admin() returns boolean
language sql stable as $$
  select coalesce(app_profile() = 'ruben', false);
$$;

revoke all on function app_is_admin() from public;
grant execute on function app_is_admin() to anon, authenticated;


-- ------------------------------------------------------------
-- 3. Lectura y escritura de un viaje concreto
-- ------------------------------------------------------------
-- SECURITY DEFINER por dos razones: para que la consulta a `trip_shares` no
-- dependa de la RLS de `trip_shares` cuando se llama desde dentro de otra
-- política (sería recursivo), y para que sea el mismo criterio en todas las
-- tablas hijas. search_path fijo, obligatorio en funciones definer.

create or replace function app_can_read_trip(t uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from trips  where id = t and profile = app_profile())
      or exists (select 1 from trip_shares where trip_id = t and user_id = auth.uid());
$$;

create or replace function app_can_edit_trip(t uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from trips  where id = t and profile = app_profile())
      or exists (select 1 from trip_shares
                  where trip_id = t and user_id = auth.uid() and can_edit);
$$;

-- ¿Esta persona tiene tapada esta categoría en este viaje?
-- El dueño no tiene fila en trip_shares, así que le devuelve false y lo ve todo.
create or replace function app_trip_hides(t uuid, cat text) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    (select ocultar ? cat from trip_shares where trip_id = t and user_id = auth.uid()),
    false);
$$;

revoke all on function app_can_read_trip(uuid) from public;
revoke all on function app_can_edit_trip(uuid) from public;
revoke all on function app_trip_hides(uuid, text) from public;
grant execute on function app_can_read_trip(uuid)   to anon, authenticated;
grant execute on function app_can_edit_trip(uuid)   to anon, authenticated;
grant execute on function app_trip_hides(uuid, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 4. Se acabó el "Sergio lo lee todo"
-- ------------------------------------------------------------
-- app_can_read() pasa a significar solo "estos datos son míos". El acceso de
-- Sergio a los viajes de Rubén deja de ser una regla escrita en código y pasa
-- a ser una lista de concesiones que se edita desde la app. Sigue usándose en
-- las tablas por perfil (packing_templates, travel_docs, visited_countries),
-- que no cuelgan de ningún viaje y son personales de cada uno.

create or replace function app_can_read(owner text) returns boolean
language sql stable as $$
  select owner is not null and owner = app_profile();
$$;


-- ------------------------------------------------------------
-- 5. Políticas de `trips`
-- ------------------------------------------------------------
-- Leer: los tuyos y los que te hayan compartido.
-- Modificar: los tuyos, y los compartidos con can_edit.
-- Crear y borrar: solo los tuyos. Que te dejen editar un viaje no te da
-- derecho a borrárselo a su dueño.

drop policy if exists p_trips_select on trips;
drop policy if exists p_trips_insert on trips;
drop policy if exists p_trips_update on trips;
drop policy if exists p_trips_delete on trips;

create policy p_trips_select on trips
  for select using (app_can_read(profile) or app_can_read_trip(id));
create policy p_trips_insert on trips
  for insert with check (profile = app_profile());
create policy p_trips_update on trips
  for update using (app_can_edit_trip(id)) with check (app_can_edit_trip(id));
create policy p_trips_delete on trips
  for delete using (profile = app_profile());


-- ------------------------------------------------------------
-- 6. Políticas de `trip_shares`
-- ------------------------------------------------------------
-- Cada cual ve lo que le han dado; el admin ve y edita todo. Sin la primera
-- regla, la app de un invitado no podría saber qué tiene tapado y pintaría
-- pestañas vacías en vez de esconderlas.

drop policy if exists p_trip_shares_select on trip_shares;
drop policy if exists p_trip_shares_admin  on trip_shares;

create policy p_trip_shares_select on trip_shares
  for select using (user_id = auth.uid() or app_is_admin());
create policy p_trip_shares_admin on trip_shares
  for all using (app_is_admin()) with check (app_is_admin());


-- ------------------------------------------------------------
-- 7. `app_users` visible para el admin
-- ------------------------------------------------------------
-- La pantalla de administrador necesita la lista de personas. El correo no
-- está aquí (vive en auth.users, que no se expone), lo trae la Edge Function.

drop policy if exists p_app_users_self  on app_users;
drop policy if exists p_app_users_admin on app_users;

create policy p_app_users_self on app_users
  for select using (user_id = auth.uid() or app_is_admin());
create policy p_app_users_admin on app_users
  for all using (app_is_admin()) with check (app_is_admin());

-- Las cuentas invitadas necesitan su propia fila de perfil: sin ella
-- app_profile() es NULL y la app las echa al entrar.
alter table app_users drop constraint if exists app_users_profile_check;
alter table app_users add  constraint app_users_profile_check
  check (profile in ('ruben', 'sergio', 'invitado'));


-- ------------------------------------------------------------
-- 8. Tablas hijas
-- ------------------------------------------------------------
-- Todas cuelgan de un viaje, así que su permiso es el del viaje. Las que
-- llevan una categoría asociada se caen enteras cuando esa categoría está
-- tapada para quien pregunta.

do $$
declare
  t text;
  cat text;
  -- tabla -> categoría que la oculta (null = no se puede ocultar)
  cats jsonb := '{
    "budget_items":    "dinero",
    "shared_expenses": "dinero",
    "bookings":        "reservas",
    "diary":           "diario",
    "packing_items":   "maleta"
  }'::jsonb;
  filtro text;
begin
  for t in select unnest(array[
    'trip_legs','planning_items','budget_items','bookings','inquiries',
    'wishlist_items','day_notes','packing_items',
    'addresses','destination_info','emergency_contacts','phrases',
    'shared_expenses','diary',
    'wardrobe_items','wardrobe_catalog'
  ]) loop
    cat := cats ->> t;
    filtro := case when cat is null then ''
                   else format(' and not app_trip_hides(%I.trip_id, %L)', t, cat) end;

    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists p_%I on %I;',        t, t);
    execute format('drop policy if exists p_%I_select on %I;', t, t);
    execute format('drop policy if exists p_%I_modify on %I;', t, t);

    execute format(
      'create policy p_%I_select on %I for select using (app_can_read_trip(%I.trip_id)%s);',
      t, t, t, filtro);

    -- Modificar no mira las categorías: quien puede editar, edita. Lo que no
    -- ve, tampoco lo va a tocar, porque ni siquiera le llega.
    execute format(
      'create policy p_%I_modify on %I for all using (app_can_edit_trip(%I.trip_id))'
      || ' with check (app_can_edit_trip(%I.trip_id));',
      t, t, t, t);
  end loop;
end$$;


-- ------------------------------------------------------------
-- 9. Migración: conservar lo que Sergio ya veía
-- ------------------------------------------------------------
-- Antes leía todos los viajes de Rubén por una regla fija. Se convierte en
-- concesiones de solo lectura, una por viaje, para que no pierda el acceso al
-- ejecutar esto. Desde la pantalla de administrador se ajustan una a una.
--
-- Re-ejecutable: no pisa lo que ya hayas cambiado a mano.

insert into trip_shares (trip_id, user_id, can_edit, ocultar)
select t.id, a.user_id, false, '[]'::jsonb
  from trips t
  cross join app_users a
 where t.profile = 'ruben'
   and a.profile = 'sergio'
   and t.deleted_at is null
on conflict (trip_id, user_id) do nothing;


-- ------------------------------------------------------------
-- 10. Comprobación
-- ------------------------------------------------------------
-- Desde el editor SQL se ejecuta como superusuario y la RLS ni se aplica, así
-- que esto solo confirma que las piezas están puestas:
--
--   select count(*) from trip_shares;
--   select proname, prosecdef from pg_proc
--    where proname in ('app_is_admin','app_can_read_trip','app_can_edit_trip','app_trip_hides');
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename in ('trips','trip_shares','bookings')
--    order by tablename, policyname;
--
-- La prueba de verdad es entrar en la app con una cuenta invitada y ver que
-- solo aparecen sus viajes, y que las pestañas tapadas no traen datos.
