-- ============================================================
-- Cierre de la RLS — de cabecera declarada a sesión autenticada
-- ============================================================
-- PROBLEMA QUE ARREGLA
--
--   El modelo anterior identificaba al usuario con la cabecera HTTP
--   `x-app-profile`, que la elige el cliente, y con la `anonKey` publicada
--   en index.html. Cualquiera podía leer TODO con una sola petición:
--
--     curl "$URL/rest/v1/trips?select=*" \
--       -H "apikey: <anon>" -H "x-app-profile: ruben"
--
--   Quitar el perfil 'invitado' de app_can_read() NO lo arreglaba: la rama
--   `owner = app_profile()` seguía abierta a quien declarase ser 'ruben'.
--   Un secreto que viaja en el HTML público no es un secreto: el único
--   cierre real es una sesión de Supabase Auth, cuyo JWT lo firma el
--   servidor y no se puede inventar desde el cliente.
--
-- QUÉ CAMBIA
--
--   Solo las dos funciones que ya usaban todas las políticas. Las ~40
--   políticas de RLS de schema.sql se quedan como están.
--
--     app_profile()      cabecera x-app-profile  ->  perfil del usuario con sesión
--     app_can_read()     'invitado' lee lo de 'ruben'  ->  solo perfiles reales
--
-- ORDEN DE APLICACIÓN (importante)
--
--   1. Crear los usuarios en Supabase (Authentication -> Users).
--   2. Publicar la versión de la app que inicia sesión. Mientras tanto sigue
--      mandando la cabecera, así que funciona con la RLS vieja: sin cortes.
--   3. Ejecutar ESTE archivo.
--
--   Si prefieres cerrar YA y asumir que la sincronización deja de funcionar
--   hasta que llegue el paso 2, ejecuta este archivo primero. La app es
--   local-first: IndexedDB sigue intacto y no se pierde nada, solo se para
--   la sincronización entre dispositivos.
--
-- Es idempotente: se puede re-ejecutar sin miedo.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Mapa cuenta de Auth -> perfil de la app
-- ------------------------------------------------------------
-- La columna `profile` de las tablas no cambia: sigue siendo la etiqueta de
-- propiedad de cada fila. Lo que cambia es de dónde sale el perfil activo.

create table if not exists app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile text not null unique check (profile in ('ruben', 'sergio')),
  created_at timestamptz not null default now()
);

alter table app_users enable row level security;

-- Cada cual ve solo su propia fila. Nadie escribe aquí desde la app: las
-- altas se hacen a mano en el editor SQL (son dos, y no cambian).
drop policy if exists p_app_users_self on app_users;
create policy p_app_users_self on app_users
  for select using (user_id = auth.uid());


-- ------------------------------------------------------------
-- 2. Perfil activo = el de la sesión, no el que diga el cliente
-- ------------------------------------------------------------
-- SECURITY DEFINER para que la consulta a app_users no dependa de la RLS de
-- app_users cuando se llama desde dentro de otra política. `search_path` fijo
-- es obligatorio en funciones definer: sin él, un search_path manipulado
-- podría resolver `app_users` a otra tabla.
--
-- Sin sesión devuelve NULL — no 'invitado'. Y NULL no casa con nada.

create or replace function app_profile() returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select profile from app_users where user_id = auth.uid();
$$;

revoke all on function app_profile() from public;
grant execute on function app_profile() to anon, authenticated;


-- ------------------------------------------------------------
-- 3. Quién puede leer los datos de quién
-- ------------------------------------------------------------
-- Se conserva la regla de negocio anterior — Sergio es lector de los viajes
-- de Rubén — y desaparece 'invitado', que era la puerta abierta.
--
-- `owner is not null and p is not null` es explícito a propósito: en SQL,
-- `null = null` es NULL, no true, y NULL en un USING de RLS se trata como
-- falso; se deja escrito para que no dependa de recordar esa sutileza.

create or replace function app_can_read(owner text) returns boolean
language sql
stable
as $$
  select case
    when owner is null then false
    else coalesce(
      case app_profile()
        when 'ruben'  then owner = 'ruben'
        when 'sergio' then owner in ('sergio', 'ruben')
        else false
      end, false)
  end;
$$;

revoke all on function app_can_read(text) from public;
grant execute on function app_can_read(text) to anon, authenticated;


-- ------------------------------------------------------------
-- 4. Dar de alta los dos perfiles
-- ------------------------------------------------------------
-- Crea antes las cuentas en Supabase -> Authentication -> Users -> Add user
-- (marcando "Auto Confirm User"), y luego descomenta y ajusta los correos.
--
-- insert into app_users (user_id, profile)
-- select id, 'ruben'  from auth.users where email = 'benteslez@gmail.com'
-- on conflict (user_id) do update set profile = excluded.profile;
--
-- insert into app_users (user_id, profile)
-- select id, 'sergio' from auth.users where email = 'CORREO_DE_SERGIO'
-- on conflict (user_id) do update set profile = excluded.profile;


-- ------------------------------------------------------------
-- 5. Comprobación
-- ------------------------------------------------------------
-- Desde el editor SQL de Supabase estas dos consultas se ejecutan como
-- superusuario y NO sirven para validar la RLS. La prueba buena es desde
-- fuera, con la anon key y sin sesión: debe devolver [].
--
--   curl "https://<proyecto>.supabase.co/rest/v1/trips?select=name" \
--     -H "apikey: <anon_key>"
--   curl "https://<proyecto>.supabase.co/rest/v1/trips?select=name" \
--     -H "apikey: <anon_key>" -H "x-app-profile: ruben"
--
-- Las dos deben responder [] (lista vacía). Si alguna devuelve nombres de
-- viajes, la migración no se ha aplicado.
