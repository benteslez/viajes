const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();

  // ir al día con billete de transporte y alojamiento
  const dia = await p.evaluate(()=>{
    const pg=document.querySelector('.plan-pager');
    const pag=[...pg.querySelectorAll('.plan-page')].find(x=>x.querySelector('.li-ticket'));
    return pag && pag.dataset.day;
  });
  await p.evaluate((d)=>TripDetail._irADia(d,{animar:false}), dia);
  await sleep(p,1200);
  console.log('— BILLETE (día '+dia+') —');
  const tk = await p.evaluate(()=>{
    const t=document.querySelector('.plan-page .li-ticket'); if(!t) return null;
    const main=t.querySelector('.tk-main'), seg=t.querySelector('.tk-seg');
    const ic=t.querySelector('.tk-ic'), a=t.querySelector('.tk-side-a'), c=t.querySelector('.tk-side-b');
    const R=(e)=>e?e.getBoundingClientRect():null;
    const cs=getComputedStyle(ic);
    const ciudadA=a.querySelector('.tk-city')||a.firstElementChild, horaA=a.querySelector('.tk-f-v')||a.lastElementChild;
    const ciudadB=c.querySelector('.tk-city')||c.firstElementChild, horaB=c.querySelector('.tk-f-v')||c.lastElementChild;
    const stub=t.querySelector('.tk-stub');
    const etiquetas=[...stub.querySelectorAll('.tk-f-l')].map(e=>({txt:e.textContent, y:Math.round(e.getBoundingClientRect().top)}));
    return {
      centroIcono:Math.round(R(ic).left+R(ic).width/2), centroMain:Math.round(R(main).left+R(main).width/2),
      aRight:Math.round(R(ciudadA).right), horaARight:Math.round(R(horaA).right),
      bLeft:Math.round(R(ciudadB).left), horaBLeft:Math.round(R(horaB).left),
      borde:cs.borderTopWidth, fondo:cs.backgroundColor, radio:cs.borderRadius,
      etiquetas, anchoTicket:Math.round(R(t).width),
      textoA:ciudadA.textContent, textoB:ciudadB.textContent };
  });
  if (!tk) { ok(false,'hay billete'); }
  else {
    ok(Math.abs(tk.centroIcono-tk.centroMain)<=2, '1) icono centrado en el billete', `icono ${tk.centroIcono} vs centro ${tk.centroMain}`);
    ok(Math.abs(tk.aRight-tk.horaARight)<=1, '2a) salida alineada a la derecha con el origen', `${tk.textoA.trim()} ${tk.aRight} / hora ${tk.horaARight}`);
    ok(Math.abs(tk.bLeft-tk.horaBLeft)<=1, '2b) llegada alineada a la izquierda con el destino', `${tk.textoB.trim()} ${tk.bLeft} / hora ${tk.horaBLeft}`);
    ok(parseFloat(tk.borde)>=1 && /rgba\(0, 0, 0, 0\)|transparent/.test(tk.fondo) && tk.radio.startsWith('50'), '3) vehículo dentro de un aro sin relleno', `borde ${tk.borde}, fondo ${tk.fondo}`);
    const iDur=tk.etiquetas.findIndex(e=>/DURACI/i.test(e.txt)), iPre=tk.etiquetas.findIndex(e=>/PRECIO/i.test(e.txt));
    ok(iDur>=0 && iPre>=0 && tk.etiquetas[iPre].y>tk.etiquetas[iDur].y, '4) precio debajo de la duración en el talón', JSON.stringify(tk.etiquetas));
  }
  // tamaño unificado billete / llave
  const tam = await p.evaluate(()=>{
    const pg=document.querySelector('.plan-pager');
    const t=[...pg.querySelectorAll('.li-ticket')][0], k=[...pg.querySelectorAll('.li-keycard')][0];
    return { tk:t?Math.round(t.getBoundingClientRect().width):null, kc:k?Math.round(k.getBoundingClientRect().width):null };
  });
  ok(tam.tk && tam.kc && Math.abs(tam.tk-tam.kc)<=1, '7) billete y llave miden lo mismo', JSON.stringify(tam));

  // llave: esquina inferior izquierda + cuerpo de letra
  const llave = await p.evaluate(()=>{
    const k=document.querySelector('.plan-page .kc-ic'); if(!k) return null;
    const c=k.closest('.li-keycard').getBoundingClientRect(), r=k.getBoundingClientRect();
    const n=document.querySelector('.plan-page .kc-n');
    return {izq:Math.round(r.left-c.left), abajo:Math.round(c.bottom-r.bottom), fs:n?getComputedStyle(n).fontSize:null,
            // el primer CAMPO (no el contenedor, que ocupa todo el ancho)
            solapa: (()=>{ const f=document.querySelector('.plan-page .kc-f'); if(!f) return null;
              const C=f.getBoundingClientRect();
              const x=Math.min(r.right,C.right)-Math.max(r.left,C.left), y=Math.min(r.bottom,C.bottom)-Math.max(r.top,C.top);
              return (x>0&&y>0) ? -Math.round(x) : Math.round(C.left-r.right); })()};
  });
  ok(llave && llave.izq<=12 && llave.abajo<=12, '17a) llave en la esquina inferior izquierda', JSON.stringify(llave));
  ok(llave && parseFloat(llave.fs)>=14, '17b) nombre del alojamiento con su cuerpo de letra', llave&&llave.fs);
  ok(llave && (llave.solapa===null || llave.solapa>0), '17c) la llave no se solapa con los campos', llave&&String(llave.solapa));

  // marcar como visto: número del día → tic verde
  console.log('— MARCAR COMO VISTO —');
  const visto = await p.evaluate(async()=>{
    const num=document.querySelector('.plan-page .li-num.li-mark'); if(!num) return {sin:true};
    const fila=num.closest('.timeline-item');
    num.click(); await new Promise(r=>setTimeout(r,500));
    const cs=getComputedStyle(num, '::after');
    return { clase:fila.className, marcada:fila.classList.contains('visited'),
             pseudo:cs.content, aria:num.getAttribute('aria-pressed'),
             opacidad:getComputedStyle(fila.querySelector('.li-title')).opacity };
  });
  ok(visto && visto.marcada, '11a) pulsar el número marca la parada como vista', JSON.stringify(visto));
  const tkVisto = await p.evaluate(async()=>{
    const ic=document.querySelector('.plan-page .tk-ic.li-mark'); if(!ic) return {sin:true};
    ic.click(); await new Promise(r=>setTimeout(r,500));
    const card=ic.closest('.timeline-item');
    const tk=card.querySelector('.li-ticket'), stub=card.querySelector('.tk-stub');
    return { visto:card.classList.contains('visited'), fondo:getComputedStyle(tk).backgroundImage.slice(0,40),
             filtro:getComputedStyle(tk).filter, talon:getComputedStyle(stub).backgroundColor };
  });
  ok(tkVisto.visto && tkVisto.filtro==='none', '14) billete visto: conserva color (sin filtro gris)', JSON.stringify(tkVisto));
  const kcVisto = await p.evaluate(async()=>{
    const ic=document.querySelector('.plan-page .kc-ic.li-mark'); if(!ic) return {sin:true};
    ic.click(); await new Promise(r=>setTimeout(r,600));
    const card=ic.closest('.timeline-item');
    return { visto:card.classList.contains('visited') };
  });
  ok(kcVisto.visto, '15) el alojamiento también se marca desde su llave', JSON.stringify(kcVisto));
  terminar(errs);
  await cerrar();
})();
