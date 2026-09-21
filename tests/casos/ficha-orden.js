/* Mover de sitio los bloques de la ficha de una parada.
 *
 * Cómo quieres ver una parada no es cosa del aparato, así que esto NO va a
 * localStorage como el tema o el último perfil: va a `ui_prefs`, una fila por
 * perfil que viaja por la misma cola que el resto y aparece en el otro
 * dispositivo. Lo que se comprueba aquí es eso y dos trampas: que el orden
 * valga para TODAS las paradas, y que un bloque que esta parada no tiene no
 * pierda su sitio. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir({ abrir: false });

  const abrirFicha = async (id) => {
    await p.evaluate(async (id) => {
      const t = await DB.get('trips', 'trip-demo-1');
      TripDetail.openPlanningDetail(t, await DB.get('planning_items', id));
    }, id);
    await sleep(p, 1400);
  };
  const cerrarFicha = async () => {
    await p.evaluate(() => document.querySelector('.detailview .flash-close')?.click());
    await sleep(p, 900);
  };
  const bloques = () => p.evaluate(() => [...document.querySelectorAll('.dv-block')].map((x) => x.dataset.bloque));
  const modo = async () => {
    await p.evaluate(() => document.querySelector('.dv-ord-btn').click());
    await sleep(p, 700);
  };
  const subir = async (id) => {
    const tope = await p.evaluate((id) => {
      const b = [...document.querySelectorAll('.dv-block')].find((x) => x.dataset.bloque === id);
      const up = b.querySelector('.dv-ord button');
      if (up.disabled) return true;
      up.click(); return false;
    }, id);
    await sleep(p, 500);
    return tope;
  };

  titulo('EL ORDEN DE FÁBRICA');
  await abrirFicha('vuelo-demo');
  const inicial = await bloques();
  ok(inicial[0] === 'cuando' && inicial[inicial.length - 1] === 'notas',
    'de arriba abajo: cuándo … notas', inicial);

  titulo('EL MODO ORDENAR');
  await modo();
  const m = await p.evaluate(() => ({
    clase: document.querySelector('.detailview').classList.contains('dv-ordenando'),
    aviso: document.querySelector('.dv-ord-hint span')?.textContent || '',
    flechas: [...document.querySelectorAll('.dv-block')].map((b) => b.querySelectorAll('.dv-ord button').length),
    primeroTope: document.querySelector('.dv-block .dv-ord button').disabled,
    notaEditable: document.querySelector('.dv-rt').getAttribute('contenteditable'),
  }));
  ok(m.clase && m.flechas.every((n) => n === 2), 'cada bloque saca sus dos flechas', m.flechas);
  ok(m.primeroTope, 'el de arriba no puede subir más');
  ok(/flechas/.test(m.aviso), 'y se explica qué hacer', m.aviso);
  ok(m.notaEditable === 'false',
    'mientras se ordena, la nota no se escribe: la flecha y el cursor se estorbaban', m.notaEditable);
  await p.screenshot({ path: captura('ficha-ordenando.png') });

  titulo('SUBIR NOTAS ARRIBA DEL TODO');
  for (let i = 0; i < 8; i++) if (await subir('notas')) break;
  let orden = await bloques();
  ok(orden[0] === 'notas', 'las notas quedan las primeras', orden);
  ok(orden.length === inicial.length, 'y no se ha perdido ningún bloque por el camino', orden);

  titulo('SE GUARDA EN ui_prefs, NO EN localStorage');
  const g = await p.evaluate(async () => ({
    pref: Prefs.get('ficha_orden'),
    fila: await DB.db.get('ui_prefs', Prefs._id()),
    enCola: (await DB.db.getAll('_pending')).filter((x) => x.table === 'ui_prefs').length,
    enLocalStorage: Object.keys(localStorage).filter((k) => /ficha_orden|ficha-orden/.test(k)),
  }));
  ok(Array.isArray(g.pref) && g.pref[0] === 'notas', 'el orden está en las preferencias del perfil', g.pref);
  ok(g.fila && g.fila.profile === 'ruben', 'en su fila de ui_prefs', g.fila && g.fila.id);
  ok(g.enCola > 0, 'encolada para subir: por eso aparece en el otro dispositivo', `${g.enCola} en cola`);
  ok(g.enLocalStorage.length === 0, 'y NO en localStorage, que se queda en este aparato', g.enLocalStorage);

  titulo('UN BLOQUE QUE ESTA PARADA NO TIENE NO PIERDE SU SITIO');
  // Un vuelo no lleva "Quién". Si el orden guardado solo tuviera los bloques de
  // esta parada, al ordenar aquí se borraría el sitio de los demás.
  ok(g.pref.includes('quien'), '"Quién" sigue en la lista aunque aquí no se vea', g.pref);

  titulo('VALE PARA TODAS LAS PARADAS');
  await cerrarFicha();
  await abrirFicha('vuelo-demo');
  ok((await bloques())[0] === 'notas', 'al reabrir la misma parada, sigue');
  await cerrarFicha();
  await abrirFicha('hotel-demo');
  const hotel = await bloques();
  ok(hotel[0] === 'notas', 'y en otra parada distinta, también', hotel);
  await p.screenshot({ path: captura('ficha-orden.png') });

  titulo('SALIR DEL MODO');
  // Reabrir la ficha ya sale del modo: es un modo de este rato, no un ajuste.
  ok(!(await p.evaluate(() => document.querySelector('.detailview').classList.contains('dv-ordenando'))),
    'abrir otra parada vuelve al modo normal');
  await modo();
  await p.evaluate(() => document.querySelector('.dv-ord-hint .btn').click());
  await sleep(p, 700);
  const fuera = await p.evaluate(() => ({
    clase: document.querySelector('.detailview').classList.contains('dv-ordenando'),
    flechas: document.querySelectorAll('.dv-ord').length,
    notaEditable: document.querySelector('.dv-rt').getAttribute('contenteditable'),
  }));
  ok(!fuera.clase && fuera.flechas === 0, '"Listo" quita las flechas', fuera);
  ok(fuera.notaEditable === 'true', 'y la nota vuelve a escribirse');

  titulo('UN ORDEN GUARDADO AL QUE LE FALTA UN BLOQUE NO LO ESCONDE');
  // Lo guardado manda sobre lo que conoce, no sobre lo que no conoce: si mañana
  // hay un bloque nuevo, sale al final en vez de desaparecer.
  const conHueco = await p.evaluate(async () => {
    await Prefs.set('ficha_orden', ['notas', 'cuando']);
    return ordenFicha();
  });
  ok(conHueco[0] === 'notas' && conHueco.includes('contacto') && conHueco.includes('reserva'),
    'los que no estaban en lo guardado se colocan detrás', conHueco);
  ok(conHueco.length === 7, 'y están todos', `${conHueco.length}`);

  titulo('UNA PREFERENCIA NO ES UN CAMBIO DEL VIAJE');
  const cambios = await p.evaluate(async () => {
    const antes = await DB.get('planning_items', 'hotel-demo');
    return { updated: antes.updated_at };
  });
  await cerrarFicha();
  await abrirFicha('hotel-demo');
  await modo();
  await subir('cuando');
  await cerrarFicha();
  const despues = await p.evaluate(async () => (await DB.get('planning_items', 'hotel-demo')).updated_at);
  ok(despues === cambios.updated, 'reordenar no toca la parada', `${cambios.updated} → ${despues}`);

  terminar(errs);
  await cerrar();
})();
