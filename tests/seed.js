/* Semilla del viaje de pruebas. Se inyecta en la página, así que se ejecuta
 * dentro de la app y puede usar DB, todayIso, dataProfile…
 *
 * Las fechas son SIEMPRE relativas a hoy. Con fechas fijas la suite se habría
 * podrido sola en cuanto pasara el día escrito: un viaje "en curso" habría
 * pasado a "terminado" y la mitad de las comprobaciones (días apagados, próximo
 * evento, el planning abriendo en hoy) habrían empezado a fallar sin que nadie
 * hubiera tocado nada.
 *
 * Reparto:
 *   D-3 … D-1  días ya pasados (el viaje está EN CURSO)
 *   D-1        4 paradas: comida, lugar, billete de coche, cena
 *   D0  (hoy)  vuelo + hotel (check-in) + actividad + comidas + lugares
 *   D+1        2ª noche de hotel y un par de paradas
 *   D+2        check-out del hotel y un tren
 *   D+5        fin del viaje
 */
window.__seed = async () => {
  const T = 'trip-demo-1';

  // Fecha local a n días de hoy, en 'YYYY-MM-DD'. Sin pasar por UTC, como en la app.
  const D = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  // Las pruebas piden los días por nombre, no por fecha.
  const dias = window.__dias = {
    inicio: D(-3), antesDeAyer: D(-2), ayer: D(-1), hoy: D(0),
    manana: D(1), pasado: D(2), fin: D(5),
  };

  await DB.put('trips', {
    id: T, profile: dataProfile(), name: 'Colombia', city: 'Barichara', country: 'Colombia',
    start_date: dias.inicio, end_date: dias.fin, default_currency: 'EUR',
    in_preparation: false, settings: {},
  });

  const base = (o) => Object.assign({ trip_id: T, profile: dataProfile(), metadata: {}, order_index: 0 }, o);
  const items = [
    // --- Ayer: un día ya pasado, con contenido ---
    base({ id:'i1', type:'comida', day_date:dias.ayer, time:'12:00', end_time:'13:30',
      title:'Comida en Mesa de los Santos', place_name:'Restaurante Aborígenes' }),
    base({ id:'i2', type:'lugar', day_date:dias.ayer, time:'13:30', end_time:'14:00',
      title:'Teleférico de vuelta a Pescadero' }),
    base({ id:'i3', type:'transporte', day_date:dias.ayer, time:'14:00', title:'Pescadero - Barichara',
      status:'confirmado', consultation_planned_d1:dias.ayer, consultation_planned_t1:'14:00',
      consultation_planned_d2:dias.ayer, consultation_planned_t2:'15:45',
      metadata:{ modo:'coche', origen:'Pescadero', destino:'Barichara' } }),
    base({ id:'i4', type:'comida', day_date:dias.ayer, time:'19:00', title:'Restaurante Terra' }),

    // --- Mañana: transporte SIN hora de llegada → debe salir "viajando", no "libre" ---
    base({ id:'i5', type:'transporte', day_date:dias.manana, time:'08:00', title:'Villa de Leyva - Barichara',
      status:'confirmado', consultation_planned_d1:dias.manana, consultation_planned_t1:'08:00',
      metadata:{ modo:'coche', origen:'Villa de Leyva', destino:'Barichara' } }),
    base({ id:'i6', type:'lugar', day_date:dias.manana, time:'15:00', title:'Parque Principal',
      place_name:'Parque Principal, Barichara' }),
    base({ id:'i7', type:'lugar', day_date:dias.manana, time:'15:30', title:'Capilla de San Antonio',
      place_name:'Capilla de San Antonio' }),
    base({ id:'i8', type:'lugar', day_date:dias.manana, title:'Plazuela de Santa Bárbara (sin hora)' }),
    base({ id:'i9', type:'comida', day_date:dias.manana, time:'19:30', end_time:'21:00', title:'Elvia Cocina Local',
      place_name:'Cocina santandereana', people:['Rubén','Noelia'] }),
    base({ id:'i10', type:'comida', day_date:dias.manana, time:'13:00', title:'Mercado Campesino' }),
    base({ id:'act-demo', type:'actividad', day_date:dias.manana, time:'11:30', end_time:'13:00',
      title:'Teleférico del Chicamocha', place_name:'Panachi', status:'confirmado',
      metadata:{ organizador:'Panachi', duracion:'90 min' } }),

    // --- Hoy: el vuelo, que es el próximo evento del viaje ---
    base({ id:'vuelo-demo', type:'vuelo', day_date:dias.hoy, time:'06:30', title:'Vuelo BOG - MAD',
      status:'confirmado', expense_reminder:true,
      consultation_planned_d1:dias.hoy, consultation_planned_t1:'06:30',
      consultation_planned_d2:dias.hoy, consultation_planned_t2:'14:50',
      metadata:{ aerolinea:'Avianca', numero:'AV018', origen:'BOG', destino:'MAD',
        asientos:[{nombre:'Rubén',asiento:'12A'},{nombre:'Noelia',asiento:'12B'}] } }),

    // --- Pasado mañana: un tren por iniciar ---
    base({ id:'tren-demo', type:'transporte', day_date:dias.pasado, time:'16:00', title:'Tren',
      status:'por_iniciar', consultation_planned_d1:dias.pasado, consultation_planned_t1:'16:00',
      consultation_planned_d2:dias.pasado, consultation_planned_t2:'18:35',
      metadata:{ modo:'tren', compania:'Renfe', numero:'AVE 02701', origen:'Madrid Atocha', destino:'Sevilla' } }),

    // --- Hotel: entra hoy y sale pasado mañana (genera noches y check-out virtuales) ---
    base({ id:'hotel-demo', type:'hotel', day_date:dias.hoy, title:'Hotel Buenos Aires Barichara',
      place_name:'Hotel Buenos Aires Barichara', status:'confirmado',
      consultation_planned_d1:dias.hoy, consultation_planned_t1:'15:00',
      consultation_planned_d2:dias.pasado, consultation_planned_t2:'11:00',
      metadata:{ nombre:'Hotel Buenos Aires Barichara' } }),
  ];
  for (const i of items) await DB.put('planning_items', i);

  // Importes vinculados: así el talón del billete enseña precio.
  const bud = (id, pid, amount, currency) => DB.put('budget_items', {
    id, trip_id: T, profile: dataProfile(), planning_item_id: pid,
    concept: 'Billete', amount, currency: currency || 'EUR', paid: false,
  });
  await bud('b1', 'vuelo-demo', 0, 'EUR');
  await bud('b2', 'i3', 1234.56, 'EUR');
  await bud('b3', 'i5', 45, 'EUR');

  // Etiqueta larga del día: sirve para ver si se solapa con la fecha.
  await DB.put('day_notes', { id:'dn1', trip_id:T, profile: dataProfile(), date: dias.manana,
    title:'Barichara a fondo - Villa de Leyva', color:null, text:'' });

  return T;
};
