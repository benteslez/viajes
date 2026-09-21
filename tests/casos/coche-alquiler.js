/* Un coche de alquiler dura días, como un hotel.
 *
 * Y sin embargo solo aparecía el día de recogerlo: los días siguientes no
 * sabías que lo tenías, y el de devolverlo no salía en ninguna parte. Se expande
 * igual que un alojamiento —mismo mecanismo de filas virtuales— en una fila
 * discreta "Coche alquilado" los días de en medio y una "Devolución" con su
 * hora el último. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir({ abrir: false });

  titulo('SE EXPANDE COMO UN ALOJAMIENTO');
  const exp = await p.evaluate(async () => {
    await DB.put('planning_items', {
      id:'coche-demo', trip_id:'trip-demo-1', profile:dataProfile(), type:'coche',
      title:'Coche Yucatán', status:'confirmado', order_index:0,
      day_date: window.__dias.inicio,
      consultation_planned_d1: window.__dias.inicio, consultation_planned_t1:'10:00',
      consultation_planned_d2: window.__dias.fin,    consultation_planned_t2:'18:30',
      metadata:{ compania:'Hertz', modelo:'Toyota Aygo', matricula:'1234 ABC',
                 lugar_recogida:'Aeropuerto MID', lugar_devolucion:'Aeropuerto CUN' },
    });
    const raw = (await DB.listByTrip('planning_items', 'trip-demo-1')).filter((x) => !x.deleted_at);
    return TripDetail._expandHotels(raw).filter((x) => x.id === 'coche-demo')
      .map((x) => ({ d: x.day_date, v: x._virtual || 'real', t: x.time || null }));
  });
  const d = await p.evaluate(() => window.__dias);
  ok(exp.length === 9, 'del día de recogida al de devolución hay nueve filas', `${exp.length}`);
  ok(exp[0].v === 'real' && exp[0].d === d.inicio,
    'la primera es el registro de verdad, el que se edita', exp[0]);
  ok(exp[exp.length - 1].v === 'return' && exp[exp.length - 1].d === d.fin,
    'y la última, la devolución, el día que toca', exp[exp.length - 1]);
  ok(exp[exp.length - 1].t === '18:30', 'con su hora', exp[exp.length - 1].t);
  ok(exp.slice(1, -1).every((x) => x.v === 'rental' && !x.t),
    'las de en medio son "coche alquilado" y no llevan hora', exp.slice(1, -1).map((x) => x.v));
  // Un solo día (recogida y devolución el mismo) no genera nada: no hay "en medio".
  const unDia = await p.evaluate(async () => {
    const x = await DB.get('planning_items', 'coche-demo');
    const copia = { ...x, id:'coche-1dia', consultation_planned_d2: x.consultation_planned_d1 };
    return TripDetail._expandHotels([copia]).length;
  });
  ok(unDia === 1, 'recoger y devolver el mismo día se queda en una sola fila', `${unDia}`);

  titulo('EL DÍA DE EN MEDIO');
  await p.evaluate(() => Router.go('trip', { tripId:'trip-demo-1', tab:'planning' }));
  await sleep(p, 2500);
  const filasDe = async (dia) => {
    await p.evaluate((x) => TripDetail._irADia(x), dia);
    await sleep(p, 1500);
    return p.evaluate((x) => {
      const pag = document.querySelector(`.plan-page[data-day="${x}"]`);
      return [...pag.querySelectorAll('.timeline-item')].map((n) => ({
        tit: n.querySelector('.li-title-text')?.textContent || null,
        kick: n.querySelector('.mk-t')?.textContent || null,
        sub: (n.querySelector('.li-sub, .li-subrow')?.textContent || '').trim(),
        hora: n.querySelector('.li-time-a')?.textContent || null,
        emoji: (n.querySelector('.item-emoji, .li-out span')?.textContent || '').trim(),
        virtual: n.classList.contains('virtual'),
        arrastrable: n.getAttribute('draggable'),
      }));
    }, dia);
  };
  let filas = await filasDe(d.hoy);
  const coche = filas.find((f) => f.tit === 'Coche alquilado');
  ok(!!coche, 'sale la fila del coche', filas.map((f) => f.tit));
  ok(coche.emoji === '🚗', 'con el icono del coche al lado', coche.emoji);
  ok(/Día 4 de 9/.test(coche.sub), 'y diciendo por qué día del alquiler va', coche.sub);
  ok(/Coche Yucatán/.test(coche.sub), 'y de qué coche habla', coche.sub);
  ok(coche.virtual && coche.arrastrable === 'false',
    'es una fila derivada: ni se arrastra ni se toca (las fechas las pone el registro)', coche);
  await p.screenshot({ path: captura('coche-medio.png') });

  titulo('NO REPITE LOS DATOS DEL COCHE');
  // El repaso de metadata del tipo (compañía, modelo, matrícula) es para la fila
  // de verdad; en las copias sobraba y dejaba un subtítulo kilométrico.
  ok(!/Hertz|Toyota|1234/.test(coche.sub), 'la compañía y la matrícula no van aquí', coche.sub);

  titulo('EL DÍA DE LA DEVOLUCIÓN');
  filas = await filasDe(d.fin);
  const dev = filas.find((f) => f.kick === 'Devolución');
  ok(!!dev, 'sale la devolución, con su rótulo', filas.map((f) => f.kick));
  ok(dev.tit === 'Coche Yucatán', 'titulada con el coche, como el check-out con el hotel', dev.tit);
  ok(/18:30/.test(dev.sub), 'con la hora de devolver', dev.sub);
  ok(/Aeropuerto CUN/.test(dev.sub) && /Hertz/.test(dev.sub),
    'y dónde y a quién se devuelve', dev.sub);
  await p.screenshot({ path: captura('coche-devolucion.png') });

  titulo('EDITAR DESDE UNA COPIA TOCA EL REGISTRO DE VERDAD');
  // Una fila virtual es una COPIA con el mismo id: el editor tiene que volver a
  // las fechas del alquiler, no quedarse con el día de la copia.
  await p.evaluate(async () => {
    const raw = (await DB.listByTrip('planning_items', 'trip-demo-1')).filter((x) => !x.deleted_at);
    const copia = TripDetail._expandHotels(raw).find((x) => x._virtual === 'rental');
    const t = await DB.get('trips', 'trip-demo-1');
    await TripDetail.openPlanningEditor(t, copia);
  });
  await sleep(p, 1500);
  const ed = await p.evaluate(() => ({
    d1: document.getElementById('tr-d1')?.value, t1: document.getElementById('tr-t1')?.value,
    d2: document.getElementById('tr-d2')?.value, t2: document.getElementById('tr-t2')?.value,
  }));
  ok(ed.d1 === d.inicio && ed.d2 === d.fin,
    'el editor abre con las fechas del alquiler, no con el día de la copia', ed);
  ok(ed.t1 === '10:00' && ed.t2 === '18:30', 'y con sus horas', ed);
  await p.evaluate(() => UI.closeSheet()); await sleep(p, 600);

  titulo('LAS COPIAS NO CUENTAN COMO PARADA');
  const cuenta = await p.evaluate((dia) => {
    const pag = document.querySelector(`.plan-page[data-day="${dia}"]`);
    return pag?.querySelector('.day-meta-row, .day-head')?.textContent || '';
  }, d.hoy);
  ok(!/2 paradas/.test(cuenta), 'el día no se apunta el coche como una parada más', cuenta.trim().slice(0, 60));

  terminar(errs);
  await cerrar();
})();
