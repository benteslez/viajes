/* Notas y contacto escritos en la propia ficha.
 *
 * La ficha deja de ser solo de lectura: la nota se escribe cuando estás delante
 * de la parada, y el teléfono del hotel se llama, no se rellena en un formulario.
 * Lo que más importa aquí son dos cosas que se rompen sin avisar: que guardar
 * desde el editor NO borre lo que se escribió en la ficha (el editor reconstruye
 * `metadata` desde los campos del tipo) y que escribir varios campos seguidos no
 * haga que el último pise a los anteriores. */
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
  const guardado = (id = 'vuelo-demo') => p.evaluate(async (id) => {
    const x = await DB.get('planning_items', id);
    return { notes: x.notes || null, address: x.address || null,
             tel: (x.metadata || {}).telefono || null, wa: (x.metadata || {}).whatsapp || null };
  }, id);
  // Escribir en un campo de la ficha como lo haría un dedo: teclear y salir.
  const escribir = async (etiqueta, valor) => {
    await p.evaluate(([lbl, v]) => {
      const f = [...document.querySelectorAll('.dv-row')].find((r) => r.querySelector('.dv-l')?.textContent === lbl);
      const n = f.querySelector('input');
      n.value = v; n.dispatchEvent(new Event('input')); n.dispatchEvent(new Event('change'));
    }, [etiqueta, valor]);
    await sleep(p, 300);
  };

  titulo('LA FICHA TIENE DÓNDE APUNTAR');
  await abrirFicha();
  const bloques = await p.evaluate(() => [...document.querySelectorAll('.dv-h')].map((x) => x.textContent));
  ok(bloques.includes('Contacto'), 'hay un bloque de contacto', bloques);
  ok(bloques.includes('Notas'), 'y uno de notas');
  const campos = await p.evaluate(() => {
    const f = (lbl) => [...document.querySelectorAll('.dv-row')].find((r) => r.querySelector('.dv-l')?.textContent === lbl);
    return { tel: !!f('Teléfono')?.querySelector('input'), wa: !!f('WhatsApp')?.querySelector('input'),
             dir: !!f('Dirección')?.querySelector('input'), notas: !!document.querySelector('.dv-rt') };
  });
  ok(campos.tel && campos.wa && campos.dir && campos.notas,
    'los cuatro se escriben aquí mismo, sin abrir el editor', campos);

  titulo('SE GUARDA AL SALIR DEL CAMPO, SIN BOTÓN');
  await escribir('Teléfono', '+34 600 11 22 33');
  await escribir('WhatsApp', '+57 300 111 2233');
  await escribir('Dirección', 'Calle Mayor 1, Madrid');
  await p.evaluate(() => {
    const c = document.querySelector('.dv-rt');
    c.focus(); document.execCommand('insertText', false, 'Mostrador 14, llevar impreso'); c.blur();
  });
  await sleep(p, 900);
  let g = await guardado();
  // Cada guardado relee el registro entero: sin ponerlos en fila, los cuatro
  // leían la versión de antes y solo sobrevivía el último.
  ok(g.tel === '+34 600 11 22 33' && g.wa === '+57 300 111 2233',
    'cuatro campos seguidos se guardan los cuatro, no solo el último', g);
  ok(g.address === 'Calle Mayor 1, Madrid', 'la dirección, también', g.address);
  ok(/Mostrador 14/.test(g.notes || ''), 'y la nota', g.notes);
  await p.screenshot({ path: captura('ficha-contacto.png') });

  titulo('LOS BOTONES ABREN LA APP QUE TOCA');
  const botones = await p.evaluate(() => {
    const f = (lbl) => [...document.querySelectorAll('.dv-row')].find((r) => r.querySelector('.dv-l')?.textContent === lbl);
    const a = (lbl) => { const n = f(lbl).querySelector('a.dv-ir');
      return { href: n?.getAttribute('href') || null, oculto: n?.style.display === 'none' }; };
    return { tel: a('Teléfono'), wa: a('WhatsApp') };
  });
  ok(botones.tel.href === 'tel:+34600112233',
    'el teléfono marca sin espacios y conservando el + del prefijo', botones.tel.href);
  ok(botones.wa.href === 'https://wa.me/573001112233',
    'y WhatsApp abre el chat con el número en dígitos, sin el +', botones.wa.href);

  titulo('SIN NÚMERO NO SE OFRECE EL BOTÓN');
  await escribir('Teléfono', '');
  const sinTel = await p.evaluate(() => {
    const f = [...document.querySelectorAll('.dv-row')].find((r) => r.querySelector('.dv-l')?.textContent === 'Teléfono');
    return f.querySelector('a.dv-ir').style.display;
  });
  ok(sinTel === 'none', 'un "tel:" vacío no lleva a ninguna parte, así que el botón se esconde', sinTel);
  await escribir('Teléfono', '+34 600 11 22 33');

  titulo('UN MÓVIL SIN PREFIJO NO VALE PARA WHATSAPP');
  await escribir('WhatsApp', '600112233');
  const corto = await p.evaluate(() => {
    const f = [...document.querySelectorAll('.dv-row')].find((r) => r.querySelector('.dv-l')?.textContent === 'WhatsApp');
    return { display: f.querySelector('a.dv-ir').style.display,
             hint: [...document.querySelectorAll('.dv-block .field-hint')].map((x) => x.textContent).join(' ') };
  });
  ok(corto.display === 'none', 'sin prefijo de país abriría el chat de otra persona: no se ofrece', corto.display);
  ok(/prefijo del país/.test(corto.hint), 'y se dice por qué', corto.hint);
  await escribir('WhatsApp', '+57 300 111 2233');

  titulo('EDITAR LA PARADA NO BORRA NADA DE ESTO');
  await cerrarFicha();
  await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    await TripDetail.openPlanningEditor(t, await DB.get('planning_items', 'vuelo-demo'));
  });
  await sleep(p, 1400);
  await p.evaluate(() => [...document.querySelectorAll('#sheet-foot button')].find((b) => /Guardar/.test(b.textContent)).click());
  await sleep(p, 2200);
  g = await guardado();
  // El editor reconstruye `metadata` a partir de los campos del tipo, y ni el
  // teléfono ni el WhatsApp están declarados ahí: sin conservarlos a mano, este
  // guardado los borraba.
  ok(g.tel === '+34 600 11 22 33' && g.wa === '+57 300 111 2233',
    'el teléfono y el WhatsApp sobreviven a guardar desde el editor', g);
  ok(g.address === 'Calle Mayor 1, Madrid' && /Mostrador 14/.test(g.notes || ''),
    'y la dirección y la nota, también', g);

  titulo('UNA PARADA VIRTUAL ESCRIBE SOBRE LA DE VERDAD');
  // La noche de un hotel es una COPIA del registro con su mismo id: escribir
  // sobre la copia perdería todo lo que la copia no traía.
  const virtual = await p.evaluate(async () => {
    const real = await DB.get('planning_items', 'hotel-demo');
    if (!real) return null;
    // Un dato que la copia NO llevará: es lo que se perdería al escribir sobre ella.
    real.metadata = Object.assign({}, real.metadata, { localizador:'ABC123' });
    await DB.put('planning_items', real);
    const t = await DB.get('trips', 'trip-demo-1');
    const copia = Object.assign({}, real, { _virtual:'night', _nightN:1, metadata:{} });
    TripDetail.openPlanningDetail(t, copia);
    return { localizador: 'ABC123' };
  });
  if (virtual) {
    await sleep(p, 1400);
    await escribir('Teléfono', '+34 900 00 00 00');
    await sleep(p, 700);
    const tras = await p.evaluate(async () => {
      const x = await DB.get('planning_items', 'hotel-demo');
      return { tel: (x.metadata || {}).telefono || null, localizador: (x.metadata || {}).localizador || null };
    });
    ok(tras.tel === '+34 900 00 00 00', 'el teléfono se guarda desde la noche del hotel', tras.tel);
    ok(tras.localizador === virtual.localizador,
      'y no se lleva por delante lo que la copia no traía', `${virtual.localizador} → ${tras.localizador}`);
    await cerrarFicha();
  } else {
    ok(true, 'no hay alojamiento en la semilla para probarlo', '(no aplica)');
  }

  titulo('EN MODO LECTOR SE LEE, NO SE ESCRIBE');
  // Sin esto el campo dejaba teclear, encolaba la fila y Supabase la rechazaba
  // por RLS: el cambio no llegaba a ninguna parte y el indicador se quedaba en
  // rojo sin que el lector pudiera hacer nada.
  // Se cambia el PERFIL, no se parchea `canEdit`: es un `const` del ámbito del
  // <script> y asignarle algo a `window` no lo sustituye. 'sergio' es lector y
  // sin concesión de edición sobre este viaje.
  await p.evaluate(() => { window.__perfil = STATE.profile; STATE.profile = 'sergio'; GRANTS.mapa = {}; GRANTS.cargado = true; });
  ok(await p.evaluate(() => canEdit() === false), 'con un perfil lector, canEdit() dice que no');
  await abrirFicha();
  const lector = await p.evaluate(() => {
    const f = (lbl) => [...document.querySelectorAll('.dv-row')].find((r) => r.querySelector('.dv-l')?.textContent === lbl);
    return {
      tel: f('Teléfono').querySelector('input').readOnly,
      dir: f('Dirección').querySelector('input').readOnly,
      nota: document.querySelector('.dv-rt').getAttribute('contenteditable'),
      barra: !!document.querySelector('.dv-rt-bar'),
    };
  });
  ok(lector.tel && lector.dir, 'los campos salen de solo lectura', lector);
  ok(lector.nota === 'false', 'la nota no se escribe', lector.nota);
  ok(!lector.barra, 'y no hay barra de formato: un botón que no hace nada es peor que no tenerlo');
  const antesLector = await guardado();
  await p.evaluate(() => {
    const f = [...document.querySelectorAll('.dv-row')].find((r) => r.querySelector('.dv-l')?.textContent === 'Teléfono');
    const n = f.querySelector('input');
    n.value = '+34 000 00 00 00'; n.dispatchEvent(new Event('change'));
  });
  await sleep(p, 900);
  ok(JSON.stringify(await guardado()) === JSON.stringify(antesLector),
    'y aunque se fuerce el cambio, no se guarda nada', await guardado());
  await cerrarFicha();
  await p.evaluate(() => { STATE.profile = window.__perfil; });

  terminar(errs);
  await cerrar();
})();
