-- ============================================================
-- App de viajes — Esquema Supabase
-- ============================================================
-- Modelo local-first: IndexedDB es la fuente de verdad operativa.
-- Supabase es la capa de sincronización entre dispositivos.
-- No hay auth real: 3 perfiles fijos (Rubén, Sergio, Invitado) identificados
-- por la columna `profile`. La RLS se basa en una cabecera personalizada
-- "x-app-profile" enviada desde el cliente (ver README).
-- ============================================================

-- Helper: leer perfil activo de la cabecera (o claim JWT custom)
create or replace function app_profile() returns text
language sql stable as $$
  select coalesce(
    current_setting('request.headers', true)::jsonb ->> 'x-app-profile',
    'invitado'
  );
$$;

-- ============================================================
-- TABLAS
-- ============================================================

create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  profile text not null,
  name text not null,
  country text,
  city text,
  cover_photo_url text,
  start_date date,
  end_date date,
  in_preparation boolean not null default false,
  default_currency text not null default 'EUR',
  is_shared boolean not null default false,
  is_multi_destino boolean not null default false,
  budget_target numeric(12,2),       -- presupuesto objetivo del viaje (en moneda por defecto)
  cover_blob_id uuid,                 -- referencia a media local (no se sincroniza)
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists trips_profile_idx on trips(profile);
create index if not exists trips_dates_idx on trips(start_date, end_date);

create table if not exists trip_legs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  city text,
  country text,
  arrival_date date,
  departure_date date,
  order_index int not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists trip_legs_trip_idx on trip_legs(trip_id);

create table if not exists planning_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  leg_id uuid references trip_legs(id) on delete set null,
  day_date date,
  time text,
  type text not null check (type in ('lugar','transporte','actividad','comida','otro','vuelo','hotel','coche','playa')),
  title text not null,
  place_name text,
  lat double precision,
  lng double precision,
  gmaps_url text,
  address text,
  notes text,
  order_index int not null default 0,
  -- Estado del item (solo aplica a tipos que requieren reserva: hotel, vuelo, transporte, coche, actividad)
  -- por_iniciar (amarillo) · en_consulta (azul) · confirmado (verde) · cancelado (rojo)
  status text check (status in ('por_iniciar','en_consulta','confirmado','cancelado')),
  -- Compat legacy (derivado de status='en_consulta')
  in_consultation boolean not null default false,
  consultation_url text,
  consultation_price numeric(12,2),
  consultation_currency text,
  consultation_query_date date,
  consultation_planned_d1 date,
  consultation_planned_t1 text,
  consultation_planned_d2 date,
  consultation_planned_t2 text,
  -- Zonas horarias IANA (solo para vuelos / transporte intercontinental)
  origin_tz text,
  dest_tz text,
  -- Datos específicos del tipo (aerolínea/asiento para vuelos, modelo/matrícula
  -- para coche, compañía/vagón para tren, etc.). Mira PLANNING_METADATA en index.html.
  metadata jsonb not null default '{}'::jsonb,
  -- Color del borde para items tipo lugar/playa (verde=seguro, amarillo=dudoso, rojo=quitar)
  border_color text,
  -- Marcado como "visto" por el usuario (lugar visitado / actividad realizada)
  visited boolean not null default false,
  visited_at timestamptz,
  -- Hora fin (solo lugar/playa, opcional). La hora de inicio sigue siendo `time` arriba.
  end_time text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- Migración idempotente para instancias antiguas: añade las columnas si faltan
alter table planning_items add column if not exists visited boolean not null default false;
alter table planning_items add column if not exists visited_at timestamptz;
alter table planning_items add column if not exists end_time text;
create index if not exists planning_items_trip_idx on planning_items(trip_id);
create index if not exists planning_items_day_idx on planning_items(trip_id, day_date);

create table if not exists budget_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  planning_item_id uuid references planning_items(id) on delete set null,
  category text not null check (category in ('transporte','alojamiento','comida','actividades','compras','otros')),
  concept text not null,
  amount numeric(12,2) not null default 0,
  currency text not null default 'EUR',
  rate_to_eur numeric(14,6) not null default 1,
  amount_eur numeric(12,2) generated always as (round(amount * rate_to_eur, 2)) stored,
  status text not null default 'planeado' check (status in ('planeado','reservado','pagado')),
  date date,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists budget_items_trip_idx on budget_items(trip_id);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  type text not null check (type in ('vuelo','hotel','seguro','coche','tren','ferry','actividad','otro')),
  structured_data jsonb not null default '{}'::jsonb,
  doc_name text,
  doc_url text,
  -- fecha de referencia para vista cronológica (check-in / salida / inicio / fecha del evento)
  ref_date date,
  ref_time text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists bookings_trip_idx on bookings(trip_id);

