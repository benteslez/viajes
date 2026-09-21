/* Gasto rápido y conversor.
 *
 * En un viaje se apunta un gasto diez veces al día; el editor completo pide
 * ocho cosas. Aquí solo importe, concepto y categoría, con la fecha, la moneda
 * y el estado deducidos. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir({ abrir: 'presu' });

  // Tasa conocida y fija: la de la red no está disponible en las pruebas.
  await p.evaluate(async () => {
    STATE.rates = { base: 'EUR', rates: { COP: 4000, USD: 1.1 }, ts: Date.now() };
    const t = await DB.get('trips', 'trip-demo-1');
    t.default_currency = 'COP'; await DB.put('trips', t);
    await Router.render();
  });
  await sleep(p, 1200);

  const abrirRapido = async () => {
    await p.evaluate(async () => { const t = await DB.get('trips', 'trip-demo-1'); TripDetail.openQuickExpense(t); });
    await sleep(p, 700);
  };
  const escribir = (id, v) => p.evaluate(([id, v]) => {
    const n = document.getElementById(id); n.value = v; n.dispatchEvent(new Event('input')); n.dispatchEvent(new Event('change'));
  }, [id, v]);
  const pulsar = (txt) => p.evaluate((txt) => [...document.querySelectorAll('#sheet-foot button')]
    .find((x) => x.textContent.trim() === txt).click(), txt);
  const gastos = () => p.evaluate(async () => (await DB.listByTrip('budget_items', 'trip-demo-1'))
    .filter((x) => !x.deleted_at && !['b1', 'b2', 'b3'].includes(x.id))
    .map((x) => ({ c: x.concept, a: x.amount, cur: x.currency, eur: x.amount_eur, cat: x.category, st: x.status, d: x.date })));

  titulo('LA HOJA PIDE LO JUSTO');
  await abrirRapido();
  const campos = await p.evaluate(() => ({
    titulo: document.querySelector('#sheet .sheet-title, #sheet h2, #sheet-head')?.textContent?.trim().slice(0, 20),
    inputs: [...document.querySelectorAll('#sheet-body input, #sheet-body select, #sheet-body textarea')].map((x) => x.id || x.type),
    cats: [...document.querySelectorAll('.qe-cat')].map((x) => x.textContent),
    enfocado: document.activeElement?.id,
    pie: [...document.querySelectorAll('#sheet-foot button')].map((x) => x.textContent.trim()),
  }));
  ok(campos.inputs.length === 2, 'solo dos campos: importe y concepto', campos.inputs);
  ok(campos.cats.length === 6, 'y las categorías como pastillas', campos.cats.join(', '));
  ok(campos.enfocado === 'qe-amount', 'el importe sale ya enfocado', campos.enfocado);
  ok(campos.pie.includes('Guardar y otro'), 'con un "Guardar y otro" para encadenar', campos.pie);
  await p.screenshot({ path: captura('gasto-rapido.png') });

  titulo('EL EQUIVALENTE EN EUROS SE VE AL TECLEAR');
  await escribir('qe-amount', '20000');
  await sleep(p, 300);
  const eq = await p.evaluate(() => document.querySelector('.qe .field-hint')?.textContent);
  ok(/5[,.]00/.test(eq || ''), '20.000 COP a 4000/€ son 5 €', eq);

  titulo('LA CATEGORÍA SE DEDUCE DEL CONCEPTO');
  await escribir('qe-concept', 'taxi al aeropuerto');
  await sleep(p, 300);
  ok(await p.evaluate(() => document.querySelector('.qe-cat.on')?.textContent) === 'Transporte',
    '"taxi" cae en Transporte sin tocar nada');
  await escribir('qe-concept', 'cena con Noelia');
  await sleep(p, 300);
  ok(await p.evaluate(() => document.querySelector('.qe-cat.on')?.textContent) === 'Comida',
    'y "cena" en Comida');

  titulo('GUARDAR');
  await pulsar('Guardar');
  await sleep(p, 1500);
  let g = await gastos();
  ok(g.length === 1, 'se guarda un gasto', g);
  ok(g[0].a === 20000 && g[0].cur === 'COP', 'con el importe y la moneda del viaje', `${g[0].a} ${g[0].cur}`);
  ok(g[0].eur === 5, 'y su equivalente en euros ya calculado', g[0].eur);
  ok(g[0].cat === 'comida' && g[0].st === 'pagado', 'categoría deducida y estado "pagado"', `${g[0].cat} · ${g[0].st}`);
  const hoy = await p.evaluate(() => todayIso());
  ok(g[0].d === hoy, 'con fecha de hoy', g[0].d);

  titulo('"GUARDAR Y OTRO" ENCADENA SIN CERRAR');
  await abrirRapido();
  await escribir('qe-amount', '8000');
  await escribir('qe-concept', 'café');
  await pulsar('Guardar y otro');
  await sleep(p, 1200);
  const tras = await p.evaluate(() => ({
    abierta: !!document.querySelector('#sheet.show'),
    importe: document.getElementById('qe-amount')?.value,
    concepto: document.getElementById('qe-concept')?.value,
    enfocado: document.activeElement?.id,
  }));
  ok(tras.abierta, 'la hoja sigue abierta');
  ok(tras.importe === '' && tras.concepto === '', 'con los campos limpios', tras);
  ok(tras.enfocado === 'qe-amount', 'y el foco de vuelta en el importe', tras.enfocado);
  await escribir('qe-amount', '3000');
  await escribir('qe-concept', 'agua');
  await pulsar('Guardar');
  await sleep(p, 1500);
  g = await gastos();
  ok(g.length === 3, 'los tres gastos están', g.map((x) => x.c).join(', '));

  titulo('SIN IMPORTE NO SE GUARDA');
  const avisos = [];
  await p.exposeFunction('__toast', (m) => avisos.push(m));
  await p.evaluate(() => { const o = UI.toast; UI.toast = (m) => { window.__toast(m); return o(m); }; });
  await abrirRapido();
  await escribir('qe-concept', 'sin importe');
  await pulsar('Guardar');
  await sleep(p, 900);
  ok(avisos.some((m) => /importe/i.test(m)) && await p.evaluate(() => !!document.querySelector('#sheet.show')),
    'avisa y no cierra', avisos);
  ok((await gastos()).length === 3, 'y no ha creado nada');
  await p.evaluate(() => UI.closeSheet()); await sleep(p, 500);

  titulo('"MÁS OPCIONES" PASA LO ESCRITO AL EDITOR COMPLETO');
  await abrirRapido();
  await escribir('qe-amount', '12345');
  await escribir('qe-concept', 'entradas al museo');
  await p.evaluate(() => document.querySelector('.qe-mas').click());
  await sleep(p, 1200);
  const completo = await p.evaluate(() => ({
    concepto: document.getElementById('fb-concept')?.value,
    importe: document.getElementById('fb-amount')?.value,
    cat: document.getElementById('fb-cat')?.value,
    moneda: document.getElementById('fb-cur')?.value,
    borrar: [...document.querySelectorAll('#sheet-foot button')].some((x) => /Borrar/.test(x.textContent)),
  }));
  ok(completo.concepto === 'entradas al museo' && completo.importe === '12345',
    'llega con el concepto y el importe puestos', completo);
  ok(completo.cat === 'actividades', 'y con la categoría deducida', completo.cat);
  ok(completo.moneda === 'COP', 'y la moneda del viaje', completo.moneda);
  ok(!completo.borrar, 'sin botón de Borrar: es un gasto nuevo, no una edición');
  await p.evaluate(() => UI.closeSheet()); await sleep(p, 600);

  titulo('EL CONVERSOR');
  await p.evaluate(() => TripDetail.irAPestana('presu', 1)); await sleep(p, 1400);
  const conv = await p.evaluate(() => {
    const d = document.querySelector('.conv');
    return { hay: !!d, resumen: d?.querySelector('.conv-s')?.textContent };
  });
  ok(conv.hay, 'está en el presupuesto');
  ok(/1 €/.test(conv.resumen || '') && /4\.?000/.test(conv.resumen || ''),
    'y dice la tasa sin abrirlo, en el sentido en que se piensa', conv.resumen);
  const ida = await p.evaluate(() => {
    const d = document.querySelector('.conv'); d.open = true;
    const [a, b] = d.querySelectorAll('input');
    a.value = '40000'; a.dispatchEvent(new Event('input'));
    return b.value;
  });
  ok(ida === '10', '40.000 COP → 10 €', ida);
  const vuelta = await p.evaluate(() => {
    const [a, b] = document.querySelectorAll('.conv input');
    b.value = '25'; b.dispatchEvent(new Event('input'));
    return a.value;
  });
  ok(vuelta === '100000', 'y 25 € → 100.000 COP (va en los dos sentidos)', vuelta);

  titulo('EN UN VIAJE EN EUROS NO HAY NADA QUE CONVERTIR');
  await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1'); t.default_currency = 'EUR'; await DB.put('trips', t);
    await Router.render();
  });
  await sleep(p, 1400);
  ok(await p.evaluate(() => document.querySelectorAll('.conv').length) === 0,
    'el conversor no aparece');

  terminar(errs);
  await cerrar();
})();
