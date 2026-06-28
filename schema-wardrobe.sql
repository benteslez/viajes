-- ============================================================
-- Armario del bebé "Pablo" — solo las tablas nuevas (idempotente)
-- ============================================================
-- Pégalo en el SQL editor de Supabase y pulsa "Run".
-- Es seguro re-ejecutarlo: no borra datos.
--
-- Es autosuficiente: crea también las funciones auxiliares que usa
-- (app_profile, app_can_read, touch_updated_at) por si tu DB se montó
-- con una versión antigua de schema.sql que no las tenía. Todas las
-- funciones van con CREATE OR REPLACE, así que no rompen nada si ya existen.
-- ============================================================

-- 0) Funciones auxiliares (idempotentes) ---------------------
create or replace function app_profile() returns text
language sql stable as $$
  select coalesce(
    current_setting('request.headers', true)::jsonb ->> 'x-app-profile',
    'invitado'
  );
$$;

create or replace function app_can_read(owner text) returns boolean
language sql stable as $$
  select owner = app_profile()
      or (app_profile() in ('sergio','invitado') and owner = 'ruben');
$$;

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

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
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists wardrobe_catalog_trip_idx on wardrobe_catalog(trip_id);

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
