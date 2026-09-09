-- ============================================================
-- Datos personales: visibles por defecto, ocultables por persona
-- ============================================================
-- QUÉ ARREGLA
--
--   Tres tablas no cuelgan de ningún viaje y son del perfil, no del viaje:
--   documentos de viaje, plantillas de maleta y países visitados. Con
--   schema-perms.sql dejaron de verse para todo el mundo salvo su dueño, y eso
--   se pasó de frenada: lo normal es que quien viaja contigo vea el pasaporte y
--   la plantilla de maleta.
--
--   Se invierte: visibles por defecto, y ocultables una a una desde la pantalla
--   de administración. Lo mismo que ya se hace por viaje con `trip_shares`,
--   pero aquí por persona, porque el dato no es de ningún viaje.
--
-- REQUISITO
--
--   schema-perms.sql aplicado (y schema-auth.sql antes).
--
-- Es idempotente: se puede re-ejecutar sin miedo.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Qué le tapas a cada persona
-- ------------------------------------------------------------
-- Vacío = lo ve todo. Categorías: 'documentos', 'plantillas', 'paises'.
-- Va en app_users y no en trip_shares porque no depende del viaje.

alter table app_users
  add column if not exists ocultar_personales jsonb not null default '[]'::jsonb;


-- ------------------------------------------------------------
-- 2. ¿Puede esta persona ver esta categoría del dueño?
-- ------------------------------------------------------------
-- Lo propio siempre se ve. Lo del dueño, salvo que se lo hayas tapado.
--
-- SECURITY DEFINER: consulta app_users desde dentro de políticas que a su vez
-- la protegen. Sin esto sería recursivo.

create or replace function app_ve_personal(owner text, cat text) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select case
    when owner is null              then false
    when owner = app_profile()      then true       -- lo tuyo, siempre
    when app_profile() is null      then false      -- sin sesión, nada
    when owner = 'ruben'            then coalesce(
      (select not (ocultar_personales ? cat) from app_users where user_id = auth.uid()),
      false)
    else false                                      -- entre invitados, nada
  end;
$$;

revoke all on function app_ve_personal(text, text) from public;
grant execute on function app_ve_personal(text, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 3. Las tres tablas
-- ------------------------------------------------------------
-- Se tiran también los nombres heredados (`p_travel_docs` a secas, cmd ALL):
-- las políticas son permisivas y se suman con OR, así que dejar una viva sería
-- dejar abierta una puerta que las nuevas ya no controlan.
--
-- Escribir sigue siendo solo del dueño: que veas mi pasaporte no te deja
-- cambiarlo.

drop policy if exists p_travel_docs            on travel_docs;
drop policy if exists p_travel_docs_select     on travel_docs;
drop policy if exists p_travel_docs_modify     on travel_docs;
create policy p_travel_docs_select on travel_docs
  for select using (app_ve_personal(profile, 'documentos'));
create policy p_travel_docs_modify on travel_docs
  for all using (profile = app_profile()) with check (profile = app_profile());

drop policy if exists p_packing_templates        on packing_templates;
drop policy if exists p_packing_templates_select on packing_templates;
drop policy if exists p_packing_templates_modify on packing_templates;
create policy p_packing_templates_select on packing_templates
  for select using (app_ve_personal(profile, 'plantillas'));
create policy p_packing_templates_modify on packing_templates
  for all using (profile = app_profile()) with check (profile = app_profile());

drop policy if exists p_visited_countries        on visited_countries;
drop policy if exists p_visited_countries_select on visited_countries;
drop policy if exists p_visited_countries_modify on visited_countries;
create policy p_visited_countries_select on visited_countries
  for select using (app_ve_personal(profile, 'paises'));
create policy p_visited_countries_modify on visited_countries
  for all using (profile = app_profile()) with check (profile = app_profile());


-- ------------------------------------------------------------
-- 4. Comprobación
-- ------------------------------------------------------------
--   select user_id, profile, nombre, ocultar_personales from app_users;
--
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public'
--      and tablename in ('travel_docs','packing_templates','visited_countries')
--    order by tablename, policyname;
--
-- Debe haber un par _select/_modify por tabla y NINGUNA con el nombre corto.
-- La prueba de verdad: entra con la cuenta de Sergio y mira si aparecen los
-- documentos; luego tápaselos desde la pantalla de administración y recarga.
