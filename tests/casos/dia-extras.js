/* Lo que se apunta de un día y no es una parada, y el menú del tramo.
 *
 * Cuatro cosas que no encajaban como parada y acababan sin sitio:
 *   · los platos típicos del lugar;
 *   · el recordatorio del día ("llevar mosquitera") con sus tareas;
 *   · cambiar en qué se va un tramo, que estaba escondido en el editor de la
 *     parada de destino;
 *   · y la nota de una parada, que había que abrirla para leerla.
 *
 * Todo vive en `settings` del viaje (jsonb, ya sincronizado) o en `metadata` de
 * la parada: ni una columna nueva que migrar a mano en Supabase. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();
  const dias = await p.evaluate(() => window.__dias);
  const D = dias.manana;

  // El día de mañana no trae coordenadas en la semilla, así que no tiene tramos.
  // Se le ponen a dos paradas para que haya uno que probar.
  await p.evaluate(async (d) => {
    const its = (await DB.listByTrip('planning_items', 'trip-demo-1'))
      .filter((x) => x.day_date === d && x.type === 'lugar' && !x.deleted_at);
    const pts = [[6.7621, -73.1727], [6.6357, -73.2264]];
    for (let i = 0; i < Math.min(2, its.length); i++) {
      its[i].lat = pts[i][0]; its[i].lng = pts[i][1];
      await DB.put('planning_items', its[i]);
    }
    await Router.render();
  }, D);
  await sleep(p, 1200);

  const irAlDia = async () => { await p.evaluate((d) => TripDetail._irADia(d), D); await sleep(p, 1900); };
  const enElDia = (fn) => p.evaluate(([d, f]) => {
    const g = [...document.querySelectorAll('.day-group')].find((x) => x.dataset.day === d);
    return new Function('g', 'return (' + f + ')(g)')(g);
  }, [D, fn.toString()]);
  const filasMenu = () => p.evaluate(() =>
    [...document.querySelectorAll('.menu-parada .mp-fila .mp-t')].map((x) => x.textContent));
  // Por el TÍTULO de la fila: "Automático" lleva "A pie si está cerca" en su
  // explicación, y buscando en todo el texto se pulsaba esa.
  const pulsarFila = (txt) => p.evaluate((t) => {
    const b = [...document.querySelectorAll('.menu-parada .mp-fila')]
      .find((x) => (x.querySelector('.mp-t')?.textContent || '').includes(t));
    if (!b) return false; b.click(); return true;
  }, txt);

  titulo('EL "+" DEL DÍA OFRECE TRES COSAS');
  await irAlDia();
  await p.evaluate(async (d) => { const t = await DB.get('trips', 'trip-demo-1'); TripDetail.openMenuAnadir(t, d); }, D);
  await sleep(p, 700);
  const menu = await filasMenu();
  ok(menu.join('/') === 'Parada/Gastronomía/Nota del día',
    'parada, gastronomía y nota del día', menu);
  await p.evaluate(() => UI.closeSheet()); await sleep(p, 500);

  titulo('GASTRONOMÍA: ABRIRLA DEJA EL BOTÓN EN LA FILA DEL DÍA');
  ok(!await enElDia((g) => !!g.querySelector('.day-gastro-btn')),
    'antes de abrirla no hay botón: un icono más en todos los días no compensa');
  await p.evaluate(async (d) => { const t = await DB.get('trips', 'trip-demo-1'); TripDetail.openGastronomia(t, d); }, D);
  await sleep(p, 900);
  ok(await p.evaluate(() => !!document.querySelector('.gastro-add')), 'la carta se abre con su "Añadir plato"');
  // Un plato con foto de la web, como la portada de un viaje.
  await p.evaluate(() => document.querySelector('.gastro-add').click());
  await sleep(p, 800);
  await p.evaluate(() => {
    document.getElementById('gp-nom').value = 'Hormiga culona';
    document.getElementById('gp-url').value = 'http://localhost:8778/foto.png';
  });
  await p.evaluate(() => [...document.querySelectorAll('#sheet-foot button')]
    .find((x) => /^Guardar$/.test(x.textContent.trim())).click());
  await sleep(p, 1200);
  const carta = await p.evaluate(() => ({
    tarjetas: [...document.querySelectorAll('.gastro-card:not(.gastro-add) .gastro-nom')].map((x) => x.textContent),
    foto: !!document.querySelector('.gastro-card .gastro-foto img'),
  }));
  ok(carta.tarjetas.join('/') === 'Hormiga culona', 'el plato entra en la carta', carta);
  ok(carta.foto, 'con su foto cargada desde la URL');
  const guardado = await p.evaluate(async (d) => {
    const t = await DB.get('trips', 'trip-demo-1');
    return ((t.settings || {}).dias || {})[d]?.platos || null;
  }, D);
  ok(guardado && guardado.length === 1 && guardado[0].nombre === 'Hormiga culona' && guardado[0].url,
    'y queda en el viaje, que es lo que sincroniza', guardado);
  await p.evaluate(() => [...document.querySelectorAll('#sheet-foot button')]
    .find((x) => /Listo/.test(x.textContent)).click());
  await sleep(p, 1200);
  await irAlDia();
  ok(await enElDia((g) => !!g.querySelector('.day-gastro-btn.tiene')),
    'y el botón ya sale, marcado, junto a la etiqueta del día');
  ok(await enElDia((g) => {
    const b = g.querySelector('.day-gastro-btn'), pill = g.querySelector('.day-meta-pill');
    return !!(b && pill && b.getBoundingClientRect().left > pill.getBoundingClientRect().left);
  }), 'a la derecha de la pastilla del sitio, que es de quien son los platos');

  titulo('LA NOTA DEL DÍA, EN AMARILLO Y ANTES DE LAS PARADAS');
  await p.evaluate(async (d) => { const t = await DB.get('trips', 'trip-demo-1'); TripDetail.openNotaDia(t, d); }, D);
  await sleep(p, 800);
  await p.evaluate(() => { document.getElementById('nd-text').value = 'Llevar mosquitera y efectivo.'; });
  await p.evaluate(() => document.querySelector('.nd-add').click());
  await sleep(p, 300);
  await p.evaluate(() => { const i = document.querySelector('.nd-txt'); i.value = 'Sacar dinero'; i.dispatchEvent(new Event('input')); });
  await p.evaluate(() => [...document.querySelectorAll('#sheet-foot button')]
    .find((x) => /^Guardar$/.test(x.textContent.trim())).click());
  await sleep(p, 1400);
  await irAlDia();
  const caja = await enElDia((g) => {
    const n = g.querySelector('.nota-dia');
    if (!n) return null;
    const banda = g.querySelector('.timeline-item');
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const cx = cv.getContext('2d');
    cx.fillStyle = getComputedStyle(n).backgroundColor; cx.fillRect(0, 0, 1, 1);
    const [r, v, a] = cx.getImageData(0, 0, 1, 1).data;
    return {
      texto: n.querySelector('.nd-texto')?.textContent,
      tareas: n.querySelectorAll('.nd-t').length,
      // Amarillo: rojo por encima del verde y los dos muy por encima del azul.
      amarillo: r > v && v > a && (r - a) > 30,
      antesDeLaPrimera: !!banda && n.getBoundingClientRect().top < banda.getBoundingClientRect().top,
    };
  });
  ok(caja && /mosquitera/.test(caja.texto), 'el recordatorio sale en el día', caja);
  ok(caja.tareas === 1, 'con su tarea', caja.tareas);
  ok(caja.amarillo, 'sobre amarillo', caja.amarillo);
  ok(caja.antesDeLaPrimera, 'y antes de la primera fila del planning');
  await p.screenshot({ path: captura('dia-extras-nota.png') });

  // Tachar una tarea se guarda al momento: usarla no es "editar el día".
  await p.evaluate(() => { const c = document.querySelector('.nota-dia .nd-t input'); c.click(); });
  await sleep(p, 900);
  const tachada = await p.evaluate(async (d) => {
    const t = await DB.get('trips', 'trip-demo-1');
    return (((t.settings || {}).dias || {})[d]?.tareas || [])[0]?.hecha;
  }, D);
  ok(tachada === true, 'marcar la casilla se guarda sola, sin abrir nada', tachada);
  ok(await enElDia((g) => !!g.querySelector('.nota-dia .nd-t.hecha')), 'y queda tachada');

  titulo('LA NOTA DE UNA PARADA, VISIBLE SIN ABRIRLA');
  const idNota = await p.evaluate(async (d) => {
    const x = (await DB.listByTrip('planning_items', 'trip-demo-1'))
      .find((y) => y.day_date === d && y.type === 'lugar' && !y.deleted_at);
    x.notes = 'Pedir la mesa del patio.';
    await DB.put('planning_items', x);
    return x.id;
  }, D);
  await p.evaluate(async (id) => {
    const t = await DB.get('trips', 'trip-demo-1');
    TripDetail.openQuickNote(t, await DB.get('planning_items', id));
  }, idNota);
  await sleep(p, 800);
  ok(await p.evaluate(() => !!document.getElementById('qn-ver')),
    'la hoja de la nota ofrece verla en el planning');
  ok(await p.evaluate(() => !document.getElementById('qn-ver').checked),
    'apagado por defecto: con diez paradas con nota, el día dejaría de leerse');
  await p.evaluate(() => document.getElementById('qn-ver').click());
  await p.evaluate(() => [...document.querySelectorAll('#sheet-foot button')]
    .find((x) => /^Guardar$/.test(x.textContent.trim())).click());
  await sleep(p, 1400);
  await irAlDia();
  const np = await enElDia((g) => {
    const n = g.querySelector('.nota-parada');
    if (!n) return null;
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const cx = cv.getContext('2d');
    cx.fillStyle = getComputedStyle(n).backgroundColor; cx.fillRect(0, 0, 1, 1);
    const [r, v, a] = cx.getImageData(0, 0, 1, 1).data;
    return { txt: n.querySelector('.np-txt')?.textContent, verdeAzulado: v > r && a > r };
  });
  ok(np && /mesa del patio/.test(np.txt), 'la nota se lee en el planning, bajo su evento', np);
  ok(np.verdeAzulado, 'en verde azulado, que no se confunde con el amarillo del día', np);

  titulo('EL TRAMO: EN QUÉ SE VA, SIN ENTRAR EN LA PARADA');
  const chip = await enElDia((g) => {
    const c = g.querySelector('.leg-chip.leg-menu');
    return c ? { txt: c.textContent, href: c.href } : null;
  });
  ok(chip && /maps/.test(chip.href), 'los tramos llevan su menú y su enlace al mapa', chip);
  await p.evaluate((d) => {
    const g = [...document.querySelectorAll('.day-group')].find((x) => x.dataset.day === d);
    const c = g.querySelector('.leg-chip.leg-menu');
    const r = c.getBoundingClientRect();
    const o = { bubbles:true, cancelable:true, clientX: r.left + 5, clientY: r.top + 5 };
    c.dispatchEvent(new PointerEvent('pointerdown', o));
  }, D);
  await sleep(p, 1200);
  const menuTramo = await filasMenu();
  ok(menuTramo.some((x) => /A pie/.test(x)) && menuTramo.some((x) => /Coche/.test(x)),
    'la pulsación larga abre los modos', menuTramo);
  ok(menuTramo.some((x) => /Cómo llegar/.test(x)),
    'y el enlace a Google Maps que ya tenía el chip', menuTramo);
  // La pulsación larga se traga el clic siguiente (el dedo sigue puesto y al
  // levantarlo caería sobre el menú recién abierto). Aquí se gasta a propósito.
  await p.evaluate(() => document.body.click());
  await sleep(p, 200);
  ok(await pulsarFila('A pie'), 'se puede elegir ir a pie');
  await sleep(p, 1600);
  await irAlDia();
  const traModo = await p.evaluate(async (d) => {
    const x = (await DB.listByTrip('planning_items', 'trip-demo-1'))
      .find((y) => y.day_date === d && (y.metadata || {}).arrive_mode);
    const g = [...document.querySelectorAll('.day-group')].find((y) => y.dataset.day === d);
    return { guardado: x ? x.metadata.arrive_mode : null,
             chip: g?.querySelector('.leg-chip.leg-menu')?.textContent || '' };
  }, D);
  ok(traModo.guardado === 'walk', 'el modo elegido se guarda en la parada de destino', traModo);
  ok(/🚶/.test(traModo.chip), 'y el tramo pasa a contarse a pie', traModo);

  terminar(errs);
  await cerrar();
})();
