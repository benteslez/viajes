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

  terminar(errs);
  await cerrar();
})();
