// ============================================================
// admin-usuarios — altas y bajas de cuentas desde la app
// ============================================================
// POR QUÉ EXISTE
//
//   Crear o borrar una cuenta de Supabase Auth exige la clave `service_role`,
//   que se salta TODA la RLS. Esa clave no puede vivir en index.html: el HTML
//   es público. Así que vive aquí, en el servidor, y la app pide las cosas por
//   HTTP en vez de tener la llave maestra.
//
//   Quitar el acceso a alguien (borrar sus filas de trip_shares y app_users)
//   no necesita nada de esto: la app lo hace directamente con la anonKey,
//   porque las políticas ya dejan al admin escribir ahí. Esta función es solo
//   para lo que toca `auth.users`.
//
// CÓMO SE INSTALA
//
//   Supabase -> Edge Functions -> Deploy a new function -> nombre
//   "admin-usuarios" -> pegar este archivo -> Deploy.
//
//   SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY las inyecta Supabase sola: no hay
//   que configurar ningún secreto ni copiar ninguna clave a mano.
//
//   Si el navegador se queja de CORS en la petición previa (OPTIONS), apaga
//   "Verify JWT" en los ajustes de la función. No baja la seguridad: la
//   comprobación de abajo es más estricta que la de Supabase, porque además de
//   exigir una sesión válida exige que sea la del administrador.
//
// QUIÉN PUEDE LLAMARLA
//
//   Solo el perfil 'ruben', y se comprueba AQUÍ. Que el botón esté escondido
//   en la app no protege nada: cualquiera puede llamar a la URL a mano.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Solo POST' }, 405);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // --- Quién llama -------------------------------------------------------
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Falta la sesión.' }, 401);

  const { data: quien, error: eSesion } = await admin.auth.getUser(jwt);
  if (eSesion || !quien?.user) return json({ error: 'Sesión no válida o caducada.' }, 401);

  const { data: fila } = await admin
    .from('app_users').select('profile').eq('user_id', quien.user.id).maybeSingle();
  if (fila?.profile !== 'ruben') return json({ error: 'Solo el administrador puede hacer esto.' }, 403);

  // --- Qué pide ----------------------------------------------------------
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const accion = String(body.accion ?? '');

  // Lista de personas con su correo. El correo vive en auth.users, que no se
  // expone por la API: es el motivo principal de que la app necesite esto
  // incluso para solo mirar.
  if (accion === 'list') {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) return json({ error: error.message }, 400);
    const { data: perfiles } = await admin.from('app_users').select('user_id, profile');
    const perfilDe = new Map((perfiles ?? []).map((p) => [p.user_id, p.profile]));
    return json({
      usuarios: data.users.map((u) => ({
        id: u.id,
        email: u.email,
        perfil: perfilDe.get(u.id) ?? null,
        creado: u.created_at,
        ultimo_acceso: u.last_sign_in_at,
      })),
    });
  }

  if (accion === 'create') {
    const email = String(body.email ?? '').trim();
    const password = String(body.password ?? '');
    if (!email || !password) return json({ error: 'Hacen falta correo y contraseña.' }, 400);
    if (password.length < 8) return json({ error: 'La contraseña necesita 8 caracteres como mínimo.' }, 400);

    // email_confirm: la cuenta nace confirmada. Si no, la persona tendría que
    // abrir un correo antes de poder entrar, y el alta la estás haciendo tú.
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (error) {
      const m = error.message || '';
      if (/already been registered|already exists/i.test(m)) {
        return json({ error: 'Ya existe una cuenta con ese correo.' }, 400);
      }
      return json({ error: m }, 400);
    }

    const perfil = body.perfil === 'sergio' ? 'sergio' : 'invitado';
    const { error: ePerfil } = await admin
      .from('app_users').insert({ user_id: data.user.id, profile: perfil });
    if (ePerfil) {
      // Una cuenta sin fila en app_users no puede entrar (app_profile() sería
      // NULL). Mejor deshacer el alta que dejar un usuario a medio crear.
      await admin.auth.admin.deleteUser(data.user.id);
      return json({ error: 'No se pudo asignar el perfil: ' + ePerfil.message }, 400);
    }
    return json({ id: data.user.id, email: data.user.email, perfil });
  }

  if (accion === 'delete') {
    const userId = String(body.user_id ?? '');
    if (!userId) return json({ error: 'Falta el usuario.' }, 400);
    if (userId === quien.user.id) return json({ error: 'No puedes borrar tu propia cuenta.' }, 400);
    // app_users y trip_shares apuntan a auth.users con `on delete cascade`,
    // así que sus concesiones se van con ella.
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  // Cambiar la contraseña de otra persona: útil cuando la olvida y no quieres
  // montar el flujo de recuperación por correo.
  if (accion === 'password') {
    const userId = String(body.user_id ?? '');
    const password = String(body.password ?? '');
    if (!userId || !password) return json({ error: 'Faltan el usuario o la contraseña.' }, 400);
    if (password.length < 8) return json({ error: 'La contraseña necesita 8 caracteres como mínimo.' }, 400);
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: 'Acción desconocida: ' + accion }, 400);
});
