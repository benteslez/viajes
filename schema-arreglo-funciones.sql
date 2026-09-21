-- ============================================================
-- ARREGLO — devolver app_profile() y touch_updated_at() a su sitio
-- ============================================================
-- Pégalo entero en el SQL editor de Supabase y pulsa "Run".
-- Es idempotente y no toca ni una fila de datos.
--
-- QUÉ PASÓ
--
--   `schema-ui-prefs.sql` traía, copiadas de `schema-wardrobe.sql`, un
--   `create or replace` de estas dos funciones "por si la base se montó con una
--   versión antigua del esquema". El problema es que no eran las mismas
--   funciones: `schema-auth.sql` y `schema-autoria.sql` las habían redefinido
--   DESPUÉS con otra lógica, y ejecutar aquello las dejó en la versión vieja.
--
--   `app_profile()` volvió a leer una cabecera `x-app-profile` que la app ya no
--   manda —el perfil sale del JWT desde `schema-auth.sql`—, así que devolvía
--   'invitado' para todo el mundo. Con eso, la RLS de cualquier tabla hija
--   rechaza las escrituras:
--
--     new row violates row-level security policy for table "planning_items"
--
--   `touch_updated_at()` dejó de sellar `updated_by`, así que lo editado se
--   guardaba sin autor. Eso no daba ningún error: se perdía en silencio.
--
-- QUÉ HACE ESTE ARCHIVO
--
--   Devolver las dos a la versión que corresponde a ESTA instancia, mirando qué
--   hay montado en vez de suponerlo. Al terminar imprime cómo quedan.
--
--   Después, vuelve a la app: la cola de cambios sube sola en cuanto haya red.
-- ============================================================


-- ------------------------------------------------------------
-- 1. app_profile()
-- ------------------------------------------------------------
-- Con `app_users` montada (schema-auth.sql), el perfil sale de la sesión y no
-- de nada que el cliente pueda elegir. Sin ella, la instancia es de las de
-- antes y se queda con la cabecera, que es lo único que hay.

do $$
begin
  if to_regclass('public.app_users') is not null then
    execute $f$
      create or replace function app_profile() returns text
      language sql stable security definer set search_path = public, auth as $q$
        select profile from app_users where user_id = auth.uid();
      $q$;
    $f$;
    revoke all on function app_profile() from public;
    grant execute on function app_profile() to anon, authenticated;
    raise notice 'app_profile(): versión con sesión (app_users + auth.uid())';
  else
    execute $f$
      create or replace function app_profile() returns text
      language sql stable as $q$
        select coalesce(
          current_setting('request.headers', true)::jsonb ->> 'x-app-profile',
          'invitado'
        );
      $q$;
    $f$;
    raise notice 'app_profile(): versión por cabecera (esta instancia no tiene app_users)';
  end if;
end$$;


-- ------------------------------------------------------------
-- 2. touch_updated_at()
-- ------------------------------------------------------------
-- Aquí la versión buena depende de cuándo dispara el trigger, no de si hay
-- `updated_by`. Desde `schema.sql` (y `schema-touch-insert.sql`) los
-- `trg_touch_*` son `before insert or update`, y en un INSERT `old` no existe:
-- la versión de `schema-autoria.sql`, que hace `coalesce(auth.uid(), old.updated_by)`
-- a secas, reventaría todas las altas. Por eso lo que hay montado en una
-- instancia al día es la versión simple, y es la que se devuelve.
--
-- Si esta base es de las antiguas —triggers solo en UPDATE— sí toca la de
-- autoría, que es la que tenía.

do $$
declare en_insert boolean;
declare hay_autor boolean;
begin
  select exists (
    select 1 from pg_trigger g
     where not g.tgisinternal
       and g.tgname like 'trg_touch_%'
       and (g.tgtype & 4) <> 0          -- bit de INSERT
  ) into en_insert;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'trips' and column_name = 'updated_by'
  ) into hay_autor;

  if en_insert or not hay_autor then
    execute $f$
      create or replace function touch_updated_at() returns trigger
      language plpgsql as $q$
      begin
        new.updated_at := now();
        return new;
      end;
      $q$;
    $f$;
    raise notice 'touch_updated_at(): versión simple (los trg_touch_* también sellan el INSERT)';
  else
    execute $f$
      create or replace function touch_updated_at() returns trigger
      language plpgsql as $q$
      begin
        new.updated_at := now();
        -- coalesce con lo que hubiera: una migración desde el editor SQL no
        -- tiene sesión, y poner NULL ahí borraría el autor anterior.
        new.updated_by := coalesce(auth.uid(), old.updated_by);
        return new;
      end;
      $q$;
    $f$;
    raise notice 'touch_updated_at(): versión con autoría (esta base tiene los triggers solo en UPDATE)';
  end if;
end$$;


-- ------------------------------------------------------------
-- 3. Cómo han quedado
-- ------------------------------------------------------------
-- Esto sí devuelve filas: son las dos funciones, para poder mirarlas.
--
--   app_profile debe decir "select profile from app_users where user_id = auth.uid()"
--   si tu base tiene schema-auth.sql aplicado (que es lo normal).

select p.proname as funcion, pg_get_functiondef(p.oid) as definicion
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('app_profile', 'touch_updated_at')
 order by p.proname;
