/* La nota de una parada, con formato.
 *
 * Dos cosas mandan aquí. Una: `notes` se queda en TEXTO PLANO, porque media app
 * lo lee —el buscador, el PDF, la guía, el subtítulo de la tarjeta, el .ics— y
 * ninguna de esas sabe pintar HTML. El formato viaja aparte, en
 * `metadata.notes_html`. Y dos: ese HTML puede venir de un pegado o de otro
 * dispositivo, así que nada se pinta sin pasar por la lista blanca. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir({ abrir: false });

  const abrirFicha = async (id = 'vuelo-demo') => {
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
  const guardado = () => p.evaluate(async () => {
    const x = await DB.get('planning_items', 'vuelo-demo');
    return { notes: x.notes || null, html: (x.metadata || {}).notes_html || null };
  });
  // Escribe en la caja y sale de ella, que es cuando se guarda.
  const escribir = async (txt) => {
    await p.evaluate((txt) => {
      const c = document.querySelector('.dv-rt');
      c.innerHTML = ''; c.focus();
      document.execCommand('insertText', false, txt);
    }, txt);
    await sleep(p, 200);
  };
  const negrita = (desde, hasta) => p.evaluate(([a, b]) => {
    const c = document.querySelector('.dv-rt');
    const t = c.firstChild;
    const r = document.createRange(); r.setStart(t, a); r.setEnd(t, b);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.querySelector('.dv-rt-b[title="Negrita"]').click();
  }, [desde, hasta]);
  const salir = async () => { await p.evaluate(() => document.querySelector('.dv-rt').blur()); await sleep(p, 800); };

  titulo('LA LISTA BLANCA');
  const limpio = await p.evaluate(() => ({
    script: notaSanear('<b>hola</b><scr' + 'ipt>alert(1)</scr' + 'ipt>'),
    img:    notaSanear('<img src=x onerror="alert(1)">texto'),
    js:     notaSanear('<a href="javascript:alert(1)">pulsa</a>'),
    data:   notaSanear('<a href="data:text/html,<b>x</b>">pulsa</a>'),
    bueno:  notaSanear('<a href="https://booking.com">reserva</a>'),
    word:   notaSanear('<span style="font-weight:700">gordo</span> y <span style="font-style:italic">torcido</span>'),
    tabla:  notaSanear('<table><tr><td>a</td><td>b</td></tr></table>'),
    clases: notaSanear('<b class="x" onclick="alert(1)" style="color:red">hola</b>'),
  }));
  ok(limpio.script === '<b>hola</b>', 'un <script> se va entero, no solo sus etiquetas', limpio.script);
  ok(limpio.img === 'texto', 'y una imagen con onerror, también', limpio.img);
  ok(limpio.js === 'pulsa' && limpio.data === 'pulsa',
    'un enlace javascript: o data: pierde el href y deja el texto', limpio);
  ok(/^<a href="https:\/\/booking\.com" target="_blank" rel="noopener noreferrer">reserva<\/a>$/.test(limpio.bueno),
    'uno de verdad se queda, con target y rel puestos', limpio.bueno);
  ok(limpio.word === '<b>gordo</b> y <i>torcido</i>',
    'lo pegado de un procesador de textos viene en <span style>: se traduce en vez de tirarlo', limpio.word);
  ok(limpio.tabla === 'ab', 'una tabla se aplana: aquí no hay tablas', limpio.tabla);
  ok(limpio.clases === '<b>hola</b>', 'y a lo permitido no le queda ni un atributo', limpio.clases);

  titulo('EL TEXTO PLANO QUE SE GUARDA EN notes');
  const plano = await p.evaluate(() => ({
    saltos: notaTexto('uno<br>dos<div>tres</div>'),
    bloques: notaTexto('<div>a</div><div>b</div>'),
    conFormato: notaTexto('Mostrador <b>14</b>, <a href="https://x.com">reserva</a>'),
    soloSalto: [notaTieneFormato('hola<br>adios'), notaTieneFormato('<b>hola</b>')],
  }));
  ok(plano.saltos === 'uno\ndos\ntres', 'cada bloque empieza línea nueva', JSON.stringify(plano.saltos));
  ok(plano.bloques === 'a\nb', 'sin líneas en blanco de propina', JSON.stringify(plano.bloques));
  ok(plano.conFormato === 'Mostrador 14, reserva', 'y del formato no queda rastro en el texto', plano.conFormato);
  ok(plano.soloSalto[0] === false && plano.soloSalto[1] === true,
    'un salto de línea NO es formato: el texto plano ya lo lleva y guardar dos copias solo sirve para que se separen',
    plano.soloSalto);

  titulo('ESCRIBIR CON NEGRITA');
  await abrirFicha();
  const caja = await p.evaluate(() => {
    const c = document.querySelector('.dv-rt');
    return { hay: !!c, editable: c.getAttribute('contenteditable'),
             barra: [...document.querySelectorAll('.dv-rt-b')].map((b) => b.title) };
  });
  ok(caja.hay && caja.editable === 'true', 'la nota se escribe en la ficha');
  ok(JSON.stringify(caja.barra) === '["Negrita","Cursiva","Subrayado","Enlace"]',
    'con negrita, cursiva, subrayado y enlaces', caja.barra);
  await escribir('Mostrador 14');
  await negrita(10, 12);
  await salir();
  let g = await guardado();
  ok(g.html === 'Mostrador <b>14</b>', 'el formato se guarda aparte', g.html);
  ok(g.notes === 'Mostrador 14', 'y `notes` se queda en plano, que es lo que lee el resto de la app', g.notes);

  titulo('UN ENLACE');
  await escribir('Reserva en Booking');
  await p.evaluate(() => {
    const c = document.querySelector('.dv-rt');
    const r = document.createRange(); r.setStart(c.firstChild, 11); r.setEnd(c.firstChild, 18);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.querySelector('.dv-rt-b[title="Enlace"]').click();
  });
  await sleep(p, 400);
  const fila = await p.evaluate(() => {
    const f = document.querySelector('.dv-rt-url');
    return { visible: f.style.display !== 'none', foco: document.activeElement === f.querySelector('input') };
  });
  ok(fila.visible && fila.foco, 'pide la dirección sin sacarte de la ficha', fila);
  await p.evaluate(() => {
    document.querySelector('.dv-rt-url input').value = 'booking.com/hotel';   // sin https:// a propósito
    document.querySelector('.dv-rt-url .btn-primary').click();
  });
  await sleep(p, 600);
  await salir();
  g = await guardado();
  ok(/href="https:\/\/booking\.com\/hotel"/.test(g.html || ''),
    'escribir "booking.com" basta: se le pone el https:// delante', g.html);
  ok(g.notes === 'Reserva en Booking', 'y el texto sigue siendo el texto', g.notes);
  await p.screenshot({ path: captura('nota-formato.png') });

  titulo('SIN SELECCIÓN NO HAY ENLACE QUE PONER');
  const avisos = [];
  await p.exposeFunction('__toastNota', (m) => avisos.push(m));
  await p.evaluate(() => { const o = UI.toast; UI.toast = (m) => { window.__toastNota(m); return o(m); }; });
  await p.evaluate(() => {
    const c = document.querySelector('.dv-rt');
    c.focus();
    const s = getSelection(); s.removeAllRanges();
    const r = document.createRange(); r.selectNodeContents(c); r.collapse(true); s.addRange(r);
    document.querySelector('.dv-rt-b[title="Enlace"]').click();
  });
  await sleep(p, 500);
  ok(avisos.some((m) => /Selecciona/.test(m)), 'se dice qué falta en vez de no hacer nada', avisos);

  titulo('LA CAJA CRECE CON EL TEXTO');
  // Era la pega del <textarea>: leer una nota larga por una ventanita de tres
  // líneas. Un contenteditable no tiene alto fijo.
  await escribir('Línea larguísima de prueba. '.repeat(30));
  await sleep(p, 400);
  const alto = await p.evaluate(() => {
    const c = document.querySelector('.dv-rt');
    return { alto: Math.round(c.clientHeight), contenido: Math.round(c.scrollHeight),
             overflow: getComputedStyle(c).overflowY };
  });
  ok(alto.contenido <= alto.alto + 1, 'se ve todo el texto, sin scroll dentro de la caja', alto);
  ok(alto.alto > 200, 'porque la caja ha crecido', `${alto.alto} px`);
  await salir();

  titulo('AL VOLVER, LA NOTA SIGUE CON SU FORMATO');
  await p.evaluate(async () => {
    const x = await DB.get('planning_items', 'vuelo-demo');
    x.notes = 'Mostrador 14'; x.metadata = Object.assign({}, x.metadata, { notes_html: 'Mostrador <b>14</b>' });
    await DB.put('planning_items', x);
  });
  await cerrarFicha();
  await abrirFicha();
  ok(await p.evaluate(() => document.querySelector('.dv-rt').innerHTML) === 'Mostrador <b>14</b>',
    'se repinta desde el HTML guardado, no desde el texto plano');

  titulo('EDITAR LA PARADA NO LA DEJA A MEDIAS');
  // El editor enseña la nota en un <textarea> plano. Si no se toca, el formato
  // se queda; si se reescribe el texto, manda lo escrito.
  await cerrarFicha();
  await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    await TripDetail.openPlanningEditor(t, await DB.get('planning_items', 'vuelo-demo'));
  });
  await sleep(p, 1400);
  ok(await p.evaluate(() => document.getElementById('f-notes').value) === 'Mostrador 14',
    'el editor la enseña en plano');
  await p.evaluate(() => [...document.querySelectorAll('#sheet-foot button')].find((b) => /Guardar/.test(b.textContent)).click());
  await sleep(p, 2200);
  g = await guardado();
  ok(g.html === 'Mostrador <b>14</b>', 'guardar sin tocarla conserva la negrita', g.html);

  await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    await TripDetail.openPlanningEditor(t, await DB.get('planning_items', 'vuelo-demo'));
  });
  await sleep(p, 1400);
  await p.evaluate(() => {
    const n = document.getElementById('f-notes');
    n.value = 'Mostrador 22'; n.dispatchEvent(new Event('change'));
  });
  await p.evaluate(() => [...document.querySelectorAll('#sheet-foot button')].find((b) => /Guardar/.test(b.textContent)).click());
  await sleep(p, 2200);
  g = await guardado();
  ok(g.notes === 'Mostrador 22' && !g.html,
    'reescribirla ahí tira el formato: quedarse con un HTML que ya no dice lo mismo es peor', g);

  terminar(errs);
  await cerrar();
})();
