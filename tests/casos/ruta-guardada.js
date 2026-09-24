/* La ruta real, guardada con el viaje.
 *
 * El tiempo por carretera solo se puede pedir con conexión (OSRM). Se guardaba
 * únicamente en el localStorage del aparato, así que:
 *   · el portátil enseñaba la estimación en línea recta de un trayecto que el
 *     móvil ya tenía medido;
 *   · limpiar el navegador las perdía todas;
 *   · y el tope de la caché tiraba las más antiguas aunque se miraran a diario.
 * Ahora viven en `settings` del viaje —que sincroniza— y mandan siempre sobre
 * la estimación. Se rehacen solas al mes, y solo si hay conexión. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();
  const dias = await p.evaluate(() => window.__dias);

  // OSRM de mentira: 99 km / 2 h, muy lejos de cualquier estimación, para que
  // no haya duda de cuál de las dos se está viendo.
  const falsoOsrm = () => p.evaluate(() => {
    const real = window.fetch;
    window.__osrm = 0;
    window.fetch = (u, o) => {
      if (String(u).includes('router.project-osrm.org')) {
        window.__osrm++;
        const n = (String(u).match(/;/g) || []).length;
        return Promise.resolve({ ok: true, json: async () => ({
          routes: [{ legs: Array.from({ length: n }, () => ({ distance: 99000, duration: 7200 })) }] }) });
      }
      return real(u, o);
    };
  });
  // Le damos coordenadas a dos paradas del mismo día para que haya tramo.
  const prepararDia = () => p.evaluate(async (d) => {
    const its = (await DB.listByTrip('planning_items', 'trip-demo-1')).filter((x) => x.day_date === d);
    const pts = [[6.7621, -73.1727], [6.6357, -73.2264]];
    let i = 0;
    for (const x of its) {
      if (i >= 2) break;
      if (x.type === 'hotel') continue;
      x.lat = pts[i][0]; x.lng = pts[i][1]; i++;
      await DB.put('planning_items', x);
    }
    return i;
  }, dias.ayer);
  const mirar = () => p.evaluate((d) => {
    const g = [...document.querySelectorAll('.day-group')].find((x) => x.dataset.day === d);
    return {
      chips: [...(g ? g.querySelectorAll('.leg-chip') : [])].map((c) => c.textContent),
      verdes: g ? g.querySelectorAll('.leg-src.online').length : 0,
      total: (() => { const s = g?.querySelector('.day-route-summary'); return s && s.style.display !== 'none' ? s.textContent : ''; })(),
    };
  }, dias.ayer);
  const irAlDia = async () => { await p.evaluate((d) => TripDetail._irADia(d), dias.ayer); await sleep(p, 2200); };

  titulo('CON CONEXIÓN: SE PIDE Y SE GUARDA CON EL VIAJE');
  ok(await prepararDia() === 2, 'el día de ayer tiene dos paradas con coordenadas');
  await falsoOsrm();
  await p.evaluate(() => Router.render());
  await irAlDia();
  const conRed = await mirar();
  ok(/99,0 km/.test(conRed.chips.join('|')), 'el tramo sale con la ruta real, no con la estimación', conRed.chips);
  ok(conRed.verdes >= 1, 'y marcado como real (punto verde)', conRed.verdes);

  const guardada = await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    const r = (t.settings || {}).rutas || {};
    const k = Object.keys(r);
    return { n: k.length, primera: k.length ? r[k[0]] : null, conFecha: k.every((x) => !!r[x].ts) };
  });
  ok(guardada.n >= 1, 'la ruta queda guardada en el viaje, no solo en el aparato', guardada);
  ok(guardada.primera && Math.round(guardada.primera.km) === 99 && guardada.primera.min === 120,
    'con su distancia y su tiempo por carretera', guardada.primera);
  ok(guardada.conFecha, 'y con la fecha en que se calculó, para saber cuándo caduca');

  titulo('SIN CONEXIÓN Y SIN CACHÉ DEL APARATO: MANDA LA GUARDADA');
  // Se borra la caché local y se corta la red: es el caso del otro dispositivo,
  // o el de haber limpiado el navegador. Antes aquí volvía la línea recta.
  const sinRed = await p.evaluate(async () => {
    localStorage.removeItem('viajes_routecache');
    Object.keys(_routeCache).forEach((k) => delete _routeCache[k]);
    window.fetch = () => Promise.reject(new Error('sin red'));
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
    await Router.render();
    return true;
  });
  ok(sinRed, 'caché del aparato borrada y red cortada');
  await irAlDia();
  const off = await mirar();
  ok(/99,0 km/.test(off.chips.join('|')),
    'el tramo sigue siendo el real por carretera, no la línea recta', off.chips);
  ok(off.verdes >= 1, 'y se sigue marcando como real', off.verdes);
  ok(/99,0 km/.test(off.total), 'y el total del día cuenta ese tiempo', off.total);
  await p.screenshot({ path: captura('ruta-guardada-offline.png') });

  titulo('NO SE PIDE OTRA VEZ SI NO HACE FALTA');
  await p.evaluate(() => { Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true }); });
  await falsoOsrm();
  await p.evaluate(() => Router.render());
  await irAlDia();
  ok(await p.evaluate(() => window.__osrm) === 0,
    'con la ruta guardada y fresca, no se vuelve a preguntar a OSRM');

  titulo('AL MES SE REHACE, SI HAY CONEXIÓN');
  await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    const r = t.settings.rutas;
    Object.keys(r).forEach((k) => { r[k].ts = Date.now() - 40 * 24 * 3600 * 1000; r[k].km = 10; r[k].min = 20; });
    await DB.put('trips', t);
    Object.keys(_routeCache).forEach((k) => delete _routeCache[k]);
    localStorage.removeItem('viajes_routecache');
  });
  await p.evaluate(() => Router.render());
  await irAlDia();
  await sleep(p, 1500);
  ok(await p.evaluate(() => window.__osrm) >= 1, 'una ruta de hace 40 días se vuelve a pedir');
  const refrescada = await mirar();
  ok(/99,0 km/.test(refrescada.chips.join('|')), 'y se queda la nueva', refrescada.chips);

  titulo('CADUCADA PERO SIN CONEXIÓN: NO SE TIRA LO QUE HAY');
  await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    Object.keys(t.settings.rutas).forEach((k) => { t.settings.rutas[k].ts = 0; });
    await DB.put('trips', t);
    Object.keys(_routeCache).forEach((k) => delete _routeCache[k]);
    window.fetch = () => Promise.reject(new Error('sin red'));
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
  });
  await p.evaluate(() => Router.render());
  await irAlDia();
  const caducadaOffline = await mirar();
  ok(/99,0 km/.test(caducadaOffline.chips.join('|')),
    'sin red, una ruta caducada se sigue usando antes que estimar en línea recta', caducadaOffline.chips);

  terminar(errs);
  await cerrar();
})();
