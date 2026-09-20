/* Viaje EN CURSO: los días que ya han pasado se apagan en gris pero siguen
 * ahí y se entra en ellos; el planning se abre en hoy. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();

  const estado = () => p.evaluate(() => {
    const pg = document.querySelector('.plan-pager');
    const pills = [...document.querySelectorAll('.day-pill')].map((x) => ({
      d: x.dataset.day, pasada: x.classList.contains('past'), activa: x.classList.contains('active'),
      fondo: getComputedStyle(x).backgroundColor,
      numero: getComputedStyle(x.querySelector('b')).color,
    }));
    const pags = [...pg.querySelectorAll('.plan-page')].map((x) => ({
      d: x.dataset.day, apagada: x.classList.contains('day-past'), visible: !!x.offsetParent,
    }));
    const g = pg.querySelector('.plan-page.day-past .day-group');
    return {
      hoy: todayIso(), dia: TripDetail._diaVisible,
      activa: document.querySelector('.day-pill.active')?.dataset.day,
      botonVerAnteriores: !!document.querySelector('.show-past-btn'),
      pills, pags,
      cabeceraPasada: g ? getComputedStyle(g.querySelector('.day-head')).backgroundImage : null,
      badgePasado: g ? getComputedStyle(g.querySelector('.day-badge')).backgroundColor : null,
      cabeceraHoy: getComputedStyle(pg.querySelector('.plan-page:not(.day-past) .day-head')).backgroundImage,
    };
  });

  titulo('AL ENTRAR EN UN VIAJE EN CURSO');
  const e = await estado();
  const pasadas = e.pills.filter((x) => x.pasada);
  const futuras = e.pills.filter((x) => !x.pasada && !x.activa);

  ok(e.dia === e.hoy, 'el planning se abre en hoy', `${e.dia} (hoy ${e.hoy})`);
  ok(e.activa === e.hoy, 'la pastilla de hoy sale marcada', e.activa);
  ok(pasadas.length >= 2, 'hay días pasados que apagar', String(pasadas.length));
  ok(!e.botonVerAnteriores, 'ya no hay botón "Ver días anteriores"');
  ok(e.pags.filter((x) => x.apagada).length === pasadas.length,
    'las páginas de los días pasados llevan la marca', String(e.pags.filter((x) => x.apagada).length));
  ok(e.pags.every((x) => x.visible), 'ninguna página queda escondida',
    `${e.pags.filter((x) => x.visible).length}/${e.pags.length} visibles`);

  titulo('EL APAGADO SE VE');
  ok(pasadas.every((x) => x.fondo !== futuras[0].fondo),
    'la pastilla pasada no se pinta como una futura', `${pasadas[0].fondo} vs ${futuras[0].fondo}`);
  ok(pasadas.every((x) => x.numero !== futuras[0].numero),
    'el número del día pasado va en gris', `${pasadas[0].numero} vs ${futuras[0].numero}`);
  ok(e.cabeceraPasada === 'none' && e.cabeceraHoy !== 'none',
    'la cabecera del día pasado pierde el degradado de color', `pasado=${e.cabeceraPasada}`);
  ok(!!e.badgePasado, 'el cuadradito de fecha del día pasado se pinta aparte', e.badgePasado);
  await p.screenshot({ path: captura('dias-pasados.png') });

  titulo('PERO SE ENTRA IGUAL');
  const primera = pasadas[0].d;
  await p.evaluate((k) => document.querySelector(`.day-pill[data-day="${k}"]`).click(), primera);
  await sleep(p, 1500);
  const dentro = await p.evaluate(() => {
    const pg = document.querySelector('.plan-pager');
    const i = Math.round(pg.scrollLeft / (pg.clientWidth || 1));
    const pag = pg.querySelectorAll('.plan-page')[i];
    return { dia: TripDetail._diaVisible, alto: Math.round(pag.getBoundingClientRect().height) };
  });
  ok(dentro.dia === primera, 'tocar la pastilla de un día pasado entra en él', `${primera} → ${dentro.dia}`);
  ok(dentro.alto > 100, 'y la página se pinta entera, no en blanco', `${dentro.alto}px`);

  const conParadas = pasadas[pasadas.length - 1].d;
  await p.evaluate((k) => TripDetail._irADia(k, { animar: false }), conParadas);
  await sleep(p, 1200);
  const paradas = await p.evaluate((k) =>
    document.querySelectorAll(`.plan-page[data-day="${k}"] .timeline-item`).length, conParadas);
  ok(paradas > 0, 'un día pasado con paradas las enseña todas', `${paradas} paradas`);

  titulo('VOLVER A ENTRAR');
  await p.evaluate(() => TripDetail._irADia(window.__dias.manana, { animar: false }));
  await sleep(p, 1000);
  const antes = await p.evaluate(() => TripDetail._diaVisible);
  await p.evaluate(async () => { await Router.go('trips'); });
  await sleep(p, 900);
  await p.evaluate(async () => { await Router.go('trip', { tripId: 'trip-demo-1', tab: 'planning' }); });
  await sleep(p, 2000);
  const vuelta = await p.evaluate(() => TripDetail._diaVisible);
  ok(vuelta === e.hoy, 'salir del viaje y volver deja otra vez en hoy', `${antes} → ${vuelta}`);

  titulo('CAMBIAR DE PESTAÑA NO PIERDE EL DÍA');
  await p.evaluate(() => TripDetail._irADia(window.__dias.manana, { animar: false }));
  await sleep(p, 900);
  const guardado = await p.evaluate(() => TripDetail._diaVisible);
  await p.evaluate(() => TripDetail.irAPestana('resumen', -1));
  await sleep(p, 1200);
  await p.evaluate(() => TripDetail.irAPestana('planning', 1));
  await sleep(p, 1600);
  ok(await p.evaluate(() => TripDetail._diaVisible) === guardado,
    'resumen → planning conserva el día', guardado);

  titulo('VIAJE TERMINADO: NO SE APAGA NADA');
  await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    t.start_date = '2020-01-01'; t.end_date = '2020-01-05'; await DB.put('trips', t);
    await Router.go('trips');
    await Router.go('trip', { tripId: 'trip-demo-1', tab: 'planning' });
  });
  await sleep(p, 1800);
  const apagadosFin = await p.evaluate(() => document.querySelectorAll('.day-group.day-past').length);
  ok(apagadosFin === 0, 'en un viaje pasado no se apaga ningún día', String(apagadosFin));

  terminar(errs);
  await cerrar();
})();