-- "En consulta": candidatos vistos pero aún no reservados
-- (hoteles que estoy comparando, vuelos en seguimiento, etc.).
-- Al confirmar se genera una booking + budget_item + planning_item
-- y status pasa a 'confirmado'.
create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  type text not null check (type in ('vuelo','hotel','coche','actividad','otro')),
  name text not null,
  url text,
  query_date date,                 -- fecha en que se anotó la consulta
  price numeric(12,2),
  currency text default 'EUR',
  notes text,
  -- Fechas previstas anotadas en la consulta (se prellenan al confirmar)
  -- d1/t1 = checkin / salida / recogida ; d2/t2 = checkout / llegada / devolución
  planned_d1 date,
  planned_t1 text,
  planned_d2 date,
  planned_t2 text,
  status text not null default 'en_consulta' check (status in ('en_consulta','confirmado','descartado')),
  confirmed_at timestamptz,
  booking_id uuid references bookings(id) on delete set null,
  budget_item_id uuid,             -- ref a budget_items (no FK por simplicidad de sync)
  planning_item_id uuid,           -- ref a planning_items (idem)
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists inquiries_trip_idx on inquiries(trip_id);
create index if not exists inquiries_status_idx on inquiries(trip_id, status);

-- Wishlist / lugares guardados por viaje
create table if not exists wishlist_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  name text not null,
  category text,                   -- restaurante, museo, naturaleza, mirador, ocio, compras, otros
  notes text,
  url text,
  visited boolean not null default false,
  planning_item_id uuid,           -- si se llevó al planning
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists wishlist_trip_idx on wishlist_items(trip_id);

-- Notas y metadatos libres por día (título, color, nota larga)
create table if not exists day_notes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  date date not null,
  title text,                          -- Etiqueta corta del día (ej. "Día de museos")
  color text,                          -- Color de la pill del título (ID lógico, ver DAY_COLORS en index.html)
  text text,                           -- Nota libre del día
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists day_notes_trip_idx on day_notes(trip_id);
create unique index if not exists day_notes_unique on day_notes(trip_id, date) where deleted_at is null;

create table if not exists packing_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  -- Las categorías fijas son 'ropa','tecnología','aseo','documentos','bebé','otros',
  -- pero el viaje puede definir grupos personalizados (t.packing_categories) con ids
  -- arbitrarios (p. ej. 'cg_botiquin_a1b2'). Por eso NO se restringe con un check:
  -- hacerlo rompería la sincronización al insertar items de grupos personalizados.
  category text not null,
  name text not null,
  checked boolean not null default false,
  template_source text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists packing_items_trip_idx on packing_items(trip_id);

