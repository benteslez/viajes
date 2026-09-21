-- ============================================================
-- Armario del bebé "Pablo" — solo las tablas nuevas (idempotente)
-- ============================================================
-- Pégalo en el SQL editor de Supabase y pulsa "Run".
-- Es seguro re-ejecutarlo: no borra datos.
--
-- Es autosuficiente: si alguna de las funciones auxiliares que usa
-- (app_profile, app_can_read, touch_updated_at) no existe, la crea.
-- ============================================================

-- 0) Funciones auxiliares -------------------------------------
-- SOLO SI NO EXISTEN, nunca `create or replace`.
--
-- Aquí ponía `create or replace` "porque no rompe nada si ya existen", y sí
-- rompía: `schema-auth.sql` y `schema-perms.sql` redefinen `app_profile()` y
-- `app_can_read()` con otra lógica —el perfil sale de la sesión, no de una
-- cabecera que elige el cliente—, así que reejecutar esto las devolvía a la
-- versión vieja. `app_profile()` empezaba a responder 'invitado' y la RLS
-- rechazaba TODA escritura: "new row violates row-level security policy".
-- Pasó de verdad, con `schema-ui-prefs.sql`, que copió esto mismo de aquí.
-- El arreglo está en `schema-arreglo-funciones.sql`.
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

  if to_regprocedure('public.app_can_read(text)') is null then
    execute $f$
      create function app_can_read(owner text) returns boolean
      language sql stable as $q$
        select owner = app_profile()
            or (app_profile() in ('sergio','invitado') and owner = 'ruben');
      $q$;
    $f$;
    raise notice 'app_can_read() no existía: creada la versión mínima. Ejecuta schema-perms.sql.';
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

-- 1) Tablas ---------------------------------------------------
create table if not exists wardrobe_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  prenda text not null,
  tipo text not null,
  talla text not null,
  qty int not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists wardrobe_items_trip_idx on wardrobe_items(trip_id);

create table if not exists wardrobe_catalog (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  prendas jsonb not null default '[]'::jsonb,
  tipos   jsonb not null default '{}'::jsonb,
  tallas  jsonb not null default '[]'::jsonb,
  checklist jsonb not null default '{}'::jsonb,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists wardrobe_catalog_trip_idx on wardrobe_catalog(trip_id);
alter table if exists wardrobe_catalog add column if not exists checklist jsonb not null default '{}'::jsonb;
alter table if exists wardrobe_catalog add column if not exists prefs jsonb not null default '{}'::jsonb;

-- 2) Trigger updated_at --------------------------------------
do $$
declare t text;
begin
  for t in select unnest(array['wardrobe_items','wardrobe_catalog']) loop
    execute format(
      'drop trigger if exists trg_touch_%I on %I;
       create trigger trg_touch_%I before update on %I
       for each row execute function touch_updated_at();',
      t, t, t, t);
  end loop;
end$$;

-- 3) RLS por-trip --------------------------------------------
-- SELECT: cualquiera que pueda leer el trip. MODIFY: solo el dueño del trip.
do $$
declare t text;
begin
  for t in select unnest(array['wardrobe_items','wardrobe_catalog']) loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists p_%I_select on %I;', t, t);
    execute format('drop policy if exists p_%I_modify on %I;', t, t);
    execute format($p$
      create policy p_%I_select on %I
        for select using (
          exists (select 1 from trips
                  where trips.id = %I.trip_id
                  and app_can_read(trips.profile))
        );
    $p$, t, t, t);
    execute format($p$
      create policy p_%I_modify on %I
        for all using (
          exists (select 1 from trips
                  where trips.id = %I.trip_id
                  and trips.profile = app_profile())
        ) with check (
          exists (select 1 from trips
                  where trips.id = %I.trip_id
                  and trips.profile = app_profile())
        );
    $p$, t, t, t, t);
  end loop;
end$$;
