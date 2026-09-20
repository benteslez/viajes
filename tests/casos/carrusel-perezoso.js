/* El carrusel monta las páginas según se llega a ellas. Un viaje largo no puede
 * costar montar treinta días de golpe antes de enseñar el primero. */
const { abrir, espera: sleep, ok, titulo, terminar } = require('../lib');

const DIAS = 30, PARADAS = 6;

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir({ abrir: false });

  titulo(`VIAJE LARGO (${DIAS} días × ${PARADAS} paradas)`);
  await p.evaluate(async ({ dias, paradas }) => {
    const f = (n) => { const d = new Date(); d.setDate(d.getDate() + n);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
    const t = await DB.get('trips', 'trip-demo-1');
    t.start_date = f(-5); t.end_date = f(dias - 6); await DB.put('trips', t);
    const tipos = ['lugar','comida','actividad','hotel','transporte','compras'];
    for (let d = -5; d <= dias - 6; d++) for (let i = 0; i < paradas; i++) {
      await DB.put('planning_items', { id:`big-${d}-${i}`, trip_id:'trip-demo-1', profile:dataProfile(),
        type: tipos[i % tipos.length], day_date: f(d), time:`0${8+i}:00`, title:`Parada ${d}.${i}`,
        place_name:`Sitio ${d}.${i}, Bogotá`, metadata:{}, order_index:i });
    }
  }, { dias: DIAS, paradas: PARADAS });

  const t0 = Date.now();
  await p.evaluate(async () => { await Router.go('trip', { tripId:'trip-demo-1', tab:'planning' }); });
  await p.waitForSelector('.plan-pager .plan-page .timeline-item', { timeout: 30000 });
  const ms = Date.now() - t0;
  await sleep(p, 2500);

  const contar = () => p.evaluate(() => ({
    paginas: document.querySelectorAll('.plan-page').length,
    montadas: [...document.querySelectorAll('.plan-page')].filter((x) => x.querySelector('.timeline-list')).length,
    paradas: document.querySelectorAll('.plan-pager .timeline-item').length,
    nodos: document.querySelectorAll('#view-root *').length,
    dia: TripDetail._diaVisible,
    pendientes: TripDetail._pintores ? TripDetail._pintores.size : -1,
    anchoPagina: Math.round(document.querySelector('.plan-page').getBoundingClientRect().width),
    anchoVentana: window.innerWidth,
  }));

  const a = await contar();
  console.log(`   (render: ${ms} ms)`);
  ok(a.paginas === DIAS, 'están las páginas de todos los días', String(a.paginas));
  ok(a.montadas <= 3, 'pero solo se monta el día visible y sus dos vecinos', String(a.montadas));
  ok(a.nodos < 3000, 'el planning entra con pocos nodos en pantalla', `${a.nodos} nodos`);
  ok(Math.abs(a.anchoPagina - a.anchoVentana) <= 1,
    'una página sin montar ocupa igual su pantalla', `${a.anchoPagina} vs ${a.anchoVentana}`);

  titulo('LO QUE SE VISITA SE MONTA');
  const dias = await p.evaluate(() => [...document.querySelectorAll('.day-pill')].map((x) => x.dataset.day));
  await p.evaluate((k) => TripDetail._irADia(k, { animar: false }), dias[dias.length - 1]);
  await sleep(p, 1500);
  const b = await contar();
  ok(b.dia === dias[dias.length - 1], 'saltar al último día llega', `${b.dia}`);
  ok(b.paradas > a.paradas, 'y monta sus paradas al llegar', `${a.paradas} → ${b.paradas}`);
  ok(await p.evaluate(() => {
    const pg = document.querySelector('.plan-pager');
    const i = Math.round(pg.scrollLeft / (pg.clientWidth || 1));
    return pg.querySelectorAll('.plan-page')[i].querySelectorAll('.timeline-item').length;
  }) >= PARADAS, 'el día que se ve nunca sale vacío');

  titulo('RECORRER EL VIAJE ENTERO');
  for (const k of dias) {
    await p.evaluate((d) => TripDetail._irADia(d, { animar: false }), k);
    await sleep(p, 130);
  }
  await sleep(p, 2500);
  const c = await contar();
  ok(c.pendientes === 0, 'al pasar por todos los días no queda ninguno sin montar', String(c.pendientes));
  ok(c.montadas === DIAS, 'y están las páginas montadas', String(c.montadas));
  ok(c.paradas >= DIAS * PARADAS, 'con todas las paradas', `${c.paradas} (esperadas ≥ ${DIAS * PARADAS})`);

  titulo('LO QUE SE MONTA TARDE SIGUE VIVO');
  const tarde = await p.evaluate(() => {
    const pg = document.querySelector('.plan-pager');
    const pag = [...pg.querySelectorAll('.plan-page')].pop();
    const it = pag.querySelector('.timeline-item:not(.virtual)');
    return { arrastrable: it.getAttribute('draggable'), enganchada: !!it._dndListo, tieneMenu: !!pag.querySelector('.li-more') };
  });
  ok(tarde.enganchada, 'una parada montada tarde queda enganchada al arrastre', tarde);
  ok(tarde.tieneMenu, 'y con su botón de acciones');

  terminar(errs);
  await cerrar();
})();
