/* Exportar el viaje al calendario (.ics).
 *
 * Sustituye a las notificaciones, que se programaban con setTimeout dentro de
 * la página y solo saltaban con la app delante. El calendario del móvil avisa
 * con la app cerrada, así que el trato es: la app escribe el archivo y que
 * avise quien sabe hacerlo. */
const fs = require('fs');
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

// Desdobla las líneas continuadas (CRLF + espacio) como haría un lector.
const desdoblar = (txt) => txt.replace(/\r\n /g, '');
// Ojo: el VALARM de dentro lleva su propia DESCRIPTION (el título del aviso).
// Sin cortar ahí, machacaría la descripción del evento.
const eventos = (txt) => desdoblar(txt).split('BEGIN:VEVENT').slice(1)
  .map((b) => b.split('BEGIN:VALARM')[0])
  .map((b) => Object.fromEntries(b.split('\r\n').filter((l) => l.includes(':'))
    .map((l) => [l.slice(0, l.indexOf(':')).split(';')[0], l.slice(l.indexOf(':') + 1)])));

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();

  const bajar = async (nombre) => {
    const d = p.waitForEvent('download', { timeout: 20000 });
    await p.evaluate(async () => { const t = await DB.get('trips', 'trip-demo-1'); await Exporter.ics(t); });
    const ruta = captura(nombre);
    await (await d).saveAs(ruta);
    return { ruta, bytes: fs.readFileSync(ruta), texto: fs.readFileSync(ruta, 'latin1') };
  };

  titulo('LAS NOTIFICACIONES YA NO ESTÁN');
  const resto = await p.evaluate(() => ({
    modulo: typeof window.Notifications,
    campanas: document.querySelectorAll('.ne-bell').length,
  }));
  ok(resto.modulo === 'undefined', 'el módulo Notifications ha desaparecido', resto.modulo);
  ok(resto.campanas === 0, 'y no queda ninguna campanita de "activar avisos"', String(resto.campanas));

  titulo('EL ARCHIVO ES UN .ICS VÁLIDO');
  const a = await bajar('viaje.ics');
  const t = a.texto;
  ok(/^BEGIN:VCALENDAR\r\n/.test(t) && /END:VCALENDAR\r\n$/.test(t), 'abre y cierra el calendario');
  ok(a.bytes.indexOf(Buffer.from('\n')) === a.bytes.indexOf(Buffer.from('\r\n')) + 1,
    'las líneas van con CRLF, como pide el formato');
  const lineas = a.bytes.toString('latin1').split('\r\n');
  ok(Math.max(...lineas.map((l) => Buffer.byteLength(l, 'latin1'))) <= 75,
    'ninguna línea pasa de 75 octetos', String(Math.max(...lineas.map((l) => Buffer.byteLength(l, 'latin1')))));
  const evs = eventos(t);
  ok(evs.length >= 10, 'lleva los eventos del viaje', `${evs.length} eventos`);
  ok(new Set(evs.map((e) => e.UID)).size === evs.length, 'con un UID distinto cada uno');
  ok(evs.every((e) => /@viajes$/.test(e.UID)), 'y el UID sale del id de la parada: reimportar actualiza, no duplica');

  titulo('UN VUELO LLEVA LO QUE SE BUSCA A LAS SEIS DE LA MAÑANA');
  const vuelo = evs.find((e) => e.UID.startsWith('vuelo-demo'));
  ok(vuelo && /T063000$/.test(vuelo.DTSTART), 'sale a su hora, en hora local sin zona', vuelo && vuelo.DTSTART);
  ok(vuelo && /T145000$/.test(vuelo.DTEND), 'y llega a la suya', vuelo && vuelo.DTEND);
  ok(vuelo && /BOG/.test(vuelo.DESCRIPTION) && /Avianca AV018/.test(vuelo.DESCRIPTION),
    'con la ruta y el número de vuelo en la descripción', vuelo && vuelo.DESCRIPTION);
  ok(/TRIGGER:-PT120M/.test(desdoblar(t)), 'y un aviso dos horas antes');

  titulo('EL HOTEL OCUPA DE LA ENTRADA A LA SALIDA');
  const hotel = evs.find((e) => e.UID.startsWith('hotel-demo'));
  ok(hotel && hotel.DTSTART < hotel.DTEND && hotel.DTSTART !== hotel.DTEND,
    'el check-in y el check-out son días distintos', hotel && `${hotel.DTSTART} → ${hotel.DTEND}`);

  titulo('UNA PARADA SIN HORA ES UN DÍA COMPLETO');
  const sinHora = await p.evaluate(async () => {
    const x = await DB.get('planning_items', 'i8');   // "Plazuela… (sin hora)"
    return { id: x.id, hora: x.time || null, dia: x.day_date };
  });
  const dc = evs.find((e) => e.UID.startsWith(sinHora.id));
  ok(dc && /^\d{8}$/.test(dc.DTSTART), 'se escribe como fecha, sin hora', dc && dc.DTSTART);
  ok(dc && Number(dc.DTEND) === Number(dc.DTSTART) + 1,
    'y el fin va al día siguiente, porque en el formato es exclusivo', dc && `${dc.DTSTART} → ${dc.DTEND}`);

  titulo('EL ESTADO DE LA RESERVA VIAJA CON EL EVENTO');
  ok(vuelo && vuelo.STATUS === 'CONFIRMED', 'un vuelo confirmado va como CONFIRMED', vuelo && vuelo.STATUS);
  await p.evaluate(async () => {
    const x = await DB.get('planning_items', 'tren-demo'); x.status = 'en_consulta'; await DB.put('planning_items', x);
  });
  const b = await bajar('viaje2.ics');
  const tren = eventos(b.texto).find((e) => e.UID.startsWith('tren-demo'));
  ok(tren && tren.STATUS === 'TENTATIVE', 'y uno en consulta, como TENTATIVE', tren && tren.STATUS);

  titulo('TEXTO LARGO CON EMOJIS: NI SE ROMPE NI SE PASA');
  await p.evaluate(async () => {
    const x = await DB.get('planning_items', 'vuelo-demo');
    x.notes = '🎫🏨✈️🚆 ' + 'Ñandú con acentos, comas, y; puntos y coma — '.repeat(6) + '🌴🌴🌴';
    await DB.put('planning_items', x);
  });
  const c = await bajar('largo.ics');
  let utf8 = true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(c.bytes); } catch (_) { utf8 = false; }
  const maxOct = Math.max(...c.bytes.toString('latin1').split('\r\n').map((l) => Buffer.byteLength(l, 'latin1')));
  ok(utf8, 'el archivo sigue siendo UTF-8 íntegro (doblar por caracteres lo habría partido)');
  ok(maxOct <= 75, 'y ninguna línea se pasa de 75 octetos', `${maxOct} octetos`);
  const vLargo = eventos(c.bytes.toString('utf8')).find((e) => e.UID.startsWith('vuelo-demo'));
  ok(vLargo && vLargo.DESCRIPTION.includes('🌴🌴🌴') && (vLargo.DESCRIPTION.match(/Ñandú/g) || []).length === 6,
    'y la nota se recompone entera al desdoblarla');

  titulo('LOS CARACTERES QUE EL FORMATO RESERVA VAN ESCAPADOS');
  ok(/\\;/.test(desdoblar(c.bytes.toString('utf8'))) && /\\,/.test(desdoblar(c.bytes.toString('utf8'))),
    'el punto y coma y la coma llevan su barra', 'presentes');

  titulo('UN VIAJE SIN FECHAS NO DESCARGA NADA');
  const avisos = [];
  await p.exposeFunction('__toast', (m) => avisos.push(m));
  await p.evaluate(() => { const o = UI.toast; UI.toast = (m) => { window.__toast(m); return o(m); }; });
  await p.evaluate(async () => {
    await DB.put('trips', { id: 'vacio-1', profile: dataProfile(), name: 'Sin nada', settings: {} });
    const t = await DB.get('trips', 'vacio-1'); await Exporter.ics(t);
  });
  await sleep(p, 600);
  ok(avisos.some((m) => /no tiene nada con fecha/i.test(m)), 'lo dice en vez de bajar un archivo vacío', avisos);

  terminar(errs);
  await cerrar();
})();
