-- ============================================================
-- ui_prefs — cómo quiere ver la app cada persona (idempotente)
-- ============================================================
-- Pégalo en el SQL editor de Supabase y pulsa "Run".
-- Es seguro re-ejecutarlo: no borra datos.
--
-- QUÉ ARREGLA
--
--   Todo lo que la app recordaba de la interfaz vivía en localStorage y, por
--   tanto, en un solo aparato: el tema, el último perfil, el orden de la
--   pantalla de administración. Eso vale para lo que es del dispositivo.
--
--   No vale para cómo quieres ver la app. Si reordenas los bloques de la ficha
--   de una parada en el móvil —para poner las notas arriba del todo, por
--   ejemplo—, en el portátil salían en el orden de fábrica. Esta tabla guarda
--   esas preferencias por perfil y las sincroniza como cualquier otro dato.
--
--   Una fila por perfil con un jsonb dentro (`data`). Las claves las pone la
--   app, no el esquema: añadir una preferencia nueva no vuelve a tocar SQL.
--
-- SI NO LO EJECUTAS
--
--   La app funciona igual, pero la preferencia se queda en el dispositivo. Las
--   filas esperan en la cola de subida sin atascar al resto —la app trata "esa
--   tabla no existe" como error permanente, no como un fallo de red— y suben
--   solas el día que se ejecute esto.
--
-- ============================================================


-- 0) Funciones auxiliares -------------------------------------
-- SOLO SI NO EXISTEN, nunca `create or replace`.
--
-- Esto ya salió caro una vez: este archivo llegó copiando de
-- `schema-wardrobe.sql` un `create or replace` de las dos, "por si la base era
-- antigua". Pero `schema-auth.sql` y `schema-autoria.sql` las habían
-- redefinido después con otra lógica, así que ejecutarlo las devolvió a la
-- versión vieja: `app_profile()` pasó a leer una cabecera que la app ya no
-- manda, devolvía 'invitado' y la RLS empezó a rechazar TODA escritura
-- ("new row violates row-level security policy"). El arreglo está en
-- `schema-arreglo-funciones.sql`.
--
-- Una migración pequeña no tiene por qué saber cuál es la versión buena de una
-- función que no es suya. Si falta, se crea lo mínimo; si está, no se toca.

do $$
begin
  if to_regprocedure('public.app_profile()') is null then
    execute $f$
      create function app_profile() returns text
      language sql stable as $q$
        select coalesce(
          current_setting('request.headers', true)::jsonb ->> 'x-app-profile',
          'invitado'
        );
      $q$;
    $f$;
    raise notice 'app_profile() no existía: creada la versión mínima. Ejecuta schema-auth.sql.';
  end if;

  if to_regprocedure('public.touch_updated_at()') is null then
    execute $f$
      create function touch_updated_at() returns trigger
      language plpgsql as $q$
      begin
        new.updated_at := now();
        return new;
      end;
      $q$;
    $f$;
    raise notice 'touch_updated_at() no existía: creada.';
  end if;
end$$;

-- 1) La tabla -------------------------------------------------
-- `id` es texto, no uuid: la app usa una clave legible por perfil
-- ('prefs-ruben'). Eso es lo que hace que haya UNA fila por persona y no una
-- por dispositivo, que es justo lo que se quiere sincronizar.
-- `deleted_at` va por simetría con el resto: la app borra en suave en todas
-- partes y el pull espera encontrarlo.

create table if not exists ui_prefs (
  id text primary key,
  profile text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists ui_prefs_profile_idx on ui_prefs(profile);
alter table if exists ui_prefs add column if not exists updated_by uuid;

-- 2) Trigger updated_at --------------------------------------
-- El pull es incremental (`updated_at > último sync`): sin esto, una fila
-- cambiada en otro dispositivo no volvería nunca.
drop trigger if exists trg_touch_ui_prefs on ui_prefs;
create trigger trg_touch_ui_prefs before insert or update on ui_prefs
  for each row execute function touch_updated_at();

-- 3) RLS ------------------------------------------------------
-- A diferencia del pasaporte o la plantilla de maleta, esto NO se comparte:
-- es de quien mira. Que viajes conmigo no te da mi disposición de la ficha, ni
-- a mí la tuya. Por eso aquí no hay `app_can_read`: lo tuyo y solo lo tuyo,
-- para leer y para escribir.

alter table ui_prefs enable row level security;
drop policy if exists p_ui_prefs        on ui_prefs;
drop policy if exists p_ui_prefs_propio on ui_prefs;
create policy p_ui_prefs_propio on ui_prefs
  for all using (profile = app_profile())
          with check (profile = app_profile());

-- 4) Comprobación ---------------------------------------------
--   select id, profile, data, updated_at from ui_prefs;
--
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'ui_prefs';
--
-- La prueba de verdad: reordena los bloques de la ficha en un dispositivo,
-- espera a que el indicador diga "Sincronizado" y abre la misma parada en otro.
