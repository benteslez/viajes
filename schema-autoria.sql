-- ============================================================
-- Quién tocó qué
-- ============================================================
-- POR QUÉ
--
--   Desde que otra persona puede EDITAR un viaje, un cambio raro no tiene
--   autor. `updated_at` dice cuándo, pero no quién.
--
-- CÓMO
--
--   Una columna `updated_by` que rellena el TRIGGER, no el cliente. Si la
--   mandara la app, cualquiera podría poner ahí lo que quisiera: el trigger
--   corre en el servidor y usa auth.uid(), que sale del JWT firmado.
--
--   Se aprovecha el trigger que ya existía para `updated_at`, así que no hay
--   un disparo más por fila.
--
-- REQUISITO
--
--   schema-auth.sql y schema-perms.sql aplicados.
--
-- Es idempotente: se puede re-ejecutar sin miedo.
-- ============================================================


-- ------------------------------------------------------------
-- 1. La columna, en todas las tablas que lleva el trigger
-- ------------------------------------------------------------
-- Tiene que estar en TODAS: la función es una sola y compartida, y asignar
-- new.updated_by en una tabla que no tenga la columna es un error en ejecución.
--
-- Sin `references auth.users` a propósito: si algún día borras una cuenta, no
-- quiero que se lleve por delante la autoría de lo que hizo, ni que el borrado
-- falle por una clave ajena. Queda el uuid, huérfano pero informativo.

do $$
declare t text;
begin
  for t in select unnest(array[
    'trips','trip_legs','planning_items','budget_items','bookings','inquiries',
    'wishlist_items','day_notes','packing_items','packing_templates',
    'addresses','destination_info','emergency_contacts','phrases',
    'shared_expenses','diary','travel_docs','visited_countries',
    'wardrobe_items','wardrobe_catalog'
  ]) loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table %I add column if not exists updated_by uuid;', t);
  end loop;
end$$;


-- ------------------------------------------------------------
-- 2. El trigger sella el autor
-- ------------------------------------------------------------
-- coalesce: si no hay sesión (una migración desde el editor SQL, por ejemplo),
-- se conserva el autor anterior en vez de borrarlo poniendo NULL.

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  return new;
end;
$$;

-- En un INSERT no hay `old`, y referenciarlo revienta. Trigger propio para
-- las altas, con la misma idea.
create or replace function stamp_insert_author() returns trigger
language plpgsql as $$
begin
  -- La sesión manda sobre lo que traiga el cliente: si no, cualquiera podría
  -- insertar una fila firmada con el uuid de otra persona. Solo se conserva lo
  -- que venga cuando no hay sesión (una carga desde el editor SQL).
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

do $$
declare t text;
begin
  for t in select unnest(array[
    'trips','trip_legs','planning_items','budget_items','bookings','inquiries',
    'wishlist_items','day_notes','packing_items','packing_templates',
    'addresses','destination_info','emergency_contacts','phrases',
    'shared_expenses','diary','travel_docs','visited_countries',
    'wardrobe_items','wardrobe_catalog'
  ]) loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format(
      'drop trigger if exists trg_author_%I on %I;
       create trigger trg_author_%I before insert on %I
       for each row execute function stamp_insert_author();', t, t, t, t);
  end loop;
end$$;


-- ------------------------------------------------------------
-- 3. Poner nombre a las personas
-- ------------------------------------------------------------
-- Un uuid no le dice nada a nadie. El correo vive en auth.users, que no se
-- expone, así que el nombre visible se guarda aquí.

alter table app_users add column if not exists nombre text;

update app_users set nombre = initcap(profile) where nombre is null;

-- Para poder pintar "editado por Sergio" hace falta que cualquiera con sesión
-- pueda traducir uuid -> nombre. Se expone poco y a gente que tú has invitado:
-- quién existe y cómo se llama. Los correos siguen sin salir de auth.users.
drop policy if exists p_app_users_self on app_users;
create policy p_app_users_self on app_users
  for select using (auth.uid() is not null);


-- ------------------------------------------------------------
-- 4. Comprobación
-- ------------------------------------------------------------
--   select user_id, profile, nombre from app_users;
--
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='planning_items'
--      and column_name='updated_by';
--
-- La prueba de verdad: edita algo desde la app y mira si se sella el autor.
--
--   select name, updated_by, updated_at from trips order by updated_at desc limit 3;
