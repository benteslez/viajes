/* Mover un día entero a otra fecha.
 *
 * El hermano de "correr las horas": aquello mueve el reloj dentro del día, esto
 * mueve el día en el calendario. Lo que más importa: que se lleve las dos
 * fechas de una reserva de varios días, que NO se lleve lo que solo pasa por
 * aquí (la noche de un hotel que entró otro día) y que el título del día no
 * pise el del destino. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir({ abrir: false });
  const d = await p.evaluate(() => window.__dias);
  const mas = (iso, n) => p.evaluate(([i, k]) => {
    const x = parseDate(i); x.setDate(x.getDate() + k); return isoLocal(x);
  }, [iso, n]);

  const abrirHoja = async (dia) => {
    await p.evaluate(async (dia) => {
      const t = await DB.get('trips', 'trip-demo-1');
      await TripDetail.openMoverDia(t, dia);
    }, dia);
    await sleep(p, 1000);
  };
  const filas = () => p.evaluate(() => [...document.querySelectorAll('.cd-lista .cd-fila')].map((f) => ({
    tit: f.querySelector('.cd-tit').textContent,
    de: f.querySelector('.cd-hora s').textContent,
    a: f.querySelector('.cd-hora b').textContent,
    marcada: f.querySelector('input').checked,
  })));
  const pie = () => p.evaluate(() => {
    const b = document.querySelector('#sheet-foot .btn-primary');
    return { texto: b.textContent, off: !!b.disabled,
             aviso: document.querySelector('.cd .field-hint')?.textContent || '' };
  });
  const chip = (txt) => p.evaluate((t) => [...document.querySelectorAll('.cd-chip')]
    .find((x) => x.textContent.includes(t)).click(), txt);
  const enDia = (dia) => p.evaluate(async (dia) => {
    const its = (await DB.listByTrip('planning_items', 'trip-demo-1')).filter((x) => !x.deleted_at);
    return its.filter((x) => (x.day_date || x.consultation_planned_d1) === dia).length;
  }, dia);

  titulo('SOLO LO QUE EMPIEZA ESE DÍA');
  // El hotel entra hoy y dura hasta pasado mañana: su noche se ve mañana, pero
  // el registro vive en el día de la entrada. Moviendo "mañana" no debe irse.
  await abrirHoja(d.manana);
  let f = await filas();
  ok(f.length > 0, 'la hoja lista las paradas del día', f.map((x) => x.tit));
  ok(!f.some((x) => /Hotel Buenos Aires/.test(x.tit)),
    'la noche de un hotel que entró otro día no está: se mueve desde su entrada', f.map((x) => x.tit));
  ok(f.every((x) => x.marcada), 'todas vienen marcadas');
  await p.screenshot({ path: captura('mover-dia.png') });

  titulo('EL MISMO DÍA NO ES MOVER');
  let pi = await pie();
  ok(pi.off && /ese es el de ahora/.test(pi.aviso), 'con el día de ahora, no deja aplicar', pi);

  titulo('+7 DÍAS');
  await chip('+7');
  await sleep(p, 400);
  f = await filas();
  const destino = await mas(d.manana, 7);
  ok(f.every((x) => x.de !== x.a), 'cada parada enseña su fecha nueva al lado de la vieja', f[0]);
  pi = await pie();
  ok(/Mover \d+ parada/.test(pi.texto), 'y el botón dice cuántas se mueven', pi.texto);

  titulo('UNA RESERVA DE VARIOS DÍAS SE LLEVA SUS DOS FECHAS');
  // Si no, mover el día de la recogida dejaría un coche de nueve días
  // convertido en uno de dos.
  await p.evaluate(() => UI.closeSheet()); await sleep(p, 500);
  const rango = await p.evaluate(async (d) => {
    await DB.put('planning_items', { id:'coche-mv', trip_id:'trip-demo-1', profile:dataProfile(),
      type:'coche', title:'Coche', order_index:0, day_date:d.manana,
      consultation_planned_d1:d.manana, consultation_planned_t1:'10:00',
      consultation_planned_d2:d.fin, consultation_planned_t2:'18:00', metadata:{} });
    return true;
  }, d);
  ok(rango, 'sembrado un coche de varios días');
  await abrirHoja(d.manana);
  await chip('+7'); await sleep(p, 400);
  const fCoche = (await filas()).find((x) => x.tit === 'Coche');
  ok(fCoche && / – /.test(fCoche.de) && / – /.test(fCoche.a),
    'en la lista enseña las dos fechas, antes y después', fCoche);

  titulo('DESMARCAR DEJA UNA PARADA DONDE ESTABA');
  await p.evaluate(() => {
    const f = [...document.querySelectorAll('.cd-lista .cd-fila')].find((x) => x.querySelector('.cd-tit').textContent === 'Coche');
    f.querySelector('input').click();
  });
  await sleep(p, 400);
  const antesOrigen = await enDia(d.manana);
  const antesDestino = await enDia(destino);
  await p.evaluate(() => document.querySelector('#sheet-foot .btn-primary').click());
  await sleep(p, 2500);

  titulo('LO QUE QUEDA DESPUÉS');
  const trasOrigen = await enDia(d.manana);
  const trasDestino = await enDia(destino);
  ok(trasOrigen === 1, 'en el origen solo queda lo que se desmarcó', `${antesOrigen} → ${trasOrigen}`);
  ok(trasDestino === antesDestino + (antesOrigen - 1),
    'y el resto está en el destino', `${antesDestino} → ${trasDestino}`);
  const coche = await p.evaluate(async () => {
    const x = await DB.get('planning_items', 'coche-mv');
    return { d1: x.consultation_planned_d1, d2: x.consultation_planned_d2 };
  });
  ok(coche.d1 === d.manana, 'el coche desmarcado no se ha movido', coche);
  const restos = await p.evaluate(async () => {
    const its = (await DB.listByTrip('planning_items', 'trip-demo-1')).filter((x) => !x.deleted_at);
    return its.flatMap((x) => Object.keys(x).filter((k) => k.startsWith('_')));
  });
  ok(restos.length === 0, 'y no se ha guardado ningún marcador de los de pintar', restos);

  titulo('EL TÍTULO DEL DÍA SE VA CON ÉL');
  const nota = await p.evaluate(async () => {
    const ns = (await DB.listByTrip('day_notes', 'trip-demo-1')).filter((x) => !x.deleted_at);
    return ns.map((x) => ({ t: (x.title || '').slice(0, 24), date: x.date }));
  });
  ok(nota.some((n) => n.date === destino),
    'la etiqueta del día viaja con sus paradas', nota);

  titulo('UN DÍA VACÍO NO SE MUEVE');
  // El primer día del viaje no tiene paradas en la semilla: la hoja ni se abre.
  const avisos = [];
  await p.exposeFunction('__toastMv', (m) => avisos.push(m));
  await p.evaluate(() => { const o = UI.toast; UI.toast = (m) => { window.__toastMv(m); return o(m); }; });
  await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    await TripDetail.openMoverDia(t, window.__dias.inicio);
  });
  await sleep(p, 600);
  ok(avisos.some((m) => /nada que mover/.test(m)), 'se dice y no se abre una hoja vacía', avisos);
  // `.cd` puede seguir en el DOM de la hoja anterior: lo que importa es que la
  // hoja no esté ABIERTA.
  ok(!(await p.evaluate(() => !!document.querySelector('#sheet.show'))), 'la hoja no se abre');

  titulo('PERO NO PISA LA DEL DESTINO');
  await p.evaluate(async () => {
    // Una etiqueta en el día de origen (ayer, que sí tiene paradas) y otra en
    // el de destino.
    await DB.put('day_notes', { id:'nota-orig', trip_id:'trip-demo-1', profile:dataProfile(),
      date: window.__dias.ayer, title:'Origen', color:'azul', text:'' });
    await DB.put('day_notes', { id:'nota-dest', trip_id:'trip-demo-1', profile:dataProfile(),
      date: window.__dias.pasado, title:'Ya ocupado', color:'verde', text:'' });
  });
  await abrirHoja(d.ayer);
  const libre = await p.evaluate(() => {
    const f = [...document.querySelectorAll('.cd .cd-fila')].filter((x) => !x.closest('.cd-lista'))[0];
    return f && { txt: f.textContent, off: f.querySelector('input').disabled, chk: f.querySelector('input').checked };
  });
  ok(libre && !libre.off && libre.chk && /Origen/.test(libre.txt),
    'con el destino libre, la etiqueta se lleva y viene marcada', libre);
  const dosDias = await p.evaluate(async (hasta) => {
    const inp = document.querySelector('.md-fecha');
    inp.value = hasta; inp.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 300));
    const f = [...document.querySelectorAll('.cd .cd-fila')].filter((x) => !x.closest('.cd-lista'))[0];
    return f ? { txt: f.textContent, off: f.querySelector('input').disabled, chk: f.querySelector('input').checked } : null;
  }, d.pasado);
  ok(dosDias && dosDias.off && !dosDias.chk && /ya tiene su propio título/.test(dosDias.txt),
    'si el destino ya tiene etiqueta, la del origen no se puede llevar', dosDias);
  // Y al volver a un destino libre, se vuelve a ofrecer: la casilla no es un
  // interruptor de un solo sentido.
  const vuelta = await p.evaluate(async (hasta) => {
    const inp = document.querySelector('.md-fecha');
    inp.value = hasta; inp.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 300));
    const f = [...document.querySelectorAll('.cd .cd-fila')].filter((x) => !x.closest('.cd-lista'))[0];
    return f && { off: f.querySelector('input').disabled, chk: f.querySelector('input').checked };
  }, await mas(d.ayer, 10));
  ok(vuelta && !vuelta.off && vuelta.chk, 'y al elegir otro día libre vuelve a ofrecerse', vuelta);
  await p.evaluate(() => UI.closeSheet()); await sleep(p, 500);

  titulo('Y AVISA DE LO QUE NO SE VE');
  await abrirHoja(d.manana);
  await p.evaluate(async () => {
    const inp = document.querySelector('.md-fecha');
    const x = parseDate(window.__dias.fin); x.setDate(x.getDate() + 30);
    inp.value = isoLocal(x); inp.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 300));
  });
  ok(/fuera de las del viaje/.test((await pie()).aviso),
    'una fecha fuera del viaje se avisa, pero no se prohíbe', (await pie()).aviso);
  await p.evaluate(() => UI.closeSheet()); await sleep(p, 400);

  terminar(errs);
  await cerrar();
})();
