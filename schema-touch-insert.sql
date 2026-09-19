-- ============================================================
-- Migración: sellar `updated_at` también en el INSERT
-- ============================================================
-- Pégalo entero en el SQL editor de Supabase y ejecútalo. Es idempotente: se
-- puede lanzar las veces que haga falta. No toca ni una fila de datos, solo
-- recrea los triggers.
--
-- POR QUÉ
--
-- El pull de cada dispositivo es incremental. En `SYNC.pullAll` (index.html):
--
--     .gt('updated_at', since)        -- since = último sync DE ESE dispositivo
--
-- Los triggers `trg_touch_*` eran `before update` a secas, así que en un INSERT
-- Postgres respetaba el `updated_at` que mandara el cliente. Una fila que ENTRA
-- con una fecha anterior al último sync de otro dispositivo no se descarga ahí
-- nunca: está en la base y no aparece en la app, sin ningún error que mirar.
--
-- Se ve con cualquier import de datos archivados (la carpeta `imports/`), donde
-- el JSON trae el `updated_at` original. Sellando también el insert, lo que
-- entra es siempre más nuevo que cualquier watermark ya emitido.
--
-- Esto es exactamente el mismo bloque que hay al final de `schema.sql`. Está
-- aparte para no tener que volver a ejecutar el esquema entero.
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
    -- `to_regclass` para no reventar si a esta instancia le falta alguna tabla
    -- (las de `schema-wardrobe.sql`, por ejemplo, son de un esquema posterior).
    if to_regclass('public.' || quote_ident(t)) is null then
      raise notice 'tabla % no existe en esta instancia, se salta', t;
      continue;
    end if;
    execute format(
      'drop trigger if exists trg_touch_%I on %I;
       create trigger trg_touch_%I before insert or update on %I
       for each row execute function touch_updated_at();',
      t, t, t, t
    );
  end loop;
end$$;

-- ============================================================
-- Comprobación
-- ============================================================
-- Debe salir una fila por tabla y todas con `cuando` = 'INSERT OR UPDATE'.
-- Si alguna sigue diciendo 'UPDATE', ahí no se aplicó.

select c.relname                                    as tabla,
       case
         when (t.tgtype::int & 4) > 0 and (t.tgtype::int & 16) > 0 then 'INSERT OR UPDATE'
         when (t.tgtype::int & 4) > 0                              then 'INSERT'
         when (t.tgtype::int & 16) > 0                             then 'UPDATE'
         else 'otro'
       end                                          as cuando
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal
  and t.tgname like 'trg_touch_%'
order by c.relname;
