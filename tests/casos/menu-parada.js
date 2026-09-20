/* Una parada tiene UN menú, y se llega a él por los dos sitios: tocando su
 * "•••" o dejándola pulsada. Antes cada gesto abría una lista distinta. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();
  await p.evaluate(() => TripDetail._irADia(window.__dias.manana, { animar: false }));
  await sleep(p, 1200);

  const opciones = () => p.evaluate(() =>
    [...document.querySelectorAll('#sheet .menu-parada .res-fila')].map((x) => x.querySelector('.res-fila-lbl').textContent));
  const cerrarHoja = async () => { await p.evaluate(() => UI.closeSheet()); await sleep(p, 600); };
  const primera = '.plan-page:not(.day-past) .timeline-item';

  titulo('EL ••• ABRE LA HOJA');
  await p.evaluate((s) => document.querySelector(s + ' .li-more').click(), primera);
  await sleep(p, 900);
  const porBoton = await opciones();
  ok(await p.evaluate(() => !!document.querySelector('#sheet.show .menu-parada')), 'el ••• abre el menú de la parada');
  ok(porBoton.includes('Editar') && porBoton.includes('Duplicar') && porBoton.includes('Eliminar'),
    'con las opciones que antes solo tenía la pulsación larga', porBoton);
  ok(porBoton.some((x) => /nota/i.test(x)) && porBoton.some((x) => /Marcar como/.test(x)),
    'y las que antes solo tenía el ••• (nota y visto)', porBoton);
  ok(await p.evaluate(() => document.querySelectorAll('.timeline-list .li-actions').length) === 0,
    'ya no queda la fila de iconos dentro de la tarjeta');
  await p.screenshot({ path: captura('menu-parada.png') });
  await cerrarHoja();

  titulo('LA PULSACIÓN LARGA ABRE LA MISMA');
  const caja = await p.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, primera);
  const c = await p.context().newCDPSession(p);
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: caja.x, y: caja.y }] });
  await sleep(p, 750);
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(p, 900);
  const porPulsacion = await opciones();
  ok(porPulsacion.length > 0 && porPulsacion.join('|') === porBoton.join('|'),
    'la pulsación larga da exactamente la misma lista', porPulsacion);
  await cerrarHoja();

  titulo('LAS OPCIONES HACEN LO QUE DICEN');
  const id = await p.evaluate((s) => document.querySelector(s).dataset.id, primera);
  const antes = await p.evaluate((i) => document.querySelector(`.timeline-item[data-id="${i}"]`).classList.contains('visited'), id);
  await p.evaluate((s) => document.querySelector(s + ' .li-more').click(), primera);
  await sleep(p, 800);
  await p.evaluate(() => [...document.querySelectorAll('#sheet .res-fila-lbl')]
    .find((x) => /Marcar como/.test(x.textContent)).closest('button').click());
  await sleep(p, 1600);
  const despues = await p.evaluate((i) => document.querySelector(`.timeline-item[data-id="${i}"]`)?.classList.contains('visited'), id);
  ok(antes === false && despues === true, '"Marcar como visto" marca la parada', `${antes} → ${despues}`);

  titulo('"CÓMO LLEGAR" SOLO SI HAY SITIO AL QUE IR');
  const sinSitio = await p.evaluate(async () => {
    const its = await DB.listByTrip('planning_items', 'trip-demo-1');
    const x = its.find((i) => !i.deleted_at && !i.place_name && !i.address && i.lat == null);
    if (!x) return null;
    const t = await DB.get('trips', 'trip-demo-1');
    await TripDetail.openPlanningCardMenu(t, x);
    return x.title;
  });
  await sleep(p, 900);
  ok(sinSitio && !(await opciones()).includes('Cómo llegar'),
    'sin lugar no se ofrece "Cómo llegar"', sinSitio);
  await cerrarHoja();

  const conSitio = await p.evaluate(async () => {
    const its = await DB.listByTrip('planning_items', 'trip-demo-1');
    const x = its.find((i) => !i.deleted_at && i.place_name);
    const t = await DB.get('trips', 'trip-demo-1');
    await TripDetail.openPlanningCardMenu(t, x);
    return x.place_name;
  });
  await sleep(p, 900);
  ok((await opciones()).includes('Cómo llegar'), 'con lugar sí', conSitio);
  await cerrarHoja();

  titulo('EL ALOJAMIENTO');
  await p.evaluate(() => TripDetail._irADia(window.__dias.hoy, { animar: false }));
  await sleep(p, 1200);
  const hayLlave = await p.evaluate(() => !!document.querySelector('.timeline-item.has-keycard .li-more'));
  ok(hayLlave, 'la tarjeta del alojamiento también tiene su •••');
  if (hayLlave) {
    await p.evaluate(() => document.querySelector('.timeline-item.has-keycard .li-more').click());
    await sleep(p, 900);
    const kc = await opciones();
    ok(kc.includes('Editar') && kc.includes('Eliminar'), 'y abre el menú del alojamiento', kc);
    await cerrarHoja();
  }

  titulo('PLEGAR TODO');
  ok(!(await p.evaluate(() => [...document.querySelectorAll('.plan-collapse-bar button')].map((x) => x.textContent)))
      .some((x) => /Plegar todo/.test(x)),
    'el botón "Plegar todo" ya no está: con un día por pantalla solo dejaba pantallas vacías');

  terminar(errs);
  await cerrar();
})();
