-- ============================================================
-- Sellar también al EDITAR quién lo hizo (idempotente)
-- ============================================================
-- Pégalo entero en el SQL editor de Supabase y pulsa "Run".
-- No toca ni una fila de datos, solo la función del trigger.
--
-- QUÉ ARREGLA
--
--   "Editado por Sergio" mentía: enseñaba quién CREÓ la fila, no quién la tocó
--   el último. `_ultimaEdicion` (index.html) lee `updated_by`, y ese campo solo
--   se rellenaba en el alta.
--
--   El motivo es un cruce entre dos migraciones. `schema-autoria.sql` trajo un
--   `touch_updated_at()` que sella `updated_by`, pero lo hace con
--   `old.updated_by` a secas. Después, `schema.sql` y `schema-touch-insert.sql`
--   pasaron los `trg_touch_*` a `before insert or update` —hacía falta para que
--   el pull incremental no se dejara filas por el camino— y en un INSERT `old`
--   no existe: esa versión reventaría todas las altas. Así que lo que quedó
--   montado es la versión simple, la que no sella autor.
--
--   Aquí se mira `TG_OP` antes de tocar `old`, que es lo que faltaba para que
--   las dos cosas puedan convivir.
--
-- REQUISITO
--
--   Que las tablas tengan la columna `updated_by`, o sea `schema-autoria.sql`
--   aplicado. Si no lo está, este archivo lo dice y no cambia nada: sin esa
--   columna, asignarla desde el trigger rompería cada escritura.
--
-- Es idempotente: se puede re-ejecutar sin miedo.
-- ============================================================

do $$
declare hay_autor boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'trips' and column_name = 'updated_by'
  ) into hay_autor;

  if not hay_autor then
    raise notice 'Las tablas no tienen `updated_by`: ejecuta antes schema-autoria.sql. No se ha cambiado nada.';
    return;
  end if;

  execute $f$
    create or replace function touch_updated_at() returns trigger
    language plpgsql as $q$
    begin
      new.updated_at := now();
      -- `old` no existe en un INSERT y referenciarlo aborta la fila entera:
      -- desde schema-touch-insert.sql este trigger corre también ahí.
      --
      -- El coalesce conserva lo que hubiera cuando no hay sesión (una carga
      -- desde el editor SQL, por ejemplo): poner NULL borraría el autor
      -- anterior, que es peor que no saber quién hizo esta pasada.
      if tg_op = 'UPDATE' then
        new.updated_by := coalesce(auth.uid(), old.updated_by);
      else
        new.updated_by := coalesce(auth.uid(), new.updated_by);
      end if;
      return new;
    end;
    $q$;
  $f$;
  raise notice 'touch_updated_at(): ahora sella updated_at y updated_by, en alta y en edición.';
end$$;


-- ------------------------------------------------------------
-- Comprobación
-- ------------------------------------------------------------
-- Edita algo desde otra cuenta y mira que cambia el autor, no solo la fecha:
--
--   select id, title, updated_by, updated_at
--     from planning_items order by updated_at desc limit 5;
--
--   select user_id, profile, nombre from app_users;
