-- ============================================================
-- Bucket `compartir` — enlaces de viaje sin token de GitHub
-- ============================================================
-- POR QUÉ
--
--   Publicar un enlace subía el HTML al repo con la API de GitHub, y eso pedía
--   un token personal guardado en el navegador. Los fine-grained caducan, y el
--   día que caducan te enteras porque el botón falla con "Token inválido o
--   caducado" justo cuando querías mandar el viaje a alguien.
--
--   Con Storage la credencial es la sesión que ya tienes abierta: no caduca a
--   plazo fijo, se renueva sola y no hay nada que copiar en cada dispositivo.
--
-- QUÉ MONTA
--
--   Un bucket público de solo lectura donde solo el perfil 'ruben' escribe.
--   Público = quien tenga el enlace lo abre, igual que en GitHub Pages: la URL
--   no es un secreto y el HTML ya viaja redactado desde que se genera.
--
-- REQUISITO
--
--   Ejecuta antes schema-auth.sql: la escritura se apoya en app_profile(), que
--   allí pasa a leer la sesión en vez de una cabecera del cliente.
--
-- Es idempotente: se puede re-ejecutar sin miedo.
-- ============================================================


-- ------------------------------------------------------------
-- 1. El bucket
-- ------------------------------------------------------------
-- Sin límite de tipos MIME a propósito: se sube como
-- 'text/html; charset=utf-8' y una lista de permitidos que no contemple el
-- charset rechazaría la subida sin decir por qué.
-- El tope de 10 MB es holgado: un viaje de 26 días con 229 paradas ocupa
-- unos 280 KB.

insert into storage.buckets (id, name, public, file_size_limit)
values ('compartir', 'compartir', true, 10485760)
on conflict (id) do update
  set public = true,
      file_size_limit = 10485760;


-- ------------------------------------------------------------
-- 2. Lectura: cualquiera con el enlace
-- ------------------------------------------------------------
-- El bucket sea público no basta: la API de Storage pasa igualmente por las
-- políticas de storage.objects.

drop policy if exists p_compartir_read on storage.objects;
create policy p_compartir_read on storage.objects
  for select
  using (bucket_id = 'compartir');


-- ------------------------------------------------------------
-- 3. Escritura: solo el dueño, y con sesión
-- ------------------------------------------------------------
-- `to authenticated` deja fuera a `anon`, que es el rol con el que viaja la
-- anonKey publicada en index.html. Sin esto, cualquiera que leyese el HTML de
-- la app podría llenarte el bucket: era la pega de mover la publicación aquí,
-- y app_profile() la cierra.

drop policy if exists p_compartir_write on storage.objects;
create policy p_compartir_write on storage.objects
  for all
  to authenticated
  using      (bucket_id = 'compartir' and app_profile() = 'ruben')
  with check (bucket_id = 'compartir' and app_profile() = 'ruben');


-- ------------------------------------------------------------
-- 4. Comprobación
-- ------------------------------------------------------------
-- Aquí sí sirve mirar desde el editor: es la configuración, no la RLS.
--
--   select id, public, file_size_limit from storage.buckets where id = 'compartir';
--   select policyname, cmd, roles from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like 'p_compartir%';
--
-- La prueba de la escritura es publicar un enlace desde la app. La de la
-- lectura, abrir esa URL en una ventana privada.
