/* El cartel "Próximo".
 *
 * Marcaba el siguiente evento del viaje pasara lo que pasara, así que un viaje
 * planificado para dentro de cinco meses llevaba media vida diciendo
 * "PRÓXIMO · en 138 d" dentro del billete. Eso no avisa de nada y le quita el
 * sitio a los datos que sí importan. Ahora se enciende a tres días de la salida
 * y se queda encendido mientras dura el viaje. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir({ abrir: false });

  // Mueve el viaje entero: la salida a D+n y las paradas con él, conservando la
  // distancia entre ellas. Así el "próximo evento" existe siempre y lo único que
  // cambia es lo cerca que está el viaje.
  const viajeEmpiezaEn = async (n) => p.evaluate(async (n) => {
    const t = await DB.get('trips', 'trip-demo-1');
    const desplaza = (iso, dias) => { const d = parseDate(iso); d.setDate(d.getDate() + dias); return isoLocal(d); };
    if (!window.__base) {
      window.__base = { t: { s: t.start_date, e: t.end_date },
        items: (await DB.listByTrip('planning_items', 'trip-demo-1')).map((x) => ({ id: x.id, d: x.day_date, d1: x.consultation_planned_d1, d2: x.consultation_planned_d2 })) };
    }
    const salto = daysBetween(window.__base.t.s, todayIso()) + n;
    t.start_date = desplaza(window.__base.t.s, salto);
    t.end_date = desplaza(window.__base.t.e, salto);
    t.in_preparation = false;
    await DB.put('trips', t);
    for (const b of window.__base.items) {
      const x = await DB.get('planning_items', b.id);
      if (!x) continue;
      if (b.d) x.day_date = desplaza(b.d, salto);
      if (b.d1) x.consultation_planned_d1 = desplaza(b.d1, salto);
      if (b.d2) x.consultation_planned_d2 = desplaza(b.d2, salto);
      await DB.put('planning_items', x);
    }
    return { inicio: t.start_date, hoy: todayIso(), faltan: daysBetween(todayIso(), t.start_date) };
  }, n);

  // En el planning, `dia` lleva el carrusel a esa página: el cartel solo puede
  // salir en el día que se está pintando, y el planning abre en HOY.
  const verEn = async (tab, dia) => {
    await p.evaluate((tab) => Router.go('trip', { tripId: 'trip-demo-1', tab }), tab);
    await sleep(p, 2200);
    if (dia) {
      await p.evaluate(async (d) => {
        const x = await DB.get('planning_items', 'vuelo-demo');
        TripDetail._irADia(x.day_date);
      }, dia);
      await sleep(p, 1600);
    }
    return p.evaluate(() => ({
      enTarjeta: document.querySelectorAll('.card-next-tag').length,
      enBarra: document.querySelectorAll('.next-event .ne-tag').length,
      resaltadas: document.querySelectorAll('.is-next').length,
    }));
  };

  titulo('LA REGLA, EN SECO');
  const regla = await p.evaluate(() => {
    const d = (n) => { const x = parseDate(todayIso()); x.setDate(x.getDate() + n); return isoLocal(x); };
    return {
      dentro3: avisaProximo({ start_date: d(3), end_date: d(9) }),
      justo4:  avisaProximo({ start_date: d(4), end_date: d(9) }),
      lejos:   avisaProximo({ start_date: d(60), end_date: d(70) }),
      hoy:     avisaProximo({ start_date: todayIso(), end_date: d(5) }),
      enCurso: avisaProximo({ start_date: d(-2), end_date: d(3) }),
      pasado:  avisaProximo({ start_date: d(-20), end_date: d(-10) }),
      sinFecha: avisaProximo({ start_date: null, end_date: null }),
      umbral: DIAS_AVISO_PROXIMO,
    };
  });
  ok(regla.umbral === 3, 'el umbral son tres días', String(regla.umbral));
  ok(regla.dentro3 === true && regla.justo4 === false,
    'a 3 días sí, a 4 todavía no', { dentro3: regla.dentro3, justo4: regla.justo4 });
  ok(regla.hoy === true && regla.enCurso === true, 'y durante el viaje, siempre', regla);
  ok(regla.pasado === false, 'un viaje terminado no tiene nada próximo');
  ok(regla.sinFecha === false, 'y uno sin fechas no tiene cuenta atrás que hacer');

  titulo('UN VIAJE DENTRO DE UN MES: NI RASTRO');
  let info = await viajeEmpiezaEn(30);
  ok(info.faltan === 30, 'el viaje se ha movido a 30 días vista', info);
  let r = await verEn('planning', true);
  ok(r.enTarjeta === 0 && r.resaltadas === 0, 'ni en el día del vuelo, dentro del planning', r);
  await p.screenshot({ path: captura('proximo-lejos.png') });
  r = await verEn('resumen');
  ok(r.enTarjeta === 0 && r.enBarra === 0, 'y en el resumen del viaje, tampoco', r);

  titulo('A CUATRO DÍAS, TODAVÍA NO');
  await viajeEmpiezaEn(4);
  r = await verEn('planning', true);
  ok(r.enTarjeta === 0, 'sigue sin salir', r);

  titulo('A TRES DÍAS, YA');
  info = await viajeEmpiezaEn(3);
  ok(info.faltan === 3, 'el viaje empieza dentro de tres días', info);
  r = await verEn('planning', true);
  ok(r.enTarjeta > 0, 'ahora sí aparece en la tarjeta', r);
  await p.screenshot({ path: captura('proximo-cerca.png') });
  r = await verEn('resumen');
  ok(r.enTarjeta + r.enBarra > 0, 'y en el resumen, también', r);

  titulo('DE VIAJE, QUE ES PARA LO QUE ESTÁ');
  await viajeEmpiezaEn(-1);
  r = await verEn('resumen');
  ok(r.enTarjeta + r.enBarra > 0, 'con el viaje empezado sigue avisando', r);

  terminar(errs);
  await cerrar();
})();
