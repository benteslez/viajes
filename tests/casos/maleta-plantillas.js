/* Plantillas de maleta que traen su propio grupo.
 *
 * `applyTemplate` metía todo en las categorías fijas (ropa, aseo…), así que las
 * cosas de una persona —las de un bebé, por ejemplo— caían mezcladas con las de
 * los adultos y había que separarlas a mano después: justo el trabajo que la
 * plantilla venía a ahorrar. Ahora un elemento puede declarar `grupo` y el
 * grupo se crea en el viaje si no está. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir({ abrir: false });

  const maleta = () => p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    const its = (await DB.listByTrip('packing_items', 'trip-demo-1')).filter((x) => !x.deleted_at);
    return { grupos: (t.packing_categories || []).map((c) => c.label), items: its.length,
             cats: [...new Set(its.map((x) => x.category))] };
  });
  const aplicar = (nombre) => p.evaluate(async (n) => {
    const t = await DB.get('trips', 'trip-demo-1');
    await TripDetail.applyTemplate(t, n, PACKING_TEMPLATES[n]);
  }, nombre);

  titulo('CON LA MALETA VACÍA SE PUEDE LLEGAR A LAS PLANTILLAS');
  // El estado vacío decía "o aplica una plantilla" y se iba con un `return`
  // antes de pintar el botón que hace justo eso: en el único momento en que
  // hace falta —empezar de cero— no había forma de llegar.
  await p.evaluate(() => Router.go('trip', { tripId: 'trip-demo-1', tab: 'maleta' }));
  await sleep(p, 2200);
  const vacia = await p.evaluate(() => ({
    sinNada: !!document.querySelector('.empty'),
    items: document.querySelectorAll('.pack-group').length,
    boton: [...document.querySelectorAll('.pack-templates button')].map((b) => b.textContent.trim()),
    seVe: [...document.querySelectorAll('.pack-templates button')].some((b) => b.checkVisibility()),
  }));
  ok(vacia.sinNada && vacia.items === 0, 'la maleta del viaje empieza vacía', vacia);
  ok(vacia.boton.some((x) => /Aplicar plantilla/.test(x)) && vacia.seVe,
    'y aun así sale "Aplicar plantilla"', vacia.boton);
  ok(!vacia.boton.some((x) => /Crear plantilla/.test(x)),
    'pero no "Crear plantilla con esta lista", que no tendría qué guardar', vacia.boton);
  // Y se llega de verdad al listado, no es un botón decorativo.
  await p.evaluate(() => [...document.querySelectorAll('.pack-templates button')]
    .find((b) => /Aplicar plantilla/.test(b.textContent)).click());
  await sleep(p, 900);
  const picker = await p.evaluate(() =>
    [...document.querySelectorAll('#sheet .list-item .li-title')].map((x) => x.textContent));
  ok(picker.includes('Pablo · bebé de 6 a 12 meses'),
    'el botón abre el listado y la plantilla de Pablo está ahí', picker);
  await p.evaluate(() => UI.closeSheet()); await sleep(p, 600);
  await p.screenshot({ path: captura('maleta-vacia.png') });

  titulo('LAS DOS PLANTILLAS EXISTEN');
  const tpls = await p.evaluate(() => Object.keys(PACKING_TEMPLATES));
  ok(tpls.includes('Colombia · clima cálido y lluvias'), 'la del viaje', tpls);
  ok(tpls.includes('Pablo · bebé de 6 a 12 meses'), 'y la de Pablo', tpls);

  titulo('LA DEL VIAJE REPARTE POR LAS CATEGORÍAS DE SIEMPRE');
  const antes = await maleta();
  await aplicar('Colombia · clima cálido y lluvias');
  await sleep(p, 1200);
  const tras1 = await maleta();
  ok(tras1.items > antes.items + 25, 'entra la lista entera', { antes: antes.items, ahora: tras1.items });
  ok(['ropa', 'aseo', 'documentos', 'tecnología', 'otros'].every((c) => tras1.cats.includes(c)),
    'repartida por ropa, aseo, documentos, tecnología y otros', tras1.cats);
  ok(tras1.grupos.length === antes.grupos.length,
    'y sin inventarse ningún grupo nuevo', tras1.grupos);

  titulo('LA DE PABLO SE CREA SU GRUPO');
  await aplicar('Pablo · bebé de 6 a 12 meses');
  await sleep(p, 1500);
  const tras2 = await maleta();
  ok(tras2.grupos.includes('Pablo'), 'aparece el grupo "Pablo" en el viaje', tras2.grupos);
  const dentro = await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    const g = (t.packing_categories || []).find((c) => c.label === 'Pablo');
    const its = (await DB.listByTrip('packing_items', 'trip-demo-1')).filter((x) => !x.deleted_at);
    const suyos = its.filter((x) => x.category === g.id);
    return { id: g.id, n: suyos.length,
             fuera: its.filter((x) => x.template_source === 'Pablo · bebé de 6 a 12 meses' && x.category !== g.id).length,
             ejemplo: suyos.map((x) => x.name).find((n) => /portabeb/i.test(n)) };
  });
  ok(/^cg_pablo_/.test(dentro.id), 'con un id de grupo personalizado', dentro.id);
  ok(dentro.n >= 35 && dentro.fuera === 0,
    'y TODAS sus cosas dentro, ninguna suelta entre las de los adultos', dentro);
  ok(/portabeb/i.test(dentro.ejemplo || ''), 'incluida la mochila portabebés', dentro.ejemplo);

  titulo('APLICARLA DOS VECES NO DUPLICA EL GRUPO');
  await aplicar('Pablo · bebé de 6 a 12 meses');
  await sleep(p, 1500);
  const tras3 = await maleta();
  ok(tras3.grupos.filter((g) => g === 'Pablo').length === 1,
    'sigue habiendo un solo "Pablo", no dos', tras3.grupos);

  titulo('Y SE VE EN LA MALETA');
  await p.evaluate(() => Router.go('trip', { tripId: 'trip-demo-1', tab: 'maleta' }));
  await sleep(p, 2200);
  const pintado = await p.evaluate(() => {
    const titulos = [...document.querySelectorAll('.pack-group')].map((g) =>
      (g.querySelector('.pack-group-title, .li-title, h3, summary')?.textContent || '').trim());
    return { grupos: titulos, hayPablo: titulos.some((x) => /Pablo/.test(x)) };
  });
  ok(pintado.hayPablo, 'el grupo "Pablo" sale en la pestaña Maleta', pintado.grupos);
  await p.screenshot({ path: captura('maleta-plantillas.png'), fullPage: true });

  titulo('EL EDITOR: RENOMBRAR, AÑADIR Y QUITAR DESDE PERFIL');
  await p.evaluate(() => Router.go('perfil'));
  await sleep(p, 1800);
  const perfil = await p.evaluate(() => ({
    secciones: [...document.querySelectorAll('.section-title')].map((x) => x.textContent),
    nueva: [...document.querySelectorAll('button')].some((b) => /Nueva plantilla/.test(b.textContent)),
    sistema: [...document.querySelectorAll('.list-item .li-title')].map((x) => x.textContent),
  }));
  ok(perfil.secciones.includes('Mis plantillas de maleta') && perfil.secciones.includes('Plantillas del sistema'),
    'Perfil separa las tuyas de las del sistema', perfil.secciones);
  ok(perfil.nueva, 'y ofrece crear una nueva');
  ok(perfil.sistema.includes('Pablo · bebé de 6 a 12 meses'),
    'las del sistema se listan para poder copiarlas', perfil.sistema.length + ' en total');

  // Copiar una del sistema: la copia ya es tuya y se edita.
  await p.evaluate(() => {
    const f = [...document.querySelectorAll('.list-item')].find((x) => /Pablo · beb/.test(x.textContent));
    f.querySelector('.icon-btn').click();
  });
  await sleep(p, 1000);
  const ed = await p.evaluate(() => ({
    titulo: document.querySelector('.sheet-title')?.textContent,
    grupos: [...document.querySelectorAll('.tpl-g-nom')].map((x) => x.value),
    items: document.querySelectorAll('.tpl-fila').length,
  }));
  ok(ed.titulo === 'Copiar plantilla', 'se abre como copia, no pisando la del sistema', ed.titulo);
  ok(ed.grupos.length === 1 && ed.grupos[0] === 'Pablo',
    'y los 40 elementos van bajo UNA cabecera de grupo, no 40 veces "Pablo"', ed);
  ok(ed.items === 40, 'con sus 40 elementos', ed.items);

  // Renombrar el grupo, quitar un elemento y añadir otro.
  await p.evaluate(() => {
    const g = document.querySelector('.tpl-g-nom');
    g.value = 'Cosas de Pablo'; g.dispatchEvent(new Event('change'));
  });
  await sleep(p, 400);
  await p.evaluate(() => document.querySelector('.tpl-fila .icon-btn').click());
  await sleep(p, 400);
  await p.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => /Añadir elemento/.test(b.textContent)).click());
  await sleep(p, 400);
  await p.evaluate(() => {
    const vacios = [...document.querySelectorAll('.tpl-nom')].filter((x) => !x.value);
    const i = vacios[vacios.length - 1];
    i.value = 'Orinal de viaje'; i.dispatchEvent(new Event('input'));
    const n = document.getElementById('tpl-nombre');
    n.value = 'Pablo en Colombia'; n.dispatchEvent(new Event('input'));
  });
  await p.evaluate(() => [...document.querySelectorAll('#sheet-foot button')]
    .find((x) => /^Guardar$/.test(x.textContent.trim())).click());
  await sleep(p, 1500);
  const guardada = await p.evaluate(async () => {
    const ts = await DB.listByProfile('packing_templates', dataProfile());
    const t = ts.find((x) => x.name === 'Pablo en Colombia');
    return t ? { n: t.items.length, grupos: [...new Set(t.items.map((i) => i.grupo))],
                 nuevo: t.items.some((i) => i.name === 'Orinal de viaje'),
                 porId: t.items.some((i) => /^cg_/.test(i.category || '')) } : null;
  });
  ok(guardada && guardada.n === 40, 'se guarda con 40 (quitado uno, añadido otro)', guardada);
  ok(guardada.grupos.length === 1 && guardada.grupos[0] === 'Cosas de Pablo',
    'el grupo renombrado, de una vez para todos sus elementos', guardada.grupos);
  ok(guardada.nuevo, 'y el elemento nuevo dentro');
  ok(!guardada.porId,
    'guardada por NOMBRE de grupo, no por el id de un viaje concreto', guardada);

  titulo('Y SIRVE PARA CUALQUIER VIAJE');
  // El id `cg_pablo_*` solo existe en el viaje donde se creó. Una plantilla
  // guardada con ese id dejaba sus cosas en un grupo que el otro viaje no
  // conoce; por eso se guarda la etiqueta.
  const otro = await p.evaluate(async () => {
    const id = 'trip-otro-' + Date.now();
    await DB.put('trips', { id, profile: dataProfile(), name:'Otro viaje', city:'X',
      start_date: todayIso(), end_date: todayIso(), default_currency:'EUR', in_preparation:true, settings:{} });
    const t = await DB.get('trips', id);
    const ts = await DB.listByProfile('packing_templates', dataProfile());
    const tpl = ts.find((x) => x.name === 'Pablo en Colombia');
    await TripDetail.applyTemplate(t, tpl.name, tpl.items);
    const fresco = await DB.get('trips', id);
    const its = (await DB.listByTrip('packing_items', id)).filter((x) => !x.deleted_at);
    const g = (fresco.packing_categories || []).find((c) => c.label === 'Cosas de Pablo');
    return { grupos: (fresco.packing_categories || []).map((c) => c.label),
             dentro: g ? its.filter((x) => x.category === g.id).length : 0,
             huerfanos: its.filter((x) => /^cg_/.test(x.category) && (!g || x.category !== g.id)).length };
  });
  ok(otro.grupos.includes('Cosas de Pablo'),
    'al aplicarla en un viaje nuevo, el grupo se crea allí', otro.grupos);
  ok(otro.dentro === 40 && otro.huerfanos === 0,
    'con sus 40 cosas dentro y ninguna en un grupo sin nombre', otro);

  // En modo edición el nombre del grupo es un <input>, y el valor de un input
  // no está en `textContent`: buscar por texto no encontraba ningún grupo.
  const grupoLlamado = (txt) => p.evaluate((n) => {
    const g = [...document.querySelectorAll('.pack-group')].find((x) => {
      const i = x.querySelector('.pack-group-title-input, .pack-group-title');
      const nombre = (i && 'value' in i ? i.value : i?.textContent) || '';
      return new RegExp(n).test(nombre);
    });
    if (!g) return false;
    g.querySelector('.pack-group-act[title="Borrar grupo"]').click();
    return true;
  }, txt);

  titulo('BORRAR UN GRUPO ENTERO DESDE EL MODO EDICIÓN');
  await p.evaluate(() => Router.go('trip', { tripId: 'trip-demo-1', tab: 'maleta' }));
  await sleep(p, 2200);
  await p.evaluate(() => { TripDetail._packingEditMode = true; Router.render(); });
  await sleep(p, 1600);
  const botones = await p.evaluate(() => {
    const gs = [...document.querySelectorAll('.pack-group')];
    return gs.map((g) => ({
      nombre: (g.querySelector('.pack-group-title-input')?.value
        || g.querySelector('.pack-group-title')?.textContent || '').trim(),
      borrar: !!g.querySelector('.pack-group-act[title="Borrar grupo"]'),
    }));
  });
  ok(botones.length > 1, 'la maleta tiene varios grupos', botones.map((b) => b.nombre));
  ok(botones.every((b) => b.borrar),
    'TODOS llevan papelera, no solo los personalizados', botones);

  // Con cosas dentro se pregunta qué hacer: no es lo mismo tirarlas que moverlas.
  const antesTotal = await p.evaluate(async () =>
    (await DB.listByTrip('packing_items', 'trip-demo-1')).filter((x) => !x.deleted_at).length);
  // Lo que se borra es de ESTE viaje. La plantilla de la que salió no se toca:
  // son dos sitios distintos y confundirlos sería perder la lista entera.
  const tplAntes = await p.evaluate(async () => {
    const ts = await DB.listByProfile('packing_templates', dataProfile());
    const t = ts.find((x) => x.name === 'Pablo en Colombia');
    return t ? { n: t.items.length, json: JSON.stringify(t.items) } : null;
  });
  ok(tplAntes && tplAntes.n === 40, 'antes de borrar, la plantilla tiene sus 40', tplAntes && tplAntes.n);
  ok(await grupoLlamado('Pablo'), 'se abre el menú del grupo Pablo');
  await sleep(p, 900);
  const opciones = await p.evaluate(() =>
    [...document.querySelectorAll('.menu-parada .res-fila .res-fila-lbl')].map((x) => x.textContent));
  ok(opciones.length === 2, 'salen las dos opciones, no un sí/no', opciones);
  ok(opciones.some((x) => /Borrar el grupo y sus \d+ cosas/.test(x)),
    'borrar el grupo con sus cosas', opciones);
  ok(opciones.some((x) => /Quitar solo el grupo/.test(x)),
    'o quitar solo el grupo y conservarlas', opciones);
  await p.screenshot({ path: captura('maleta-borrar-grupo.png') });

  await p.evaluate(() => [...document.querySelectorAll('.menu-parada .res-fila')]
    .find((b) => /Borrar el grupo y sus/.test(b.querySelector('.res-fila-lbl').textContent)).click());
  await sleep(p, 1800);
  const tras = await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    // `listByTrip` ya deja fuera lo borrado: para ver la papelera hay que leer
    // el almacén en crudo, que es donde `DB.remove` deja el `deleted_at`.
    const crudo = (await DB.db.getAll('packing_items')).filter((x) => x.trip_id === 'trip-demo-1');
    return {
      grupos: (t.packing_categories || []).map((c) => c.label),
      vivos: (await DB.listByTrip('packing_items', 'trip-demo-1')).length,
      enPapelera: crudo.filter((x) => x.deleted_at).length,
    };
  });
  ok(!tras.grupos.includes('Pablo'), 'el grupo desaparece del viaje', tras.grupos);
  ok(tras.vivos === antesTotal - 80, 'y sus cosas con él (80: se aplicó dos veces)',
    { antes: antesTotal, ahora: tras.vivos });
  ok(tras.enPapelera >= 80, 'a la papelera, recuperables, no borradas del todo', tras.enPapelera);
  const tplDespues = await p.evaluate(async () => {
    const ts = await DB.listByProfile('packing_templates', dataProfile());
    const t = ts.find((x) => x.name === 'Pablo en Colombia');
    return t ? { n: t.items.length, json: JSON.stringify(t.items) } : null;
  });
  ok(tplDespues && tplDespues.json === tplAntes.json,
    'y la PLANTILLA se queda intacta: se ha borrado de este viaje, no de ella',
    { antes: tplAntes.n, despues: tplDespues && tplDespues.n });
  // Y se puede volver a aplicar, que es la prueba de que sigue sirviendo.
  const rehecho = await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    const ts = await DB.listByProfile('packing_templates', dataProfile());
    const tpl = ts.find((x) => x.name === 'Pablo en Colombia');
    await TripDetail.applyTemplate(t, tpl.name, tpl.items);
    const fresco = await DB.get('trips', 'trip-demo-1');
    const its = await DB.listByTrip('packing_items', 'trip-demo-1');
    const g = (fresco.packing_categories || []).find((c) => c.label === 'Cosas de Pablo');
    return g ? its.filter((x) => x.category === g.id).length : 0;
  });
  ok(rehecho === 40, 'volver a aplicarla la devuelve entera al viaje', rehecho);

  titulo('Y UN GRUPO FIJO TAMBIÉN');
  // Volver a aplicar la plantilla repinta y deja el modo edición fuera: sin
  // esto no hay papeleras en las cabeceras y no se encuentra ningún grupo.
  await p.evaluate(() => Router.go('trip', { tripId: 'trip-demo-1', tab: 'maleta' }));
  await sleep(p, 2000);
  await p.evaluate(() => { TripDetail._packingEditMode = true; Router.render(); });
  await sleep(p, 1600);
  // "Ropa" no es personalizado y antes no tenía ni botón.
  ok(await grupoLlamado('Ropa'), 'se abre el menú del grupo Ropa');
  await sleep(p, 900);
  await p.evaluate(() => [...document.querySelectorAll('.menu-parada .res-fila')]
    .find((b) => /Quitar solo el grupo/.test(b.querySelector('.res-fila-lbl').textContent)).click());
  await sleep(p, 1800);
  const traRopa = await p.evaluate(async () => {
    const its = (await DB.listByTrip('packing_items', 'trip-demo-1')).filter((x) => !x.deleted_at);
    return { enRopa: its.filter((x) => x.category === 'ropa').length,
             enOtros: its.filter((x) => x.category === 'otros').length };
  });
  ok(traRopa.enRopa === 0 && traRopa.enOtros > 0,
    '"Quitar solo el grupo" vacía Ropa y sus cosas acaban en Otros', traRopa);

  terminar(errs);
  await cerrar();
})();
