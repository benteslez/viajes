const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();

  titulo('TIRA DE DÍAS Y CARRUSEL');
  ok(await p.evaluate(()=>!!document.querySelector('.plan-pager')), '19a) el planning es un carrusel de días');
  ok(await p.evaluate(()=>!document.querySelector('.day-full-btn') &&
      ![...document.querySelectorAll('.plan-collapse-bar .btn')].some(b=>/Tarjetas/.test(b.textContent))),
     '19b) ya no hay modo pantalla completa');
  // pulsar una pastilla lejana → se ilumina esa
  const pil = await p.evaluate(async()=>{
    const ps=[...document.querySelectorAll('.day-pill')];
    ps[ps.length-1].click(); await new Promise(r=>setTimeout(r,1400));
    const act=document.querySelector('.day-pill.active');
    return { pedido:ps[ps.length-1].dataset.day, activa:act&&act.dataset.day, dia:TripDetail._diaVisible };
  });
  ok(pil.pedido===pil.activa && pil.pedido===pil.dia, '16a) la pastilla pulsada es la que queda marcada', JSON.stringify(pil));
  // último día: sube arriba del todo
  const ult = await p.evaluate(async()=>{
    const ps=[...document.querySelectorAll('.plan-page')].filter(x=>x.offsetParent);
    TripDetail._irADia(ps[ps.length-1].dataset.day,{animar:false});
    await new Promise(r=>setTimeout(r,1400));
    const tira=document.querySelector('.day-strip'), tb=document.querySelector('header.topbar');
    return { dia:TripDetail._diaVisible, tiraTop:Math.round(tira.getBoundingClientRect().top),
             barra:Math.round(tb.getBoundingClientRect().height),
             pagerTop:Math.round(document.querySelector('.plan-pager').getBoundingClientRect().top),
             tope:Math.round(TripDetail._topeSuperior()) };
  });
  ok(Math.abs(ult.tiraTop-ult.barra)<=2 && Math.abs(ult.pagerTop-ult.tope)<=2,
     '16b) el último día sube del todo y la tira queda pegada arriba', JSON.stringify(ult));
  // pastillas centradas con pocos días
  const cen = await p.evaluate(async()=>{
    const t=await DB.get('trips','trip-demo-1');
    t.start_date=window.__dias.hoy; t.end_date=window.__dias.pasado; await DB.put('trips',t);
    TripDetail._diaVisible=null; await Router.render(); await new Promise(r=>setTimeout(r,1500));
    const inner=document.querySelector('.day-strip-inner'); const ps=[...inner.querySelectorAll('.day-pill')];
    const r=inner.getBoundingClientRect(), a=ps[0].getBoundingClientRect(), z=ps[ps.length-1].getBoundingClientRect();
    return { n:ps.length, izq:Math.round(a.left-r.left), der:Math.round(r.right-z.right), desborda:inner.scrollWidth>inner.clientWidth+1 };
  });
  ok(!cen.desborda && Math.abs(cen.izq-cen.der)<=2, '16c) con pocos días las pastillas quedan centradas', JSON.stringify(cen));

  titulo('EDITOR DE FECHAS');
  const est=()=>p.evaluate(()=>({grid:(document.getElementById('f-dates-grid')||{}).style?.display,
    ini:(document.getElementById('f-start')||{}).value, fin:(document.getElementById('f-end')||{}).value,
    lbl:(document.getElementById('f-start-label')||{}).textContent}));
  await p.evaluate(async()=>{ const t=await DB.get('trips','trip-demo-1'); t.confirmation=null; await DB.put('trips',t); Trips.openTripEditor(t); });
  await sleep(p,800);
  const e1 = await est();
  ok(e1.grid!=='none' && e1.lbl==='Inicio probable', '18a) "Sin definir": fechas visibles y probables', JSON.stringify(e1));
  await p.evaluate(()=>document.querySelector('.status-picker .opt[data-conf="sin_fecha"]').click()); await sleep(p,400);
  const e2 = await est();
  ok(e2.grid==='none' && !e2.ini && !e2.fin, '18b) "Sin fecha" quita los campos y los vacía', JSON.stringify(e2));
  await p.evaluate(()=>document.querySelector('.status-picker .opt[data-conf="confirmado"]').click()); await sleep(p,400);
  const e3 = await est();
  const iniEsperado = await p.evaluate(()=>window.__dias.hoy);
  ok(e3.grid!=='none' && e3.ini===iniEsperado, '18c) al volver recuerda las fechas', JSON.stringify(e3));
  await p.evaluate(()=>document.querySelector('.status-picker .opt[data-conf="sin_fecha"]').click()); await sleep(p,300);
  await p.evaluate(()=>[...document.querySelectorAll('#sheet-foot .btn')].find(b=>b.textContent.trim()==='Guardar').click());
  await sleep(p,1400);
  const db = await p.evaluate(async()=>{ const t=await DB.get('trips','trip-demo-1'); return {c:t.confirmation,i:t.start_date,f:t.end_date}; });
  ok(db.c==='sin_fecha' && !db.i && !db.f, '18d) guardado sin fechas', JSON.stringify(db));
  // tarjeta del viaje
  await p.evaluate(()=>{ STATE.filter=null; Router.go('trips'); }); await sleep(p,1200);
  const tar1 = await p.evaluate(()=>{ const c=document.querySelector('.trip-card');
    return c?{meta:c.querySelector('.trip-card-meta').textContent, franja:(c.querySelector('.trip-card-reason')||{textContent:null}).textContent}:null; });
  ok(tar1 && /Plan sin fecha/.test(tar1.meta) && !tar1.franja, '18e) tarjeta "Sin fecha" no promete fechas probables', JSON.stringify(tar1));
  await p.evaluate(async()=>{ const t=await DB.get('trips','trip-demo-1'); t.confirmation=null;
    const d=(n)=>{const x=new Date(); x.setDate(x.getDate()+n);
      return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;};
    t.start_date=d(40); t.end_date=d(47);
    await DB.put('trips',t); STATE.filter=null; await Router.render(); }); await sleep(p,1200);
  const tar2 = await p.evaluate(()=>{ const c=document.querySelector('.trip-card');
    return c?{meta:c.querySelector('.trip-card-meta').textContent, franja:(c.querySelector('.trip-card-reason')||{textContent:null}).textContent}:null; });
  ok(tar2 && /Fechas probables/.test(tar2.franja||''), '18f) "Sin definir" lleva la franja de fechas probables', JSON.stringify(tar2));
  terminar(errs);
  await cerrar();
})();