create table if not exists packing_templates (
  id uuid primary key default gen_random_uuid(),
  profile text not null,
  name text not null,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists packing_templates_profile_idx on packing_templates(profile);

create table if not exists addresses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  label text not null,
  address text,
  lat double precision,
  lng double precision,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists addresses_trip_idx on addresses(trip_id);

create table if not exists destination_info (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  leg_id uuid references trip_legs(id) on delete set null,
  timezone text,
  tz_diff_origin text,
  voltage text,
  plug_type text,
  local_currency text,
  tipping_notes text,
  emergency_number text,
  embassy_info text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists destination_info_trip_idx on destination_info(trip_id);

create table if not exists emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  name text not null,
  phone text,
  relation text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists emergency_contacts_trip_idx on emergency_contacts(trip_id);

create table if not exists phrases (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  lang text,
  phrase_local text not null,
  translation text,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists phrases_trip_idx on phrases(trip_id);

create table if not exists shared_expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  payer text not null,
  concept text not null,
  amount numeric(12,2) not null default 0,
  currency text not null default 'EUR',
  participants jsonb not null default '[]'::jsonb,
  split jsonb not null default '{}'::jsonb,
  date date,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists shared_expenses_trip_idx on shared_expenses(trip_id);

create table if not exists diary (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  date date,
  text text,
  photo_urls jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists diary_trip_idx on diary(trip_id);

create table if not exists travel_docs (
  id uuid primary key default gen_random_uuid(),
  profile text not null,
  type text not null check (type in ('pasaporte','visado','dni')),
  number text,
  country text,
  expiry_date date,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists travel_docs_profile_idx on travel_docs(profile);

create table if not exists visited_countries (
  id uuid primary key default gen_random_uuid(),
  profile text not null,
  country_code text not null,
  year int,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists visited_countries_profile_idx on visited_countries(profile);

-- Armario del bebé "Pablo" — pestaña exclusiva del viaje España.
-- Inventario de prendas (una fila por combinación prenda/tipo/talla).
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

-- Catálogo de opciones personalizadas (prendas/tipos/tallas) — una fila por viaje.
-- `id` = trip_id para garantizar una sola fila por viaje.
create table if not exists wardrobe_catalog (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  prendas jsonb not null default '[]'::jsonb,
  tipos jsonb not null default '{}'::jsonb,
  tallas jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists wardrobe_catalog_trip_idx on wardrobe_catalog(trip_id);

-- ============================================================
-- updated_at automático
-- ============================================================
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'trips','trip_legs','planning_items','budget_items','bookings','inquiries',
    'wishlist_items','day_notes',
    'packing_items','packing_templates','addresses','destination_info',
    'emergency_contacts','phrases','shared_expenses','diary',
    'travel_docs','visited_countries',
    'wardrobe_items','wardrobe_catalog'
  ]) loop
    execute format(
      'drop trigger if exists trg_touch_%I on %I;
       create trigger trg_touch_%I before update on %I
       for each row execute function touch_updated_at();',
      t, t, t, t
    );
  end loop;
end$$;

-- ============================================================
-- RLS — basada en cabecera x-app-profile
-- ============================================================
-- Modelo: 'ruben' es el dueño y único que puede modificar.
-- 'sergio' e 'invitado' son LECTORES de los datos de 'ruben'.
-- SELECT permisivo para los 3; INSERT/UPDATE/DELETE solo para el dueño.

-- Helper: ¿el perfil activo puede leer los datos de `owner`?
create or replace function app_can_read(owner text) returns boolean
language sql stable as $$
  select owner = app_profile()
      or (app_profile() in ('sergio','invitado') and owner = 'ruben');
$$;

-- Tablas con `profile` directo
alter table trips enable row level security;
alter table packing_templates enable row level security;
alter table travel_docs enable row level security;
alter table visited_countries enable row level security;

-- Drop de TODAS las políticas anteriores (legacy + nuevas) — re-ejecutable.
drop policy if exists p_trips on trips;
drop policy if exists p_trips_select on trips;
drop policy if exists p_trips_insert on trips;
drop policy if exists p_trips_update on trips;
drop policy if exists p_trips_delete on trips;

create policy p_trips_select on trips
  for select using (app_can_read(profile));
create policy p_trips_insert on trips
  for insert with check (profile = app_profile());
create policy p_trips_update on trips
  for update using (profile = app_profile())
                with check (profile = app_profile());
create policy p_trips_delete on trips
  for delete using (profile = app_profile());

drop policy if exists p_packing_templates on packing_templates;
drop policy if exists p_packing_templates_select on packing_templates;
drop policy if exists p_packing_templates_modify on packing_templates;
create policy p_packing_templates_select on packing_templates
  for select using (app_can_read(profile));
create policy p_packing_templates_modify on packing_templates
  for all using (profile = app_profile())
          with check (profile = app_profile());

drop policy if exists p_travel_docs on travel_docs;
drop policy if exists p_travel_docs_select on travel_docs;
drop policy if exists p_travel_docs_modify on travel_docs;
create policy p_travel_docs_select on travel_docs
  for select using (app_can_read(profile));
create policy p_travel_docs_modify on travel_docs
  for all using (profile = app_profile())
          with check (profile = app_profile());

drop policy if exists p_visited_countries on visited_countries;
drop policy if exists p_visited_countries_select on visited_countries;
drop policy if exists p_visited_countries_modify on visited_countries;
create policy p_visited_countries_select on visited_countries
  for select using (app_can_read(profile));
create policy p_visited_countries_modify on visited_countries
  for all using (profile = app_profile())
          with check (profile = app_profile());

-- Tablas hijas — RLS por join al trip.
-- SELECT: ver hijos de cualquier trip que pueda leerse.
-- MODIFY: solo si el trip pertenece al perfil activo.
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'trip_legs','planning_items','budget_items','bookings','inquiries',
    'wishlist_items','day_notes','packing_items',
    'addresses','destination_info','emergency_contacts','phrases',
    'shared_expenses','diary',
    'wardrobe_items','wardrobe_catalog'
  ]) loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists p_%I on %I;', t, t);
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

-- ============================================================
-- MIGRACIONES (idempotentes — seguras de re-ejecutar)
-- ============================================================

-- packing_items.category admite grupos personalizados con ids arbitrarios
-- (t.packing_categories). El antiguo check (category in (...)) rompía la
-- sincronización con el error:
--   new row for relation "packing_items" violates check constraint
--   "packing_items_category_check"
-- Eliminamos la restricción si todavía existe.
alter table if exists packing_items
  drop constraint if exists packing_items_category_check;
