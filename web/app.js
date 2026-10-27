// laboratorio.ia — cliente web (sin frameworks).
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const esc = window.escaparHtml;
  const app = window.CardonApp; // puente nativo cuando corre dentro del APK

  // ── Preferencias del dispositivo ─────────────────────────────────────────
  const PREF = 'cardon-lab:prefs';
  const prefs = Object.assign(
    { tema: 'oscuro', modo: 'chat', skill: 'asistente-general', modeloTexto: 'auto', modeloImagen: 'auto', tamano: 'cuadrado', fuentes: null, razonamiento: true,
      combinar: { activa: false, modelos: [], integrador: 'auto', mostrar: true } },
    leerPrefs(),
  );
  function leerPrefs() { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch { return {}; } }
  function guardarPrefs() { try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch { /* sin almacenamiento */ } }

  // ── Tema: noche (por defecto), día o el del sistema ─────────────────────
  const claroDelSistema = window.matchMedia('(prefers-color-scheme: light)');
  function aplicarTema() {
    const t = prefs.tema === 'sistema' ? (claroDelSistema.matches ? 'claro' : 'oscuro') : prefs.tema === 'claro' ? 'claro' : 'oscuro';
    document.documentElement.dataset.tema = t;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'claro' ? '#f5f5f2' : '#000000');
    try { app?.tema?.(t); } catch { /* APK antiguo sin este puente */ }
  }
  claroDelSistema.addEventListener?.('change', () => { if (prefs.tema === 'sistema') aplicarTema(); });
  aplicarTema();

  const est = {
    skills: [], fuentes: [], modelos: { texto: [], imagen: [] }, conversaciones: [], tareas: [],
    conv: null, mensajes: [], enviando: null, estadoServidor: null,
  };

  const TAMANOS = { cuadrado: 'Cuadrada', vertical: 'Vertical', horizontal: 'Horizontal' };
  const ESTILOS = {
    fotorrealista: ['◉', 'Fotorrealista', 'Como una fotografía profesional: cámara, lente e iluminación reales'],
    cientifica: ['⌬', 'Ilustración científica', 'Estilo portada de Nature o Cell, estructuras precisas'],
    render3d: ['◈', 'Render 3D', 'Materiales realistas, iluminación cinematográfica'],
    microscopia: ['⁘', 'Microscopía', 'Fluorescencia, electrónica de barrido o histología'],
    infografia: ['⊞', 'Esquema', 'Diagrama limpio y minimalista, sin texto'],
    arte: ['✦', 'Arte', 'Interpretación artística libre'],
  };
  const estiloActual = () => prefs.estilo || (prefs.skill === 'ilustracion-cientifica' ? 'cientifica' : prefs.skill === 'imagen-creativa' ? 'arte' : 'fotorrealista');
  const MODOS = { chat: 'Chat', investigar: 'Investigar', imagen: 'Imagen' };
  const PLACEHOLDER = {
    chat: 'Pregunta lo que quieras…',
    investigar: '¿Qué investigamos? Buscaré en las fuentes…',
    imagen: 'Describe la imagen que quieres crear…',
  };
  const SUGERENCIAS = {
    chat: ['Explícame la diferencia entre mitosis y meiosis con una tabla', 'Escribe un script de Python para analizar un CSV de expresión génica', 'Diseña un experimento para medir el efecto de la luz en el crecimiento de plantas'],
    investigar: ['¿Qué se sabe del eje intestino-cerebro en la depresión?', 'Avances recientes en edición de bases con CRISPR', '¿Qué ensayos clínicos hay con semaglutida para Alzheimer?'],
    imagen: ['Corte transversal de una célula eucariota, estilo ilustración científica', 'Un bosque de cardones al amanecer en el desierto de Sonora', 'Estructura 3D de una proteína con hélices alfa, fondo negro'],
  };

  // ── API ──────────────────────────────────────────────────────────────────
  async function api(ruta, opciones = {}) {
    const res = await fetch(ruta, {
      method: opciones.metodo || 'GET',
      headers: opciones.cuerpo ? { 'Content-Type': 'application/json' } : {},
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
      credentials: 'same-origin',
    });
    const datos = await res.json().catch(() => ({}));
    if (res.status === 401 && ruta !== '/api/acceso' && !ruta.startsWith('/api/cuenta/')) { mostrarAcceso(); throw new Error('Sin acceso'); }
    if (!res.ok) throw new Error(datos.error || `Error ${res.status}`);
    return datos;
  }

  function aviso(texto, ms = 2200) {
    const a = $('#aviso');
    a.textContent = texto;
    a.hidden = false;
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => { a.hidden = true; }, ms);
  }

  // ── Arranque ─────────────────────────────────────────────────────────────
  async function iniciar() {
    let estado;
    try { estado = await api('/api/estado'); } catch { aviso('No se pudo conectar con el servidor'); return; }
    est.estadoServidor = estado;
    if (!estado.autorizado) return mostrarAcceso(estado);
    $('#acceso').hidden = true;
    $('#app').hidden = false;
    marcarGateway(estado.gateway);
    if (estado.demo) modoDemo(estado);
    const [skills, fuentes] = await Promise.all([api('/api/skills'), api('/api/fuentes')]);
    est.skills = skills;
    est.fuentes = fuentes;
    if (!est.skills.some(s => s.id === prefs.skill)) prefs.skill = est.skills[0]?.id || '';
    aplicarSkill(prefs.skill, false);
    ponerModo(prefs.modo, false);
    await cargarConversaciones();
    pintarMensajes();
    cargarModelos();
    setInterval(async () => {
      try { marcarGateway((await api('/api/estado')).gateway); } catch { marcarGateway(false); }
    }, 30_000);
  }

  // Versión de prueba: aviso fijo, sin imágenes ni configuración.
  function modoDemo(estado) {
    est.demo = true;
    if (!$('#banner-demo')) {
      const b = document.createElement('div');
      b.id = 'banner-demo';
      b.className = 'banner-demo';
      b.innerHTML = '<b>Versión de prueba</b> · <span id="uso-demo"></span> · <a href="https://labia-ciencia.pages.dev" target="_blank" rel="noopener">Crea tu propio laboratorio.ia gratis →</a>';
      $('.principal').insertBefore(b, $('#mensajes'));
    }
    const boton = document.querySelector('.modo[data-modo="imagen"]');
    if (boton) boton.hidden = true;
    if (prefs.modo === 'imagen') ponerModo('chat');
    pintarUsoDemo(estado.uso);
  }
  function pintarUsoDemo(uso) {
    if (!uso || !$('#uso-demo')) return;
    const quedan = k => Math.max(0, uso[k].limite - uso[k].usados);
    $('#uso-demo').textContent = `hoy te quedan ${quedan('chat')} mensajes y ${quedan('investigar')} investigaciones`;
  }
  async function refrescarUsoDemo() {
    if (!est.demo) return;
    try { pintarUsoDemo((await api('/api/estado')).uso); } catch { /* sin conexión */ }
  }

  function marcarGateway(ok) {
    const e = $('#estado-gw');
    e.className = 'estado-gw ' + (ok ? 'ok' : 'mal');
    e.title = ok ? 'FreeLLMAPI en línea' : 'FreeLLMAPI no responde';
  }

  // En el teléfono se entra con PIN; en la nube, con cuenta (el primer registro es el administrador).
  let modoCuenta = 'entrar';
  function mostrarAcceso(estado = est.estadoServidor) {
    $('#app').hidden = true;
    $('#acceso').hidden = false;
    const nube = Boolean(estado?.nube);
    $('#form-pin').hidden = nube;
    $('#form-cuenta').hidden = !nube;
    if (nube) {
      modoCuenta = estado.hayUsuarios ? 'entrar' : 'registro';
      pintarCuenta(estado);
      setTimeout(() => $('#cuenta-email').focus(), 50);
    } else {
      $('#acceso-texto').innerHTML = 'Escribe el PIN que aparece en el teléfono<br>(Ajustes → Conexión, o en la terminal de <code>lab</code>).';
      setTimeout(() => $('#pin').focus(), 50);
    }
  }
  function pintarCuenta(estado = est.estadoServidor) {
    const registro = modoCuenta === 'registro';
    $('#acceso-texto').textContent = !estado?.hayUsuarios
      ? 'Crea la cuenta de administrador de este laboratorio.ia. Será la única hasta que abras el registro en Ajustes.'
      : registro ? 'Crea tu cuenta en este laboratorio.ia.' : 'Entra con tu cuenta de laboratorio.ia.';
    $('#cuenta-boton').textContent = registro ? 'Crear cuenta' : 'Entrar';
    $('#cuenta-pass').autocomplete = registro ? 'new-password' : 'current-password';
    const cambiar = $('#cuenta-cambiar');
    cambiar.hidden = !(estado?.hayUsuarios && estado?.registroAbierto);
    cambiar.textContent = registro ? '¿Ya tienes cuenta? Entrar' : '¿No tienes cuenta? Crear una';
  }
  $('#cuenta-cambiar').addEventListener('click', () => { modoCuenta = modoCuenta === 'registro' ? 'entrar' : 'registro'; pintarCuenta(); });
  $('#form-cuenta').addEventListener('submit', async e => {
    e.preventDefault();
    $('#pin-error').textContent = '';
    try {
      await api(`/api/cuenta/${modoCuenta === 'registro' ? 'registro' : 'entrar'}`, { metodo: 'POST', cuerpo: { email: $('#cuenta-email').value.trim(), password: $('#cuenta-pass').value } });
      $('#cuenta-pass').value = '';
      iniciar();
    } catch (err) { $('#pin-error').textContent = err.message; }
  });

  $('#form-pin').addEventListener('submit', async e => {
    e.preventDefault();
    $('#pin-error').textContent = '';
    try {
      await api('/api/acceso', { metodo: 'POST', cuerpo: { pin: $('#pin').value.trim() } });
      $('#pin').value = '';
      iniciar();
    } catch (err) { $('#pin-error').textContent = err.message; }
  });

  async function cargarModelos() {
    try {
      const t = await api('/api/tareas');
      est.modelos = { texto: t.texto, imagen: t.imagen, error: t.error };
      est.tareas = t.tareas;
      if (t.error) aviso(t.error, 4000);
    } catch { /* se reintenta al abrir el selector */ }
    pintarChips();
  }

  // Igual que tareaDe() del servidor: qué tarea (y por tanto qué modelo) usa la petición.
  function tareaActual() {
    const s = skillActual();
    if (prefs.modo === 'imagen') return 'imagen';
    if (s?.tarea && est.tareas.some(t => t.id === s.tarea)) return s.tarea;
    if (prefs.modo === 'investigar') return 'investigar';
    if (s?.categoria === 'Código') return 'codigo';
    return 'chat';
  }
  const nombreModelo = id => (est.modelos.texto.find(m => m.id === id) || est.modelos.imagen.find(m => m.id === id))?.nombre || id;

  // ── Skills y modos ───────────────────────────────────────────────────────
  const skillActual = () => est.skills.find(s => s.id === prefs.skill) || null;

  function aplicarSkill(id, cambiarModo = true) {
    const s = est.skills.find(x => x.id === id);
    if (!s) return;
    prefs.skill = id;
    prefs.fuentes = null; // fuentes, lectura y verificación vuelven a las de la skill
    prefs.leer = null;
    prefs.verificacion = null;
    $('#skill-icono').textContent = s.icono;
    $('#skill-nombre').textContent = s.nombre;
    if (cambiarModo) ponerModo(s.modo);
    guardarPrefs();
    pintarChips();
    if (!est.mensajes.length) pintarMensajes();
  }

  function ponerModo(modo, guardar = true) {
    prefs.modo = MODOS[modo] ? modo : 'chat';
    document.querySelectorAll('.modo').forEach(b => b.classList.toggle('activo', b.dataset.modo === prefs.modo));
    $('#texto').placeholder = PLACEHOLDER[prefs.modo];
    if (guardar) guardarPrefs();
    pintarChips();
    if (!est.mensajes.length) pintarMensajes();
  }

  function fuentesActivas() {
    if (prefs.fuentes) return prefs.fuentes;
    const s = skillActual();
    return s?.fuentes?.length ? s.fuentes : ['web', 'openalex', 'europepmc', 'wikipedia'];
  }

  function pintarChips() {
    const modo = prefs.modo;
    $('#chip-fuentes').hidden = modo !== 'investigar';
    $('#chip-tamano').hidden = modo !== 'imagen';
    const f = fuentesActivas();
    $('#chip-fuentes span').textContent = f.length > 2 ? `${f.length} fuentes` : f.map(id => est.fuentes.find(x => x.id === id)?.nombre || id).join(', ');
    $('#chip-tamano span').textContent = `${ESTILOS[estiloActual()][1]} · ${({ alta: 'alta', premium: 'de pago' })[prefs.calidad] || 'rápida'} · ${TAMANOS[prefs.tamano].toLowerCase()}`;
    const modelo = modo === 'imagen' ? prefs.modeloImagen : prefs.modeloTexto;
    let etiqueta = modelo === 'auto' ? 'auto' : nombreModelo(modelo);
    if (modelo === 'auto') {
      // Sin modelo fijo en el chat: el de la skill o el de la tarea.
      const s = skillActual();
      const t = est.tareas.find(x => x.id === tareaActual());
      if (modo !== 'imagen' && s?.modelo) etiqueta = `skill · ${nombreModelo(s.modelo)}`;
      else if (t && t.modelo !== 'auto') etiqueta = `${t.nombre} · ${nombreModelo(t.modelo)}`;
    }
    $('#chip-modelo span').textContent = etiqueta;
    const c = prefs.combinar;
    const combinando = modo !== 'imagen' && c?.activa && c.modelos.length >= 2;
    $('#chip-combinar').hidden = modo === 'imagen';
    $('#chip-combinar').classList.toggle('activo', Boolean(combinando));
    $('#chip-combinar span').textContent = combinando ? `${c.modelos.length} modelos${c.mostrar ? ' · por separado' : ''}` : 'Combinar';
    $('#chip-modelo').hidden = Boolean(combinando);
  }

  // ── Recomendación según lo que se escribe ────────────────────────────────
  let ultimaRecomendacion = null;
  let relojRecomendacion = null;
  function programarRecomendacion() {
    clearTimeout(relojRecomendacion);
    const t = $('#texto').value.trim();
    if (t.length < 12 || prefs.modo === 'imagen') { $('#recomendacion').hidden = true; return; }
    relojRecomendacion = setTimeout(async () => {
      try {
        const rec = await api('/api/recomendar', { metodo: 'POST', cuerpo: { texto: t, modo: prefs.modo, skill: prefs.skill } });
        ultimaRecomendacion = rec;
        pintarRecomendacion();
      } catch { /* sin recomendación */ }
    }, 700);
  }

  function pintarRecomendacion() {
    const rec = ultimaRecomendacion;
    const caja = $('#recomendacion');
    if (!rec?.modelos?.length || !$('#texto').value.trim()) { caja.hidden = true; return; }
    const corto = id => nombreModelo(id).replace(/ · .*$/, '').replace(/^.*\//, '').slice(0, 28);
    const elegido = prefs.modeloTexto;
    caja.innerHTML = `<span class="rec-tema" title="${esc(rec.motivo)}">${esc(rec.icono || '◈')} ${esc(rec.nombreTarea || rec.tarea)}</span>
      <span class="rec-motivo">${esc(rec.motivo)}</span>
      ${rec.modelos.slice(0, 3).map(m => `<button class="chip rec-modelo${m.id === elegido ? ' activo' : ''}" data-rec="${esc(m.id)}" title="${esc(m.nombre)}">${esc(corto(m.id))}</button>`).join('')}
      ${rec.combinacion?.length >= 2 ? `<button class="chip rec-combinar" data-rec-combinar>⧉ Combinar ${rec.combinacion.length}</button>` : ''}
      <button class="chip rec-cerrar" data-rec-cerrar aria-label="Cerrar">✕</button>`;
    caja.hidden = false;
  }

  $('#recomendacion').addEventListener('click', e => {
    const m = e.target.closest('[data-rec]');
    if (m) {
      // Un modelo concreto: se usa en el próximo envío (y se apaga la combinación).
      prefs.modeloTexto = prefs.modeloTexto === m.dataset.rec ? 'auto' : m.dataset.rec;
      prefs.combinar.activa = false;
      guardarPrefs(); pintarChips(); pintarRecomendacion();
      return;
    }
    if (e.target.closest('[data-rec-combinar]')) {
      prefs.combinar = { ...prefs.combinar, activa: true, modelos: ultimaRecomendacion.combinacion.slice(0, 4) };
      guardarPrefs(); pintarChips();
      aviso(`Combinando ${prefs.combinar.modelos.length} modelos`);
      return;
    }
    if (e.target.closest('[data-rec-cerrar]')) $('#recomendacion').hidden = true;
  });

  async function hojaCombinar() {
    if (!est.modelos.texto.length) await cargarModelos();
    const c = prefs.combinar;
    const elegidos = new Set(c.modelos);
    const sugeridos = ultimaRecomendacion?.modelos?.map(m => m.id) || [];
    const lista = [...new Set([...c.modelos, ...sugeridos, ...est.modelos.texto.map(m => m.id)])].filter(id => id !== 'auto');
    const fila = id => `<label class="casilla"><input type="checkbox" value="${esc(id)}"${elegidos.has(id) ? ' checked' : ''}><span>${esc(nombreModelo(id))}${sugeridos.includes(id) ? ' <small style="color:var(--rojo);display:inline">· recomendado</small>' : ''}<small>${esc(id)}</small></span></label>`;
    abrirHoja('Combinar modelos', `
      <p class="tenue" style="font-size:13px;margin:0 0 8px">Elige de 2 a 4 modelos: responden a la vez y un integrador une lo mejor de cada uno en una sola respuesta. ${ultimaRecomendacion ? `Para lo que escribes (${esc(ultimaRecomendacion.nombreTarea)}) se recomiendan modelos de familias distintas.` : ''}</p>
      <label class="casilla"><input type="checkbox" id="cb-mostrar"${c.mostrar ? ' checked' : ''}><span>Mostrar también la respuesta de cada modelo<small>En pestañas, encima de la respuesta integrada.</small></span></label>
      <label class="campo"><span>Integrador</span><select id="cb-integrador">
        <option value="auto"${c.integrador === 'auto' ? ' selected' : ''}>El de la tarea Razonamiento (recomendado)</option>
        ${est.modelos.texto.filter(m => m.id !== 'auto').map(m => `<option value="${esc(m.id)}"${c.integrador === m.id ? ' selected' : ''}>${esc(m.nombre)}</option>`).join('')}
      </select></label>
      <input class="buscar" id="cb-filtro" type="search" placeholder="Buscar modelo">
      <div id="cb-lista">${lista.slice(0, 60).map(fila).join('')}</div>
      <p id="cb-cuenta" class="tenue" style="font: 12px var(--mono)"></p>
      <div class="fila-botones"><button class="btn primario" data-op="activar">Combinar</button><button class="btn" data-op="desactivar">Un solo modelo</button></div>`, cuerpo => {
      const contar = () => {
        const n = cuerpo.querySelectorAll('#cb-lista input:checked').length;
        cuerpo.querySelector('#cb-cuenta').textContent = n < 2 ? 'Elige al menos 2 modelos.' : n > 4 ? 'Máximo 4 modelos.' : `${n} modelos seleccionados.`;
      };
      contar();
      cuerpo.addEventListener('change', e => { if (e.target.closest('#cb-lista')) { if (e.target.checked) elegidos.add(e.target.value); else elegidos.delete(e.target.value); contar(); } });
      cuerpo.querySelector('#cb-filtro').addEventListener('input', e => {
        const f = e.target.value.toLowerCase();
        cuerpo.querySelector('#cb-lista').innerHTML = lista.filter(id => (id + nombreModelo(id)).toLowerCase().includes(f)).slice(0, 60).map(fila).join('');
      });
      cuerpo.addEventListener('click', e => {
        const op = e.target.closest('[data-op]')?.dataset.op;
        if (op === 'desactivar') { prefs.combinar.activa = false; guardarPrefs(); pintarChips(); cerrarHoja(); }
        if (op === 'activar') {
          const modelos = [...elegidos].slice(0, 4);
          if (modelos.length < 2) { aviso('Elige al menos 2 modelos'); return; }
          prefs.combinar = { activa: true, modelos, integrador: cuerpo.querySelector('#cb-integrador').value, mostrar: cuerpo.querySelector('#cb-mostrar').checked };
          guardarPrefs(); pintarChips(); cerrarHoja();
          aviso(`Combinando ${modelos.length} modelos`);
        }
      });
    }, true);
  }

  document.querySelectorAll('.modo').forEach(b => b.addEventListener('click', () => ponerModo(b.dataset.modo)));

  // ── Conversaciones ───────────────────────────────────────────────────────
  async function cargarConversaciones() {
    try { est.conversaciones = await api('/api/conversaciones'); } catch { est.conversaciones = []; }
    pintarLista();
  }

  function grupoFecha(ms) {
    const dia = 86_400_000;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    if (ms >= hoy) return 'Hoy';
    if (ms >= hoy - dia) return 'Ayer';
    if (ms >= hoy - 7 * dia) return 'Últimos 7 días';
    if (ms >= hoy - 30 * dia) return 'Últimos 30 días';
    return 'Antes';
  }

  function pintarLista() {
    const filtro = $('#buscar-conv').value.trim().toLowerCase();
    const lista = est.conversaciones.filter(c => !filtro || c.titulo.toLowerCase().includes(filtro));
    let grupo = '';
    let html = '';
    for (const c of lista) {
      const g = grupoFecha(c.actualizada);
      if (g !== grupo) { html += `<div class="grupo-conv">${g}</div>`; grupo = g; }
      const sk = est.skills.find(s => s.id === c.skill);
      html += `<div class="item-conv${est.conv === c.id ? ' activa' : ''}"><button data-conv="${c.id}" title="${esc(c.titulo)}">${sk ? esc(sk.icono) + ' ' : ''}${esc(c.titulo)}</button><button class="mas" data-menu-conv="${c.id}" aria-label="Opciones">⋯</button></div>`;
    }
    $('#lista-conv').innerHTML = html || '<p class="tenue" style="padding:10px;font-size:14px">Aún no hay conversaciones.</p>';
  }

  $('#buscar-conv').addEventListener('input', pintarLista);
  $('#lista-conv').addEventListener('click', async e => {
    const abrir = e.target.closest('[data-conv]');
    const menu = e.target.closest('[data-menu-conv]');
    if (abrir) { await abrirConversacion(abrir.dataset.conv); cerrarLateral(); }
    if (menu) menuConversacion(menu.dataset.menuConv);
  });

  async function abrirConversacion(id) {
    if (est.enviando) est.enviando.abort();
    const c = await api(`/api/conversaciones/${id}`);
    est.conv = c.id;
    est.mensajes = c.mensajes;
    if (c.skill && est.skills.some(s => s.id === c.skill)) aplicarSkill(c.skill, false);
    pintarLista();
    pintarMensajes();
  }

  function nuevaConversacion() {
    if (est.enviando) est.enviando.abort();
    est.conv = null;
    est.mensajes = [];
    pintarLista();
    pintarMensajes();
    cerrarLateral();
    $('#texto').focus();
  }

  function menuConversacion(id) {
    const c = est.conversaciones.find(x => x.id === id);
    if (!c) return;
    abrirHoja('Conversación', `
      <button class="opcion" data-op="memoria"><span class="ic">◷</span><span class="txt"><span class="nm">Memoria del chat</span><span class="ds">Ver o editar lo que recuerda</span></span></button>
      <button class="opcion" data-op="renombrar"><span class="ic">✎</span><span class="txt"><span class="nm">Renombrar</span></span></button>
      <button class="opcion" data-op="borrar"><span class="ic" style="color:var(--rojo)">✕</span><span class="txt"><span class="nm">Borrar</span></span></button>`, cuerpo => {
      cuerpo.addEventListener('click', async e => {
        const op = e.target.closest('[data-op]')?.dataset.op;
        if (op === 'memoria') { if (est.conv !== id) await abrirConversacion(id); hojaMemoria(); return; }
        if (op === 'renombrar') {
          const titulo = prompt('Nuevo nombre', c.titulo);
          if (titulo?.trim()) { await api(`/api/conversaciones/${id}`, { metodo: 'PATCH', cuerpo: { titulo } }); await cargarConversaciones(); }
          cerrarHoja();
        }
        if (op === 'borrar' && confirm('¿Borrar esta conversación?')) {
          await api(`/api/conversaciones/${id}`, { metodo: 'DELETE' });
          if (est.conv === id) nuevaConversacion();
          await cargarConversaciones();
          cerrarHoja();
        }
      });
    });
  }

  // ── Pintado de mensajes ──────────────────────────────────────────────────
  function pintarMensajes() {
    const cont = $('#mensajes');
    if (!est.mensajes.length) { cont.innerHTML = pantallaInicio(); return; }
    cont.innerHTML = '';
    for (const m of est.mensajes) cont.appendChild(nodoMensaje(m));
    cont.scrollTop = cont.scrollHeight;
  }

  function pantallaInicio() {
    const hora = new Date().getHours();
    const saludo = hora < 6 ? 'Buenas noches' : hora < 13 ? 'Buenos días' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
    const destacadas = est.skills.filter(s => s.modo === prefs.modo || (prefs.modo === 'chat' && s.modo === 'chat')).slice(0, 6);
    const tarjetas = (destacadas.length ? destacadas : est.skills.slice(0, 6)).map(s => `
      <button class="tarjeta" data-usar-skill="${s.id}">
        <span class="ic">${esc(s.icono)}</span>
        <span class="nm">${esc(s.nombre)}</span>
        <span class="ds">${esc(s.descripcion)}</span>
        ${s.modo !== 'chat' ? `<span class="tag">${MODOS[s.modo]}</span>` : ''}
      </button>`).join('');
    const sugerencias = SUGERENCIAS[prefs.modo].map(t => `<button class="sugerencia" data-sugerencia="${esc(t)}">${esc(t)}</button>`).join('');
    return `<div class="inicio">
      <h1 class="saludo">${saludo}<span>.</span></h1>
      <p class="sub-inicio">${prefs.modo === 'investigar' ? 'Busco en PubMed, Europe PMC, UniProt, arXiv, la web y más, y te respondo con citas.' : prefs.modo === 'imagen' ? 'Describe una imagen: la mejoro y la genero.' : 'Elige una skill o escribe directamente.'}</p>
      <div class="titulo-seccion">Skills</div>
      <div class="tarjetas">${tarjetas}</div>
      <div class="titulo-seccion">Prueba con</div>
      <div class="sugerencias">${sugerencias}</div>
    </div>`;
  }

  $('#mensajes').addEventListener('click', e => {
    const usar = e.target.closest('[data-usar-skill]');
    if (usar) { aplicarSkill(usar.dataset.usarSkill); $('#texto').focus(); return; }
    const sug = e.target.closest('[data-sugerencia]');
    if (sug) { $('#texto').value = sug.dataset.sugerencia; ajustarAltura(); $('#texto').focus(); return; }
    const copiarCodigo = e.target.closest('pre .copiar');
    if (copiarCodigo) { copiar(copiarCodigo.parentElement.querySelector('code').textContent); return; }
    const img = e.target.closest('.imagen-gen img');
    if (img) { abrirVisor(img.src); return; }
    const acc = e.target.closest('[data-acc]');
    if (acc) accionMensaje(acc.dataset.acc, acc.closest('.msg'));
    const pe = e.target.closest('[data-pestana]');
    if (pe) {
      const div = pe.closest('.msg');
      div.querySelector('.combinacion').dataset.sel = pe.dataset.pestana;
      const m = est.mensajes.find(x => x.id === div.dataset.id) || est.mensajes[est.mensajes.length - 1];
      pintarCombinacion(div, m);
      return;
    }
    const vf = e.target.closest('[data-verif]');
    if (vf) verificarDeNuevo(vf.closest('.msg'), vf.dataset.verif);
    const pr = e.target.closest('[data-preferir]');
    if (pr) {
      const div = pr.closest('.msg');
      const m = est.mensajes.find(x => x.id === div.dataset.id);
      const k = Number(pr.dataset.preferir);
      if (m) valorar(m, div, { preferido: m.meta.preferido === k ? -1 : k });
    }
  });

  $('#mensajes').addEventListener('change', async e => {
    const rev = e.target.closest('[data-rev]');
    if (!rev) return;
    const div = rev.closest('.msg');
    const m = est.mensajes.find(x => x.id === div.dataset.id);
    if (!m) return;
    try {
      const { revision } = await api(`/api/mensajes/${m.id}/revision`, { metodo: 'PATCH', cuerpo: { n: Number(rev.dataset.rev), revisado: rev.checked } });
      m.meta.revision = revision;
      if (m.meta.verificacion) pintarVerificacion(div, m);
    } catch (err) { aviso(err.message); rev.checked = !rev.checked; }
  });

  $('#mensajes').addEventListener('mouseover', e => {
    const c = e.target.closest('.cita');
    document.querySelectorAll('.fuente.resaltada').forEach(f => f.classList.remove('resaltada'));
    if (c) c.closest('.msg')?.querySelector(`.fuente[data-n="${c.dataset.n}"]`)?.classList.add('resaltada');
  });

  function nodoMensaje(m) {
    const div = document.createElement('div');
    div.className = `msg ${m.rol}`;
    div.dataset.id = m.id || '';
    if (m.rol === 'user') {
      div.innerHTML = `<div class="burbuja">${esc(m.contenido)}</div>
        <div class="acciones-msg acciones-usuario"><button data-acc="editar" title="Editar y volver a enviar">✎ editar</button><button data-acc="copiar">copiar</button></div>`;
      if (m.meta?.edicion) div.querySelector('.acciones-usuario').insertAdjacentHTML('afterbegin', '<span class="editado" title="Editaste esta pregunta">editada</span>');
      return div;
    }
    const meta = m.meta || {};
    const sk = est.skills.find(s => s.id === meta.skill);
    div.innerHTML = `
      <div class="etiqueta-msg"><span class="punto"></span>${esc(sk ? sk.nombre : 'laboratorio.ia')}${meta.modo && meta.modo !== 'chat' ? ' · ' + MODOS[meta.modo] : ''}${meta.combinacion ? ` · ⧉ ${meta.combinacion.respuestas.length} modelos integrados` : ''}</div>
      <div class="estado" hidden><span class="matriz">${'<i></i>'.repeat(9)}</span><span class="estado-texto"></span></div>
      <details class="razon" hidden><summary>Razonamiento</summary><div class="razon-texto"></div></details>
      <details class="fuentes" hidden><summary>Fuentes</summary><div class="consultas"></div><div class="lista-fuentes"></div><div class="fallos"></div></details>
      <details class="verif" hidden><summary>Verificación</summary><div class="verif-cuerpo"></div></details>
      <details class="combinacion" hidden><summary></summary><div class="pestanas"></div><div class="panel-modelo md"></div></details>
      <div class="imagenes"></div>
      <div class="cuerpo md"></div>
      <div class="acciones-msg" hidden></div>`;
    actualizarMensaje(div, m, true);
    return div;
  }

  function actualizarMensaje(div, m, final) {
    const meta = m.meta || {};
    if (meta.razonamiento && prefs.razonamiento) {
      const r = div.querySelector('.razon');
      r.hidden = false;
      r.querySelector('.razon-texto').textContent = meta.razonamiento;
    }
    if (meta.fuentes?.length || meta.fallos?.length) {
      const f = div.querySelector('.fuentes');
      f.hidden = false;
      f.querySelector('summary').textContent = `Fuentes · ${meta.fuentes?.length || 0}`;
      const enlaces = Object.fromEntries((meta.verificacion?.enlaces || []).map(e => [e.n, e]));
      const revision = meta.revision || {};
      f.querySelector('.lista-fuentes').innerHTML = (meta.fuentes || []).map(x => {
        const v = enlaces[x.n];
        const insignia = !v ? '' : v.ok ? '<span class="ins ok" title="Enlace y DOI comprobados">✓</span>'
          : v.enlace === 'roto' || v.doi === 'no existe' ? `<span class="ins mal" title="${esc(v.enlace)}${v.doi ? ' · DOI ' + esc(v.doi) : ''}">✗</span>`
          : `<span class="ins medio" title="${esc(v.enlace)}${v.doi ? ' · DOI ' + esc(v.doi) : ''}">!</span>`;
        return `<div class="fuente" data-n="${x.n}">
          <span class="n">${x.n}</span>
          <a class="t" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.titulo)} ${insignia}</a>
          <span class="d">${esc(x.fuente)}${x.detalle ? ' · ' + esc(x.detalle) : ''}${x.leida ? ' · <b>leída</b>' : ''}</span>
          <span class="r">${esc(x.resumen || '')}</span>
          ${m.id ? `<label class="rev"><input type="checkbox" data-rev="${x.n}"${revision[x.n]?.revisado ? ' checked' : ''}> revisada por mí</label>` : ''}
        </div>`;
      }).join('');
      f.querySelector('.consultas').innerHTML = meta.consultas?.length
        ? `<div class="consultas-tit">Repite la búsqueda tú mismo</div>${meta.consultas.map(c => `<a class="chip-consulta" href="${esc(c.url)}" target="_blank" rel="noopener" title="${esc(c.termino)}">${esc(c.fuente)} ↗</a>`).join('')}`
        : '';
      f.querySelector('.fallos').textContent = meta.fallos?.length ? `Sin respuesta: ${meta.fallos.join(' · ')}` : '';
    }
    if (meta.verificacion && m.id) pintarVerificacion(div, m);
    if (meta.combinacion) pintarCombinacion(div, m);
    if (meta.imagenes?.length) {
      div.querySelector('.imagenes').innerHTML = meta.imagenes.map(u => `<div class="imagen-gen"><img src="${esc(u)}" alt="${esc(meta.prompt || 'Imagen generada')}" loading="lazy"></div>`).join('')
        + (meta.prompt ? `<div class="prompt-usado">${meta.estilo && ESTILOS[meta.estilo] ? `${esc(ESTILOS[meta.estilo][1])}${meta.calidad === 'alta' ? ' · alta' : meta.calidad === 'premium' ? ' · de pago' : ''} · ` : ''}${esc(meta.prompt)}</div>` : '');
    }
    const cuerpo = div.querySelector('.cuerpo');
    cuerpo.innerHTML = window.renderMd(m.contenido || '', meta.fuentes);
    cuerpo.classList.toggle('cursor', !final);
    if (m.error) cuerpo.innerHTML += `<div class="error-msg">${window.renderMd(m.error)}</div>`;
    if (final) {
      const acc = div.querySelector('.acciones-msg');
      acc.hidden = false;
      const esUltimo = est.mensajes[est.mensajes.length - 1] === m;
      acc.innerHTML = `
        ${m.contenido ? '<button data-acc="copiar">copiar</button>' : ''}
        ${meta.imagenes?.length ? '<button data-acc="guardar">guardar</button>' : ''}
        ${esUltimo ? '<button data-acc="regenerar">regenerar</button>' : ''}
        ${m.id && (m.contenido || meta.imagenes?.length) ? `<button data-acc="bien" class="valorar${meta.valoracion === 1 ? ' activo' : ''}" title="Buena respuesta (sirve para entrenar tu modelo)" aria-label="Buena respuesta">▲</button><button data-acc="mal" class="valorar${meta.valoracion === -1 ? ' activo mal' : ''}" title="Mala respuesta" aria-label="Mala respuesta">▼</button>` : ''}
        ${meta.descartadas?.length ? `<span class="tenue" style="font:11px var(--mono)" title="Respuestas anteriores guardadas como peores">↻${meta.descartadas.length}</span>` : ''}
        ${meta.modelo ? `<span class="modelo-usado" title="${esc(meta.modelo)}">${esc(meta.modelo)}</span>` : ''}`;
    }
  }

  // Respuestas de cada modelo en pestañas (la integrada va en el cuerpo del mensaje).
  function pintarCombinacion(div, m) {
    const c = m.meta.combinacion;
    const d = div.querySelector('.combinacion');
    d.hidden = false;
    const etq = div.querySelector('.etiqueta-msg');
    if (etq && !etq.textContent.includes('⧉')) etq.append(` · ⧉ ${c.respuestas.length} modelos integrados`);
    if (d.dataset.inicial !== '1') { d.open = c.mostrar !== false; d.dataset.inicial = '1'; }
    const sel = Math.min(Number(d.dataset.sel || 0), c.respuestas.length - 1);
    const corto = id => String(id || '').replace(/^.*\//, '').replace(/:free$/, '').slice(0, 26);
    const ok = c.respuestas.filter(r => r.texto && !r.error).length;
    d.querySelector('summary').textContent = `⧉ Respuestas por modelo · ${ok}/${c.respuestas.length}${c.integrador ? ` · integradas por ${corto(c.integrador)}` : ''}`;
    d.querySelector('.pestanas').innerHTML = c.respuestas.map((r, i) => `<button class="pestana${i === sel ? ' activa' : ''}" data-pestana="${i}"><span class="pt ${r.error ? 'mal' : r.escribiendo ? 'esc' : 'ok'}"></span>${esc(corto(r.modelo))}</button>`).join('');
    const r = c.respuestas[sel];
    const preferido = m.meta.preferido;
    d.querySelector('.pestanas').querySelectorAll('[data-pestana]').forEach(b => { if (Number(b.dataset.pestana) === preferido) b.insertAdjacentHTML('beforeend', ' ★'); });
    d.querySelector('.panel-modelo').innerHTML = (r.error && !r.texto
      ? `<p class="mal">${esc(r.error)}</p>`
      : window.renderMd(r.texto || '…', m.meta.fuentes) + (r.error ? `<p class="mal">${esc(r.error)}</p>` : ''))
      + (m.id && r.texto && !r.error ? `<div class="fila-botones"><button class="btn chico${preferido === sel ? ' rojo' : ''}" data-preferir="${sel}">${preferido === sel ? '★ Elegida como la mejor' : '☆ Esta fue la mejor'}</button></div>` : '');
  }

  const VEREDICTO = { respaldada: ['ok', '✓ respaldada'], parcial: ['medio', '! parcial'], no_respaldada: ['mal', '✗ no respaldada'], sin_cita: ['mal', '✗ sin cita'] };

  function pintarVerificacion(div, m) {
    const v = m.meta.verificacion;
    const d = div.querySelector('.verif');
    d.hidden = false;
    if (v.error) { d.querySelector('summary').textContent = 'Verificación · error'; d.querySelector('.verif-cuerpo').innerHTML = `<p class="error">${esc(v.error)}</p>`; return; }
    const total = (m.meta.fuentes || []).length;
    const revisadas = Object.values(m.meta.revision || {}).filter(r => r.revisado).length;
    const ok = v.enlaces.filter(e => e.ok).length;
    const marca = v.estado === 'verificada' ? '✓ verificada' : v.estado === 'parcial' ? '! parcialmente verificada' : '✗ revisar';
    d.querySelector('summary').innerHTML = `<span class="v-${v.estado}">${marca}</span> · enlaces ${ok}/${v.enlaces.length}${v.afirmaciones ? ` · afirmaciones ${v.afirmaciones.filter(a => a.veredicto === 'respaldada').length}/${v.afirmaciones.length}` : ''} · revisadas por ti ${revisadas}/${total}`;
    const lineaEnlace = e => `<li><b>[${e.n}]</b> ${e.ok ? '<span class="ok">✓</span>' : '<span class="mal">✗</span>'} enlace: ${esc(e.enlace)}${e.http ? ` (HTTP ${e.http})` : ''}${e.doi ? ` · DOI ${esc(e.doi)}` : ''}${e.doi === 'registrado con otro título' ? ` — «${esc(e.tituloDoi || '')}»` : ''}</li>`;
    d.querySelector('.verif-cuerpo').innerHTML = `
      ${v.citas.inexistentes.length ? `<p class="mal">✗ Citas a fuentes que no existen: ${v.citas.inexistentes.map(n => `[${n}]`).join(' ')}</p>` : '<p class="ok" style="margin:0 0 6px">✓ Todas las citas corresponden a fuentes reales.</p>'}
      <div class="verif-tit">Enlaces y DOI de las fuentes citadas</div>
      <ul class="verif-lista">${v.enlaces.map(lineaEnlace).join('')}</ul>
      ${v.afirmaciones ? `<div class="verif-tit">Revisión automática de afirmaciones</div>
        ${v.resumen ? `<p class="tenue" style="font-size:13px;margin:4px 0 8px">${esc(v.resumen)}</p>` : ''}
        <ul class="verif-lista">${v.afirmaciones.map(a => {
          const [cls, txt] = VEREDICTO[a.veredicto] || VEREDICTO.parcial;
          return `<li><span class="${cls}">${txt}</span> ${a.citas.map(n => `[${n}]`).join('')} — ${esc(a.texto)}${a.nota ? `<br><small class="tenue">${esc(a.nota)}</small>` : ''}</li>`;
        }).join('')}</ul>` : v.errorRevision ? `<p class="tenue" style="font-size:13px">La revisión de afirmaciones no se pudo hacer: ${esc(v.errorRevision.slice(0, 200))}</p>` : ''}
      <p class="tenue" style="font-size:12px;margin:8px 0 0">Comprobado ${new Date(v.fecha).toLocaleString()}${v.modeloRevision ? ' · revisión con modelo automático' : ''}. Revisión manual: abre cada fuente y márcala como «revisada por mí».</p>
      <div class="fila-botones">
        <button class="btn chico" data-verif="basica">↻ Comprobar enlaces</button>
        <button class="btn chico rojo" data-verif="completa">✦ Revisar afirmaciones con IA</button>
        <button class="btn chico" data-verif="todas">Marcar todas revisadas</button>
      </div>`;
  }

  async function verificarDeNuevo(div, modo) {
    const m = est.mensajes.find(x => x.id === div.dataset.id);
    if (!m) return;
    if (modo === 'todas') {
      const { revision } = await api(`/api/mensajes/${m.id}/revision`, { metodo: 'PATCH', cuerpo: { todas: true, revisado: true } });
      m.meta.revision = revision;
      actualizarMensaje(div, m, true);
      return;
    }
    const botones = div.querySelectorAll('[data-verif]');
    botones.forEach(b => { b.disabled = true; });
    div.querySelector(`[data-verif="${modo}"]`).textContent = modo === 'completa' ? 'Revisando… (hasta 4 min)' : 'Comprobando…';
    try {
      const { verificacion } = await api(`/api/mensajes/${m.id}/verificar`, { metodo: 'POST', cuerpo: { completa: modo === 'completa' } });
      m.meta.verificacion = verificacion;
    } catch (err) { aviso(err.message, 4000); }
    actualizarMensaje(div, m, true);
    div.querySelector('.verif').open = true;
  }

  function accionMensaje(acc, div) {
    const m = (div.dataset.id && est.mensajes.find(x => x.id === div.dataset.id)) || est.mensajes[est.mensajes.length - 1];
    if (acc === 'copiar') copiar(m.contenido);
    if (acc === 'guardar') guardarImagen(m.meta.imagenes[0]);
    if (acc === 'regenerar') enviar({ regenerar: true });
    if (acc === 'editar') editarPregunta(div, m);
    if (acc === 'bien' || acc === 'mal') {
      const v = acc === 'bien' ? 1 : -1;
      valorar(m, div, { valor: m.meta.valoracion === v ? 0 : v });
    }
  }

  /** 👍/👎 y «la mejor» de una combinación: señales para entrenar tu propio modelo. */
  async function valorar(m, div, cambios) {
    if (!m.id) return;
    try {
      const r = await api(`/api/mensajes/${m.id}/valoracion`, { metodo: 'PATCH', cuerpo: cambios });
      m.meta.valoracion = r.valoracion;
      m.meta.preferido = r.preferido;
      actualizarMensaje(div, m, true);
      if (cambios.valor === -1) aviso('Anotado. Puedes regenerar o editar la pregunta para mejorarla.');
    } catch (err) { aviso(err.message); }
  }

  /** Convierte la burbuja en un editor; al enviar se borra desde esa pregunta y se responde de nuevo. */
  function editarPregunta(div, m) {
    if (est.enviando) { aviso('Espera a que termine la respuesta'); return; }
    if (!m.id) { aviso('Esta pregunta aún se está guardando'); return; }
    if (div.querySelector('.editor-msg')) return;
    const posteriores = est.mensajes.length - est.mensajes.indexOf(m) - 1;
    div.classList.add('editando');
    div.insertAdjacentHTML('beforeend', `<div class="editor-msg">
      <textarea rows="3" aria-label="Editar pregunta"></textarea>
      <p class="tenue">${posteriores > 1 ? `Se reemplazarán las ${posteriores} respuestas y mensajes que siguen.` : 'Se reemplazará la respuesta.'} La versión anterior se guarda para entrenar tu modelo.</p>
      <div class="fila-botones"><button class="btn chico" data-editor="cancelar">Cancelar</button><button class="btn chico primario" data-editor="enviar">Enviar de nuevo</button></div>
    </div>`);
    const ta = div.querySelector('.editor-msg textarea');
    ta.value = m.contenido;
    ta.style.height = Math.min(ta.scrollHeight + 4, window.innerHeight * 0.4) + 'px';
    ta.focus();
    div.querySelector('.editor-msg').addEventListener('click', ev => {
      const op = ev.target.closest('[data-editor]')?.dataset.editor;
      if (!op) return;
      ev.stopPropagation();
      if (op === 'cancelar') { div.querySelector('.editor-msg').remove(); div.classList.remove('editando'); return; }
      const nuevo = ta.value.trim();
      if (!nuevo) return;
      // Quita de la vista esta pregunta y todo lo que sigue; el servidor hace lo mismo.
      const i = est.mensajes.indexOf(m);
      est.mensajes.splice(i);
      let n = div;
      while (n) { const sig = n.nextElementSibling; n.remove(); n = sig; }
      enviar({ editar: m.id, contenido: nuevo });
    });
  }

  function copiar(texto) {
    if (app?.copiar) { app.copiar(texto); aviso('Copiado'); return; }
    navigator.clipboard?.writeText(texto).then(() => aviso('Copiado'), () => aviso('No se pudo copiar'));
  }

  function guardarImagen(url) {
    const absoluta = new URL(url, location.href).href;
    if (app?.guardarImagen) { app.guardarImagen(absoluta); return; }
    const a = document.createElement('a');
    a.href = absoluta;
    a.download = absoluta.split('/').pop();
    a.click();
  }

  // ── Enviar y recibir (SSE sobre fetch) ───────────────────────────────────
  const texto = $('#texto');
  function ajustarAltura() { texto.style.height = 'auto'; texto.style.height = Math.min(texto.scrollHeight, window.innerHeight * 0.4) + 'px'; }
  texto.addEventListener('input', () => { ajustarAltura(); programarRecomendacion(); });
  texto.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 900px)').matches) { e.preventDefault(); enviar(); }
  });
  $('#form-msg').addEventListener('submit', e => { e.preventDefault(); est.enviando ? est.enviando.abort() : enviar(); });

  function botonEnviar(detener) {
    const b = $('#enviar');
    b.classList.toggle('detener', detener);
    b.setAttribute('aria-label', detener ? 'Detener' : 'Enviar');
    b.innerHTML = detener
      ? '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  async function enviar({ regenerar = false, editar = null, contenido: editado = null } = {}) {
    const contenido = editado ?? texto.value.trim();
    if (!regenerar && !contenido) return;
    if (est.enviando) return;
    const cont = $('#mensajes');
    if (!est.mensajes.length) cont.innerHTML = '';

    if (regenerar) {
      const ultimo = est.mensajes[est.mensajes.length - 1];
      if (ultimo?.rol === 'assistant') { est.mensajes.pop(); cont.lastElementChild?.remove(); }
    } else {
      var mu = { rol: 'user', contenido, meta: editar ? { edicion: {} } : {} };
      est.mensajes.push(mu);
      cont.appendChild(nodoMensaje(mu));
      if (!editar) { texto.value = ''; ajustarAltura(); }
      $('#recomendacion').hidden = true;
    }

    const ma = { rol: 'assistant', contenido: '', meta: { modo: prefs.modo, skill: prefs.skill } };
    est.mensajes.push(ma);
    const nodo = nodoMensaje(ma);
    nodo.querySelector('.acciones-msg').hidden = true;
    cont.appendChild(nodo);
    const estado = nodo.querySelector('.estado');
    const ponerEstado = t => { estado.hidden = !t; nodo.querySelector('.estado-texto').textContent = t || ''; };
    ponerEstado(prefs.modo === 'imagen' ? 'Preparando…' : 'Conectando…');
    if (prefs.modo === 'imagen') nodo.querySelector('.imagenes').innerHTML = `<div class="imagen-gen cargando" style="aspect-ratio:${prefs.tamano === 'vertical' ? '768/1344' : prefs.tamano === 'horizontal' ? '1344/768' : '1'}"><span class="matriz">${'<i></i>'.repeat(9)}</span></div>`;
    seguir(true);

    const ctl = new AbortController();
    est.enviando = ctl;
    botonEnviar(true);
    let pendiente = false;
    let verificarLuego = null;
    const repintar = () => {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(() => { pendiente = false; actualizarMensaje(nodo, ma, false); seguir(); });
    };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        signal: ctl.signal,
        body: JSON.stringify({
          conversacion: est.conv, texto: contenido, regenerar, editar: editar || undefined, modo: prefs.modo, skill: prefs.skill,
          modelo: prefs.modeloTexto, modeloImagen: prefs.modeloImagen, tamano: prefs.tamano,
          estilo: estiloActual(), calidad: ['alta', 'premium'].includes(prefs.calidad) ? prefs.calidad : 'rapida',
          combinar: prefs.modo !== 'imagen' && prefs.combinar?.activa && prefs.combinar.modelos.length >= 2
            ? { modelos: prefs.combinar.modelos, integrador: prefs.combinar.integrador, mostrar: prefs.combinar.mostrar } : undefined,
          fuentes: prefs.modo === 'investigar' ? fuentesActivas() : undefined,
          leer: prefs.modo === 'investigar' && prefs.leer != null ? prefs.leer : undefined,
          verificacion: prefs.modo === 'investigar' && prefs.verificacion ? prefs.verificacion : undefined,
        }),
      });
      if (res.status === 401) { mostrarAcceso(); return; }
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Error ${res.status}`);
      }
      const lector = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let corte;
        while ((corte = buf.indexOf('\n\n')) >= 0) {
          const bloque = buf.slice(0, corte);
          buf = buf.slice(corte + 2);
          const ev = bloque.match(/^event: (.+)$/m)?.[1];
          const dato = bloque.match(/^data: (.*)$/m)?.[1];
          if (!ev || dato == null) continue;
          const d = JSON.parse(dato);
          if (ev === 'inicio') {
            if (!est.conv) { est.conv = d.conversacion; cargarConversaciones(); }
            if (d.mensajeUsuario && mu) { mu.id = d.mensajeUsuario; cont.querySelectorAll('.msg.user:not([data-id]), .msg.user[data-id=""]').forEach(n => { n.dataset.id = d.mensajeUsuario; }); }
          } else if (ev === 'estado') {
            ponerEstado(d.texto);
          } else if (ev === 'fuentes') {
            ma.meta.fuentes = d.fuentes; ma.meta.fallos = d.fallos;
            ponerEstado(d.fuentes.length ? `${d.fuentes.length} resultados · redactando…` : 'Sin resultados · respondiendo…');
            repintar();
          } else if (ev === 'razonamiento') {
            ma.meta.razonamiento = (ma.meta.razonamiento || '') + d.t;
            ponerEstado('Razonando…');
            repintar();
          } else if (ev === 'texto') {
            if (!ma.contenido) ponerEstado('');
            ma.contenido += d.t;
            repintar();
          } else if (ev === 'fin') {
            ma.id = d.id;
            Object.assign(ma.meta, d);
            nodo.dataset.id = d.id;
          } else if (ev === 'combinacion') {
            ma.meta.combinacion = { respuestas: d.modelos.map(m => ({ modelo: m, texto: '', escribiendo: true })), mostrar: d.mostrar };
            repintar();
          } else if (ev === 'parcial') {
            const rr = ma.meta.combinacion?.respuestas[d.i];
            if (rr) { rr.texto += d.t; repintar(); }
          } else if (ev === 'parcial_fin') {
            const rr = ma.meta.combinacion?.respuestas[d.i];
            if (rr) { rr.escribiendo = false; rr.modelo = d.modelo; if (d.error) rr.error = d.error; repintar(); }
          } else if (ev === 'verificar') {
            verificarLuego = d;
          } else if (ev === 'verificacion') {
            ma.meta.verificacion = d.verificacion;
            ponerEstado('');
          } else if (ev === 'error') {
            ma.error = d.mensaje;
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') ma.error = err.message === 'Failed to fetch' ? 'Se perdió la conexión con laboratorio.ia.' : err.message;
      else if (!ma.contenido) ma.error = 'Detenido.';
    } finally {
      est.enviando = null;
      avisarFin(ma, contenido);
      botonEnviar(false);
      ponerEstado('');
      if (!ma.meta.imagenes) nodo.querySelector('.imagenes').innerHTML = '';
      actualizarMensaje(nodo, ma, true);
      seguir();
      cargarConversaciones();
      refrescarUsoDemo();
      // En la nube la verificación va en otra petición (límite de subpeticiones de Cloudflare).
      if (verificarLuego && ma.id) {
        ponerEstado(verificarLuego.completa ? 'Verificando citas, enlaces y afirmaciones…' : 'Verificando citas y enlaces…');
        try {
          const { verificacion } = await api(`/api/mensajes/${ma.id}/verificar`, { metodo: 'POST', cuerpo: { completa: verificarLuego.completa } });
          ma.meta.verificacion = verificacion;
        } catch (err) { ma.meta.verificacion = { error: err.message }; }
        ponerEstado('');
        actualizarMensaje(nodo, ma, true);
      }
    }
  }

  // Aviso del sistema cuando termina una respuesta y la app no está a la vista.
  function avisarFin(m, pregunta) {
    if (!document.hidden || !app?.notificar) return;
    const sk = est.skills.find(s => s.id === m.meta.skill);
    const titulo = m.error ? 'laboratorio.ia · error' : m.meta.imagenes ? 'laboratorio.ia · imagen lista' : m.meta.fuentes ? `laboratorio.ia · investigación lista (${m.meta.fuentes.length} fuentes)` : `laboratorio.ia · ${sk ? sk.nombre : 'respuesta lista'}`;
    const plano = (m.error || m.contenido || m.meta.prompt || pregunta || '').replace(/[#*_`>|[\]]/g, '').replace(/\s+/g, ' ').trim();
    app.notificar(titulo, plano.slice(0, 240) || 'Toca para verla');
  }

  let pegado = true;
  $('#mensajes').addEventListener('scroll', () => {
    const c = $('#mensajes');
    pegado = c.scrollHeight - c.scrollTop - c.clientHeight < 80;
  });
  function seguir(forzar) {
    const c = $('#mensajes');
    if (forzar || pegado) c.scrollTop = c.scrollHeight;
  }

  // ── Hoja inferior ────────────────────────────────────────────────────────
  function abrirHoja(titulo, html, alAbrir, completa) {
    $('#hoja-titulo').textContent = titulo;
    $('#hoja-cuerpo').innerHTML = html;
    $('#hoja').classList.toggle('completa', Boolean(completa));
    $('#hoja').hidden = false;
    $('#hoja-velo').hidden = false;
    // Se reemplaza el cuerpo para soltar los oyentes de la hoja anterior.
    const viejo = $('#hoja-cuerpo');
    const nuevo = viejo.cloneNode(true);
    viejo.replaceWith(nuevo);
    alAbrir?.(nuevo);
  }
  function cerrarHoja() { $('#hoja').hidden = true; $('#hoja-velo').hidden = true; }
  $('#hoja-velo').addEventListener('click', cerrarHoja);

  function hojaSkills() {
    const porCat = {};
    for (const s of est.skills) (porCat[s.categoria] ||= []).push(s);
    let html = '';
    for (const [cat, lista] of Object.entries(porCat)) {
      html += `<div class="cat-skill">${esc(cat)}</div>`;
      html += lista.map(s => `<button class="opcion${s.id === prefs.skill ? ' activa' : ''}" data-skill="${s.id}">
        <span class="ic">${esc(s.icono)}</span>
        <span class="txt"><span class="nm">${esc(s.nombre)}</span><span class="ds">${esc(s.descripcion)}</span></span>
        ${s.modo !== 'chat' ? `<span class="tag-modo ${s.modo}">${MODOS[s.modo]}</span>` : ''}</button>`).join('');
    }
    if (!est.demo) html += '<div class="fila-botones"><button class="btn" data-op="gestionar">◇ Gestionar skills</button><button class="btn" data-op="nueva">＋ Nueva skill</button></div>';
    abrirHoja('Skills', html, cuerpo => cuerpo.addEventListener('click', e => {
      const s = e.target.closest('[data-skill]');
      if (s) { aplicarSkill(s.dataset.skill); cerrarHoja(); return; }
      const op = e.target.closest('[data-op]')?.dataset.op;
      if (op === 'gestionar') gestorSkills();
      if (op === 'nueva') editorSkill();
    }), true);
  }

  function gestorSkills() {
    const html = est.skills.map(s => `<button class="opcion" data-ver="${s.id}">
      <span class="ic">${esc(s.icono)}</span>
      <span class="txt"><span class="nm">${esc(s.nombre)}${s.propia ? ' <small class="tenue">· tuya</small>' : ''}</span><span class="ds">${esc(s.categoria)} · ${MODOS[s.modo]}${s.fuentes.length ? ' · ' + s.fuentes.length + ' fuentes' : ''}</span></span></button>`).join('')
      + '<div class="fila-botones"><button class="btn primario" data-op="nueva">＋ Nueva skill</button></div>';
    abrirHoja(`Skills · ${est.skills.length}`, html, cuerpo => cuerpo.addEventListener('click', e => {
      const v = e.target.closest('[data-ver]');
      if (v) verSkill(v.dataset.ver);
      if (e.target.closest('[data-op="nueva"]')) editorSkill();
    }), true);
  }

  function verSkill(id) {
    const s = est.skills.find(x => x.id === id);
    const fuentes = s.fuentes.map(f => est.fuentes.find(x => x.id === f)?.nombre || f).join(', ');
    abrirHoja(s.nombre, `
      <p style="font-size:40px;margin:4px 0">${esc(s.icono)}</p>
      <p>${esc(s.descripcion)}</p>
      <p class="tenue" style="font-size:13px">${esc(s.categoria)} · modo ${MODOS[s.modo]}${fuentes ? ' · ' + esc(fuentes) : ''}${s.referencias?.length ? ' · ' + s.referencias.length + ' referencias' : ''}</p>
      <div class="instrucciones-skill">${esc(s.instrucciones)}</div>
      <div class="fila-botones">
        <button class="btn primario" data-op="usar">Usar</button>
        <button class="btn" data-op="editar">${s.propia ? 'Editar' : 'Duplicar y editar'}</button>
        ${s.propia ? '<button class="btn" data-op="borrar" style="color:var(--rojo)">Borrar</button>' : ''}
      </div>`, cuerpo => cuerpo.addEventListener('click', async e => {
      const op = e.target.closest('[data-op]')?.dataset.op;
      if (op === 'usar') { aplicarSkill(s.id); cerrarHoja(); }
      if (op === 'editar') editorSkill(s.propia ? s : { ...s, id: '', nombre: `${s.nombre} (mía)` });
      if (op === 'borrar' && confirm(`¿Borrar la skill «${s.nombre}»?`)) {
        await api(`/api/skills/${s.id}`, { metodo: 'DELETE' });
        est.skills = await api('/api/skills');
        if (prefs.skill === s.id) aplicarSkill(est.skills[0].id);
        gestorSkills();
      }
    }), true);
  }

  function editorSkill(base = {}) {
    const marcadas = new Set(base.fuentes || []);
    const html = `
      <div class="panel">
        <h3>Crear con IA</h3>
        <p class="tenue" style="font-size:13px;margin:0 0 8px">Describe qué quieres que haga y la IA rellena el formulario.</p>
        <textarea id="sk-idea" rows="3" style="width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--linea2);background:var(--sup)" placeholder="Ej.: un experto en microbiología de suelos que busque en PubMed y Europe PMC"></textarea>
        <div class="fila-botones"><button class="btn rojo chico" data-op="generar">✦ Generar</button></div>
      </div>
      <div class="dos">
        <label class="campo"><span>Nombre</span><input id="sk-nombre" value="${esc(base.nombre || '')}" required></label>
        <label class="campo"><span>Icono</span><input id="sk-icono" value="${esc(base.icono || '◇')}" maxlength="4"></label>
      </div>
      <label class="campo"><span>Descripción</span><input id="sk-desc" value="${esc(base.descripcion || '')}" placeholder="Cuándo usarla"></label>
      <div class="dos">
        <label class="campo"><span>Modo</span><select id="sk-modo">${Object.entries(MODOS).map(([k, v]) => `<option value="${k}"${(base.modo || 'chat') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="campo"><span>Categoría</span><input id="sk-cat" value="${esc(base.categoria && !base.propia && base.id ? base.categoria : base.categoria || 'Mis skills')}"></label>
      </div>
      <div class="campo"><span>Fuentes (modo investigar)</span>
        <div>${est.fuentes.map(f => `<label class="casilla"><input type="checkbox" value="${f.id}"${marcadas.has(f.id) ? ' checked' : ''}><span>${esc(f.nombre)}<small>${esc(f.area)}</small></span></label>`).join('')}</div>
      </div>
      <label class="campo"><span>Instrucciones (Markdown)</span><textarea id="sk-inst" placeholder="Rol, proceso, formato de respuesta, límites…">${esc(base.instrucciones || '')}</textarea></label>
      <p id="sk-error" class="error"></p>
      <div class="fila-botones"><button class="btn primario" data-op="guardar">Guardar skill</button><button class="btn" data-op="cancelar">Cancelar</button></div>`;
    abrirHoja(base.propia ? 'Editar skill' : 'Nueva skill', html, cuerpo => cuerpo.addEventListener('click', async e => {
      const op = e.target.closest('[data-op]')?.dataset.op;
      const q = s => cuerpo.querySelector(s);
      if (op === 'cancelar') cerrarHoja();
      if (op === 'generar') {
        const idea = q('#sk-idea').value.trim();
        if (!idea) return;
        const b = e.target.closest('button');
        b.disabled = true; b.textContent = 'Generando…';
        try {
          const { skill } = await api('/api/skills/generar', { metodo: 'POST', cuerpo: { descripcion: idea } });
          q('#sk-nombre').value = skill.nombre || '';
          q('#sk-icono').value = skill.icono || '◇';
          q('#sk-desc').value = skill.descripcion || '';
          q('#sk-modo').value = MODOS[skill.modo] ? skill.modo : 'chat';
          q('#sk-cat').value = skill.categoria || 'Mis skills';
          q('#sk-inst').value = skill.instrucciones || '';
          const ids = new Set(skill.fuentes || []);
          cuerpo.querySelectorAll('.casilla input').forEach(i => { i.checked = ids.has(i.value); });
          aviso('Revisa y guarda');
        } catch (err) { q('#sk-error').textContent = err.message; }
        b.disabled = false; b.textContent = '✦ Generar';
      }
      if (op === 'guardar') {
        const datos = {
          id: base.propia ? base.id : undefined,
          nombre: q('#sk-nombre').value.trim(),
          icono: q('#sk-icono').value.trim(),
          descripcion: q('#sk-desc').value.trim(),
          modo: q('#sk-modo').value,
          categoria: q('#sk-cat').value.trim(),
          fuentes: [...cuerpo.querySelectorAll('.casilla input:checked')].map(i => i.value),
          instrucciones: q('#sk-inst').value,
        };
        try {
          const s = await api('/api/skills', { metodo: 'POST', cuerpo: datos });
          est.skills = await api('/api/skills');
          aplicarSkill(s.id);
          cerrarHoja();
          aviso(`Skill «${s.nombre}» guardada`);
        } catch (err) { q('#sk-error').textContent = err.message; }
      }
    }), true);
  }

  function hojaFuentes() {
    const activas = new Set(fuentesActivas());
    const s = skillActual();
    const leer = prefs.leer ?? Boolean(s?.leer);
    const completa = (prefs.verificacion || s?.verificacion) === 'completa';
    const html = `<div class="panel" style="margin-top:0">
        <h3>Navegación y verificación</h3>
        <label class="casilla"><input type="checkbox" data-opt="leer"${leer ? ' checked' : ''}><span>Abrir y leer las páginas<small>Lee el texto de los 5 mejores resultados, no solo el resumen. Más preciso, ~15 s más.</small></span></label>
        <label class="casilla"><input type="checkbox" data-opt="completa"${completa ? ' checked' : ''}><span>Revisar cada afirmación con IA<small>Además de citas, enlaces y DOI (siempre), comprueba que cada afirmación esté en su fuente.</small></span></label>
      </div>`
      + est.fuentes.map(f => `<label class="casilla"><input type="checkbox" value="${f.id}"${activas.has(f.id) ? ' checked' : ''}><span>${esc(f.nombre)}<small>${esc(f.area)}</small></span></label>`).join('')
      + '<div class="fila-botones"><button class="btn primario" data-op="listo">Listo</button><button class="btn" data-op="skill">Las de la skill</button></div>';
    abrirHoja('Fuentes', html, cuerpo => {
      cuerpo.addEventListener('change', e => {
        const opt = e.target.dataset.opt;
        if (opt === 'leer') { prefs.leer = e.target.checked; guardarPrefs(); return; }
        if (opt === 'completa') { prefs.verificacion = e.target.checked ? 'completa' : 'basica'; guardarPrefs(); return; }
        prefs.fuentes = [...cuerpo.querySelectorAll('input[value]:checked')].map(i => i.value);
        if (!prefs.fuentes.length) prefs.fuentes = null;
        guardarPrefs(); pintarChips();
      });
      cuerpo.addEventListener('click', e => {
        const op = e.target.closest('[data-op]')?.dataset.op;
        if (op === 'listo') cerrarHoja();
        if (op === 'skill') { prefs.fuentes = null; prefs.leer = null; prefs.verificacion = null; guardarPrefs(); pintarChips(); hojaFuentes(); }
      });
    });
  }

  function hojaTamano() {
    const est_ = estiloActual();
    const html = `<div class="cat-skill" style="margin-top:4px">Estilo</div>
      ${Object.entries(ESTILOS).map(([k, [ic, nm, ds]]) => `<button class="opcion${est_ === k ? ' activa' : ''}" data-estilo="${k}"><span class="ic">${ic}</span><span class="txt"><span class="nm">${nm}</span><span class="ds">${ds}</span></span></button>`).join('')}
      <div class="cat-skill">Calidad</div>
      <button class="opcion${prefs.calidad !== 'alta' ? ' activa' : ''}" data-calidad="rapida"><span class="ic">⚡</span><span class="txt"><span class="nm">Rápida</span><span class="ds">FLUX.1 schnell: segundos, gasta poca cuota</span></span></button>
      <button class="opcion${prefs.calidad === 'alta' ? ' activa' : ''}" data-calidad="alta"><span class="ic">◆</span><span class="txt"><span class="nm">Alta (profesional)</span><span class="ds">Leonardo Lucid Origin / FLUX.2 dev: más detalle y realismo, gasta más cuota</span></span></button>
      <button class="opcion${prefs.calidad === 'premium' ? ' activa' : ''}" data-calidad="premium"><span class="ic">★</span><span class="txt"><span class="nm">De pago (opcional)</span><span class="ds">Nano Banana (Gemini, ~0,04 US$) o GPT Image (OpenAI) con tu clave. Lo mejor para figuras científicas y texto preciso.</span></span></button>
      <div class="cat-skill">Tamaño</div>
      ${Object.entries(TAMANOS).map(([k, v]) => `<button class="opcion${prefs.tamano === k ? ' activa' : ''}" data-t="${k}"><span class="ic">${k === 'cuadrado' ? '◻' : k === 'vertical' ? '▯' : '▭'}</span><span class="txt"><span class="nm">${v}</span></span></button>`).join('')}
      <div class="fila-botones"><button class="btn primario" data-op="listo">Listo</button></div>`;
    abrirHoja('Imagen', html, cuerpo => cuerpo.addEventListener('click', e => {
      const b = e.target.closest('[data-estilo],[data-calidad],[data-t],[data-op]');
      if (!b) return;
      if (b.dataset.estilo) prefs.estilo = b.dataset.estilo;
      if (b.dataset.calidad) prefs.calidad = b.dataset.calidad;
      if (b.dataset.t) prefs.tamano = b.dataset.t;
      guardarPrefs(); pintarChips();
      if (b.dataset.op === 'listo') cerrarHoja(); else hojaTamano();
    }), true);
  }

  async function hojaModelo() {
    const imagen = prefs.modo === 'imagen';
    if (!est.modelos.texto.length) await cargarModelos();
    const lista = imagen ? est.modelos.imagen : [{ id: 'auto', nombre: 'Automático (FreeLLMAPI elige)' }, ...est.modelos.texto.filter(m => m.id !== 'auto')];
    const actual = imagen ? prefs.modeloImagen : prefs.modeloTexto;
    const fila = m => `<button class="opcion${m.id === actual ? ' activa' : ''}" data-m="${esc(m.id)}"><span class="txt"><span class="nm">${esc(m.nombre)}</span><span class="ds">${esc(m.id)}${m.contexto ? ' · ' + Math.round(m.contexto / 1000) + 'k contexto' : ''}</span></span>${m.id === actual ? '<span class="marca-ok">●</span>' : ''}</button>`;
    const html = `<p class="tenue" style="font-size:13px;margin:0 0 8px">«Automático» usa el modelo asignado a la tarea en Ajustes → Modelos y proveedores.</p>
      ${imagen ? '' : '<input class="buscar" id="filtro-modelo" type="search" placeholder="Buscar modelo" style="margin-bottom:8px">'}
      <div id="lista-modelos">${lista.map(fila).join('')}</div>
      ${est.modelos.error ? `<p class="error">${esc(est.modelos.error)}</p>` : ''}`;
    abrirHoja(imagen ? 'Modelo de imagen' : `Modelo de texto · ${lista.length}`, html, cuerpo => {
      cuerpo.addEventListener('click', e => {
        const m = e.target.closest('[data-m]');
        if (!m) return;
        if (imagen) prefs.modeloImagen = m.dataset.m; else prefs.modeloTexto = m.dataset.m;
        guardarPrefs(); pintarChips(); cerrarHoja();
      });
      cuerpo.querySelector('#filtro-modelo')?.addEventListener('input', e => {
        const f = e.target.value.toLowerCase();
        cuerpo.querySelector('#lista-modelos').innerHTML = lista.filter(m => (m.id + m.nombre).toLowerCase().includes(f)).map(fila).join('');
      });
    }, !imagen);
  }

  function qrSvg(texto) {
    if (typeof qrcode !== 'function') return '';
    const q = qrcode(0, 'M');
    q.addData(texto);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }

  async function hojaAjustes() {
    let e;
    try { e = await api('/api/estado'); } catch { return; }
    const wifi = (e.direcciones || []).filter(d => d.tipo !== 'Datos móviles');
    const conexion = e.local ? `
      <div class="panel">
        <h3>Usar desde otros equipos</h3>
        ${wifi.length ? `<p class="tenue" style="font-size:13px;margin:0 0 6px">Conecta el otro equipo a la misma Wi-Fi (o al punto de acceso de este teléfono) y abre:</p>
          ${wifi.map(d => `<div class="direccion"><small>${esc(d.tipo)}</small><code>${esc(d.url)}</code></div>`).join('')}
          <div class="qr">${qrSvg(wifi[0].url)}</div>
          <p class="tenue" style="font-size:13px;margin:6px 0 0">Para instalar la app en otro teléfono: <code>${esc(wifi[0].url)}/descargar</code></p>`
          : '<p class="tenue" style="font-size:13px">Este teléfono no está en una red Wi-Fi ni compartiendo punto de acceso. Conéctalo a una Wi-Fi para usar laboratorio.ia desde otros equipos.</p>'}
        <p style="margin:10px 0 0">PIN: <span class="pin-grande">${esc(e.pin)}</span></p>
        <div class="fila-botones"><button class="btn chico" data-op="nuevo-pin">Cambiar PIN y cerrar sesiones</button></div>
      </div>` : '<div class="panel"><h3>Conexión</h3><p class="tenue" style="font-size:13px;margin:0">Estás conectado desde otro equipo de la red.</p></div>';
    let cuenta = '';
    if (e.nube) {
      let c = {};
      try { c = await api('/api/cuenta'); } catch { /* sin sesión */ }
      const base = `${location.origin}/v1`;
      cuenta = `<div class="panel">
        <h3>Tu cuenta</h3>
        <p style="margin:0 0 8px">${esc(c.email || '')}${c.rol === 'admin' ? ' · <span class="tenue">administrador</span>' : ''}</p>
        ${c.rol === 'admin' ? `<label class="casilla"><input type="checkbox" id="registro-abierto"${c.registroAbierto ? ' checked' : ''}><span>Permitir que otras personas creen cuenta<small>Cada una tendrá sus conversaciones, claves y skills. Comparten las neuronas gratis de Workers AI de tu Cloudflare.</small></span></label>` : ''}
        <div class="fila-botones"><button class="btn chico" data-op="salir">Cerrar sesión</button></div>
      </div>
      <div class="panel">
        <h3>Tu clave de API (compatible con OpenAI)</h3>
        <p class="tenue" style="font-size:13px;margin:0 0 8px">Usa tus modelos de laboratorio.ia desde Codex, Cline, el SDK de OpenAI o cualquier programa compatible.</p>
        <div class="clave-api"><code id="clave-api" data-clave="${esc(c.clave || '')}">${esc(c.clave ? c.clave.slice(0, 12) + '…' : '')}</code><button class="btn chico" data-op="ver-clave">Ver</button><button class="btn chico" data-op="copiar-clave">Copiar</button></div>
        <pre class="codigo-uso">base_url = ${esc(base)}
api_key  = labia-…
model    = auto   (o cualquier id de /v1/models)

curl ${esc(base)}/chat/completions \
  -H "Authorization: Bearer labia-…" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hola"}]}'</pre>
        <div class="fila-botones"><button class="btn chico" data-op="nueva-clave">Generar otra clave</button></div>
      </div>`;
    }
    let termux = '';
    if (app?.permisos && e.local) {
      let p = {};
      try { p = JSON.parse(app.permisos()); } catch { /* puente antiguo */ }
      const fila = (ok, txt) => `<p style="margin:4px 0"><span style="color:var(${ok ? '--verde' : '--rojo'})">●</span> ${txt}</p>`;
      termux = `<div class="panel">
        <h3>Termux y permisos</h3>
        ${fila(p.termuxInstalado, p.termuxInstalado ? 'Termux instalado' : 'Termux no está instalado')}
        ${fila(p.termux, p.termux ? 'Puede controlar el servidor en Termux' : 'Sin permiso para usar Termux')}
        ${fila(p.notificaciones, p.notificaciones ? 'Notificaciones activas' : 'Notificaciones desactivadas')}
        ${!p.termux || !p.notificaciones ? '<div class="fila-botones"><button class="btn chico rojo" data-op="permisos">Activar permisos</button><button class="btn chico" data-op="ajustes-app">Ajustes de Android</button></div>' : ''}
        <div class="fila-botones">
          <button class="btn chico" data-op="t-reiniciar">↻ Reiniciar servidor</button>
          <button class="btn chico" data-op="t-detener">■ Apagar</button>
          <button class="btn chico" data-op="registro">Ver registro</button>
          <button class="btn chico" data-op="abrir-termux">Abrir Termux</button>
        </div>
        <pre id="registro" class="instrucciones-skill" hidden></pre>
      </div>`;
    }
    const proyecto = `<div class="panel donar">
        <h3>laboratorio.ia es libre</h3>
        <p style="font-size:14px;margin:4px 0">Si te sirve, dale una ★ en GitHub y compártelo.</p>
        <div class="fila-botones" style="justify-content:center">
          <a class="btn chico" href="${esc(e.repo || 'https://github.com/ReserchLab/lab-ia')}" target="_blank" rel="noopener">★ GitHub</a>
          <a class="btn chico" href="/descargar">Descargar APK</a>
        </div>
        <p style="font-size:13px;margin:12px 0 0">Donación en USDC (red Arbitrum, mínimo 5):</p>
        <div class="dir">0xAC43f9b0E7F0ae6386cfC8ef6BFf62CE9c3006A1</div>
        <button class="btn chico" data-op="copiar-donacion">Copiar dirección</button>
        <p style="margin:12px 0 0">¡Gracias!</p>
        <p class="firma">Hecho xhumanx + IA</p>
      </div>`;
    const panelDemo = `<div class="panel">
        <h3>Versión de prueba</h3>
        <p style="margin:0 0 6px;font-size:14px">Estás usando laboratorio.ia sin registrarte. Cada día puedes enviar ${e.limites?.chat ?? 20} mensajes y hacer ${e.limites?.investigar ?? 6} investigaciones. Tus conversaciones se borran a los 7 días.</p>
        <p class="tenue" style="font-size:13px;margin:0">En tu propio laboratorio.ia (gratis, en tu Cloudflare) no hay estos límites y tienes imágenes, memoria permanente, tus claves, modelos por tarea, tus skills y la API.</p>
        <div class="fila-botones"><a class="btn chico rojo" href="https://labia-ciencia.pages.dev" target="_blank" rel="noopener">Crear mi laboratorio.ia</a><a class="btn chico" href="/descargar">App Android</a></div>
      </div>`;
    const html = `${e.demo ? panelDemo : e.nube ? cuenta : conexion}${termux}
      <div class="panel">
        <h3>Apariencia</h3>
        <div class="selector-tema" role="radiogroup" aria-label="Tema">
          ${[['oscuro', '●', 'Noche'], ['claro', '○', 'Día'], ['sistema', '◐', 'Sistema']].map(([id, ic, nom]) => `<button role="radio" aria-checked="${prefs.tema === id}" class="opcion-tema${prefs.tema === id ? ' activa' : ''}" data-tema="${id}"><span class="muestra muestra-${id}">${ic}</span>${nom}${id === 'oscuro' ? '<small>por defecto</small>' : ''}</button>`).join('')}
        </div>
      </div>
      ${e.demo ? '' : `<div class="panel">
        <h3>Entrenar tu propio modelo</h3>
        <p class="tenue" style="font-size:13px;margin:0">Tus valoraciones ▲▼, las respuestas que regeneras, las preguntas que editas y la mejor de cada combinación de modelos se convierten en datos para ajustar un modelo con tu forma de investigar.</p>
        <div class="fila-botones"><button class="btn chico primario" data-op="entrenar">✦ Datos y modelos propios</button></div>
      </div>`}
      <div class="panel">
        <h3>Preferencias</h3>
        <label class="casilla"><input type="checkbox" id="pref-razon"${prefs.razonamiento ? ' checked' : ''}><span>Mostrar el razonamiento del modelo<small>Cuando el modelo lo envía (p. ej. DeepSeek R1, Qwen QwQ)</small></span></label>
      </div>
      ${e.demo ? '' : `<div class="panel">
        <h3>Modelos y proveedores</h3>
        <p class="tenue" style="font-size:13px;margin:0">Elige un modelo para cada tarea (investigar, código, razonamiento, imágenes…) y añade claves de proveedores con su enlace.</p>
        <div class="fila-botones"><button class="btn chico primario" data-op="modelos">◈ Configurar modelos</button><button class="btn chico" data-op="proveedores">⚿ Proveedores</button></div>
      </div>`}
      ${e.nube ? `<div class="panel">
        <h3>En la nube</h3>
        <p style="margin:0;font-size:14px"><span style="color:var(--verde)">●</span> Cloudflare Workers · Workers AI incluido (10 000 neuronas al día gratis)</p>
        ${app?.cambiarServidor ? '<div class="fila-botones"><button class="btn chico" data-op="servidor">Cambiar de servidor</button></div>' : ''}
      </div>` : `<div class="panel">
        <h3>FreeLLMAPI</h3>
        <p style="margin:0">${e.gateway ? '<span style="color:var(--verde)">●</span> En línea' : '<span style="color:var(--rojo)">●</span> No responde: ábrelo con <code>ia</code> o <code>lab</code> en Termux.'}</p>
        <p class="tenue" style="font-size:13px">Usa la misma sesión y las mismas claves que <code>ia</code> en Termux.</p>
        ${app?.cambiarServidor ? '<div class="fila-botones"><button class="btn chico" data-op="servidor">Cambiar de servidor</button></div>' : ''}
      </div>`}
      ${proyecto}
      <p class="tenue" style="font: 12px var(--mono); text-align:center">LABORATORIO.IA ${esc(e.version)} · ${est.skills.length} skills · ${est.fuentes.length} fuentes</p>`;
    abrirHoja('Ajustes', html, cuerpo => {
      cuerpo.addEventListener('change', async ev => {
        if (ev.target.id === 'pref-razon') { prefs.razonamiento = ev.target.checked; guardarPrefs(); }
        if (ev.target.id === 'registro-abierto') {
          await api('/api/cuenta/registro-abierto', { metodo: 'PUT', cuerpo: { abierto: ev.target.checked } });
          aviso(ev.target.checked ? 'Registro abierto' : 'Registro cerrado');
        }
      });
      cuerpo.addEventListener('click', async ev => {
        const op = ev.target.closest('[data-op]')?.dataset.op;
        if (op === 'nuevo-pin' && confirm('Los demás equipos tendrán que escribir el PIN nuevo. ¿Continuar?')) {
          await api('/api/sesiones', { metodo: 'DELETE' });
          hojaAjustes();
        }
        if (op === 'servidor') app.cambiarServidor();
        if (op === 'modelos') hojaModelosTareas();
        if (op === 'entrenar') hojaEntrenamiento();
        const tm = ev.target.closest('[data-tema]')?.dataset.tema;
        if (tm) {
          prefs.tema = tm;
          guardarPrefs();
          aplicarTema();
          cuerpo.querySelectorAll('[data-tema]').forEach(b => { b.classList.toggle('activa', b.dataset.tema === tm); b.setAttribute('aria-checked', b.dataset.tema === tm); });
        }
        if (op === 'salir') { await api('/api/cuenta/salir', { metodo: 'POST' }); location.reload(); }
        if (op === 'ver-clave') { const c = cuerpo.querySelector('#clave-api'); c.textContent = c.textContent.endsWith('…') ? c.dataset.clave : c.dataset.clave.slice(0, 12) + '…'; }
        if (op === 'copiar-clave') copiar(cuerpo.querySelector('#clave-api').dataset.clave);
        if (op === 'copiar-donacion') copiar('0xAC43f9b0E7F0ae6386cfC8ef6BFf62CE9c3006A1');
        if (op === 'nueva-clave' && confirm('La clave actual dejará de funcionar en los programas que la usen. ¿Generar otra?')) {
          const { clave } = await api('/api/cuenta/clave', { metodo: 'POST' });
          const c = cuerpo.querySelector('#clave-api');
          c.dataset.clave = clave;
          c.textContent = clave;
          aviso('Clave nueva generada');
        }
        if (op === 'proveedores') hojaProveedores();
        if (op === 'permisos') app.pedirPermisos();
        if (op === 'ajustes-app') app.ajustesApp();
        if (op === 'abrir-termux') app.abrirTermux();
        if (op === 't-reiniciar' && confirm('¿Reiniciar el servidor de laboratorio.ia? Tarda unos segundos.')) app.termux('reiniciar');
        if (op === 't-detener' && confirm('¿Apagar el servidor? Podrás encenderlo desde la app o con «lab» en Termux.')) app.termux('detener');
        if (op === 'registro') {
          const pre = cuerpo.querySelector('#registro');
          pre.hidden = false;
          pre.textContent = 'Cargando…';
          try {
            const r = await api('/api/registro');
            pre.textContent = `── laboratorio.ia ──\n${r.lab}\n\n── FreeLLMAPI ──\n${r.freellmapi}`;
            pre.scrollTop = pre.scrollHeight;
          } catch (err) { pre.textContent = err.message; }
        }
      });
    }, true);
  }

  // ── Entrenamiento: datos y modelos propios ───────────────────────────────
  const COLAB = 'https://colab.research.google.com/github/ReserchLab/lab-ia/blob/main/herramientas/entrenar/entrenar.ipynb';

  function descargarArchivo(ruta) {
    const url = new URL(ruta, location.href).href;
    if (app?.descargar) { app.descargar(url); return; }
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function hojaEntrenamiento() {
    abrirHoja('Entrenar tu modelo', '<p class="tenue">Contando tus datos…</p>', null, true);
    let d, loras = null, auto = null;
    try {
      d = await api('/api/entrenamiento');
      if (est.estadoServidor?.nube && !est.estadoServidor?.demo) {
        [loras, auto] = await Promise.all([
          api('/api/entrenamiento/modelos').then(r => r.modelos, () => []),
          api('/api/entrenamiento/auto').catch(() => null),
        ]);
      }
    } catch (err) { $('#hoja-cuerpo').innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
    const cifra = (n, t) => `<div class="cifra"><b>${n}</b><small>${t}</small></div>`;
    const archivo = (id, nombre, n, desc) => `<button class="fila-archivo" data-bajar="${id}"${n ? '' : ' disabled'}><span><b>${nombre}</b><small>${desc}</small></span><code>${n}</code></button>`;
    const html = `
      <p class="tenue" style="font-size:13px;margin:0 0 10px">Todo se queda en tu laboratorio.ia hasta que tú lo descargas. Nada se envía a otros servicios.</p>
      <div class="cifras">
        ${cifra(d.respuestas, 'respuestas')}${cifra(d.buenas, '▲ buenas')}${cifra(d.malas, '▼ malas')}
        ${cifra(d.descartadas, 'regeneradas')}${cifra(d.ediciones, 'editadas')}${cifra(d.sinteticos || 0, 'generadas')}
      </div>
      ${auto ? `<div class="panel panel-auto" id="panel-auto">${htmlAuto(auto)}</div>` : ''}
      <div class="panel">
        <h3>1 · Descarga tus datos (JSONL)</h3>
        ${archivo('sft', 'Ajuste supervisado (SFT)', d.sft, 'Todas tus respuestas salvo las ▼, con su contexto y fuentes')}
        ${archivo('sft-valoradas', 'SFT solo ▲', d.sftValoradas, 'Solo las que marcaste como buenas: menos, pero mejores')}
        ${archivo('dpo', 'Preferencias (DPO)', d.dpo, 'Pares mejor/peor: regeneradas, combinaciones y tu elección ★')}
        ${archivo('senales', 'Señales en crudo', d.senales, 'Ediciones, valoraciones y verificación, para analizar')}
        <p class="tenue" style="font-size:12px;margin:8px 0 0">Formato de chat de OpenAI / Hugging Face: sirve para Unsloth, TRL, Axolotl, AutoTrain o el ajuste fino de OpenAI. Mínimo útil: ~50 ejemplos SFT o ~30 pares DPO.</p>
      </div>
      <div class="panel">
        <h3>2 · Entrena gratis en Google Colab</h3>
        <p style="font-size:14px;margin:0 0 6px">El cuaderno sube tu archivo, entrena un adaptador LoRA sobre ${esc(d.bases[0].nombre)} (o Mistral 7B, Gemma) en la GPU gratuita y lo sube a tu Cloudflare.</p>
        <div class="fila-botones"><a class="btn chico rojo" href="${COLAB}" target="_blank" rel="noopener">▶ Abrir cuaderno en Colab</a><a class="btn chico" href="https://github.com/ReserchLab/lab-ia/blob/main/herramientas/entrenar/LEEME.md" target="_blank" rel="noopener">Guía paso a paso</a></div>
      </div>
      ${loras ? `<div class="panel">
        <h3>3 · Usa tu modelo aquí</h3>
        <p class="tenue" style="font-size:13px;margin:0 0 8px">Cuando el cuaderno termine, escribe el nombre del ajuste fino. Aparecerá como ★ en el selector de modelos y podrás combinarlo con los demás.</p>
        <div id="mis-loras">${loras.length ? loras.map(l => `<div class="fila-archivo"><span><b>★ ${esc(l.etiqueta)}</b><small>${esc(l.lora)} · ${esc(l.base)}</small></span><button class="btn chico" data-quitar-lora="${esc(l.lora)}">Quitar</button></div>`).join('') : '<p class="tenue" style="font-size:13px">Aún no tienes modelos propios.</p>'}</div>
        <form id="form-lora" class="campo" style="display:grid;gap:8px;margin-top:10px">
          <select id="lora-base">${d.bases.map(b => `<option value="${esc(b.id)}">${esc(b.nombre)} — ${esc(b.nota)}</option>`).join('')}</select>
          <input id="lora-nombre" placeholder="nombre del ajuste fino (p. ej. mi-lab-v1)" required pattern="[\w.-]{1,80}">
          <input id="lora-etiqueta" placeholder="nombre visible (opcional)">
          <button class="btn chico primario" type="submit">Añadir y probar</button>
          <p id="lora-res" class="tenue" style="font-size:13px;margin:0"></p>
        </form>
      </div>` : `<div class="panel"><h3>3 · Úsalo</h3><p class="tenue" style="font-size:13px;margin:0">En tu laboratorio.ia de Cloudflare el modelo entrenado se añade aquí mismo. En el teléfono, cárgalo en Ollama o LM Studio con el adaptador que descarga el cuaderno.</p></div>`}`;
    $('#hoja-cuerpo').innerHTML = html;
    const cuerpo = $('#hoja-cuerpo');
    // Progreso en vivo mientras la hoja esté abierta.
    clearInterval(est.relojAuto);
    if (auto) {
      est.relojAuto = setInterval(async () => {
        const panel = document.getElementById('panel-auto');
        if (!panel || $('#hoja').hidden) { clearInterval(est.relojAuto); return; }
        if (panel.querySelector('form :focus')) return; // no borrar lo que el usuario escribe
        try { panel.innerHTML = htmlAuto(await api('/api/entrenamiento/auto')); } catch { /* reintenta en el siguiente */ }
      }, 8000);
    }
    cuerpo.onsubmit = async ev => {
      if (ev.target.id !== 'form-auto') return;
      ev.preventDefault();
      const f = ev.target;
      const boton = f.querySelector('button[type=submit]');
      boton.disabled = true;
      boton.textContent = 'Empezando…';
      try {
        const r = await api('/api/entrenamiento/auto', { metodo: 'POST', cuerpo: {
          objetivo: Number(f.querySelector('#auto-objetivo').value), temas: f.querySelector('#auto-temas').value,
          base: f.querySelector('#auto-base').value, nombre: f.querySelector('#auto-nombre').value, epocas: 2,
        } });
        document.getElementById('panel-auto').innerHTML = htmlAuto({ ...auto, trabajo: r.trabajo });
        aviso('Entrenamiento en marcha. Puedes cerrar la app: sigue en tu nube.', 4000);
      } catch (err) { aviso(err.message, 5000); boton.disabled = false; boton.textContent = '✦ Entrenar automáticamente'; }
    };
    cuerpo.onclick = async ev => {
      if (ev.target.closest('[data-auto="cancelar"]') && confirm('¿Cancelar el entrenamiento? Los ejemplos ya generados se conservan.')) {
        const r = await api('/api/entrenamiento/auto', { metodo: 'DELETE' });
        document.getElementById('panel-auto').innerHTML = htmlAuto({ ...auto, trabajo: r.trabajo });
      }
      if (ev.target.closest('[data-auto="nuevo"]')) { auto.trabajo = null; document.getElementById('panel-auto').innerHTML = htmlAuto(auto); }
      if (ev.target.closest('[data-auto="usar"]')) { cargarModelos(); cerrarHoja(); hojaModelo(); }
      if (ev.target.closest('[data-auto="proveedores"]')) hojaProveedores();
      const b = ev.target.closest('[data-bajar]');
      if (b) { descargarArchivo(`/api/entrenamiento/${b.dataset.bajar}.jsonl`); aviso('Descargando…'); }
      const q = ev.target.closest('[data-quitar-lora]');
      if (q && confirm('¿Quitar este modelo de laboratorio.ia? (El ajuste fino sigue en tu Cloudflare.)')) {
        await api(`/api/entrenamiento/modelos/${encodeURIComponent(q.dataset.quitarLora)}`, { metodo: 'DELETE' });
        cargarModelos();
        hojaEntrenamiento();
      }
    };
    cuerpo.querySelector('#form-lora')?.addEventListener('submit', async ev => {
      ev.preventDefault();
      const res = cuerpo.querySelector('#lora-res');
      res.textContent = 'Guardando y probando el modelo…';
      try {
        const r = await api('/api/entrenamiento/modelos', { metodo: 'POST', cuerpo: { base: cuerpo.querySelector('#lora-base').value, lora: cuerpo.querySelector('#lora-nombre').value.trim(), etiqueta: cuerpo.querySelector('#lora-etiqueta').value } });
        cargarModelos();
        aviso(r.prueba?.ok ? 'Tu modelo responde ✓' : 'Guardado, pero aún no responde');
        await hojaEntrenamiento();
        if (!r.prueba?.ok) $('#hoja-cuerpo').insertAdjacentHTML('afterbegin', `<p class="error">Workers AI no encontró o no pudo usar ese ajuste fino: ${esc(r.prueba?.error || '')}. Comprueba el nombre con «npx wrangler ai finetune list».</p>`);
      } catch (err) { res.textContent = err.message; }
    });
  }

  const FASES = [['destilando', 'Generando datos'], ['lanzar', 'Enviando a Kaggle'], ['entrenando', 'Entrenando en GPU'], ['subiendo', 'Subiendo a Workers AI'], ['listo', 'Listo']];

  const duracion = ms => (ms < 3600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : `${Math.round(ms / 360_000) / 10} h`);

  /** Panel del entrenamiento automático: formulario o progreso del trabajo actual. */
  function htmlAuto(a) {
    const t = a.trabajo;
    const activo = t && ['destilando', 'lanzar', 'entrenando', 'subiendo'].includes(t.fase);
    if (t && (activo || t.fase === 'listo' || t.fase === 'error' || t.fase === 'cancelado')) {
      const i = FASES.findIndex(f => f[0] === t.fase);
      const pct = t.fase === 'destilando' && t.objetivo ? Math.round(100 * t.hechos / t.objetivo) : null;
      return `<h3>✦ Entrenamiento automático</h3>
        <ol class="fases">${FASES.map(([id, nom], k) => `<li class="${k < i || t.fase === 'listo' ? 'hecha' : k === i && activo ? 'actual' : ''}">${nom}${id === 'destilando' && t.objetivo ? ` <small>${t.hechos}/${t.objetivo}</small>` : ''}</li>`).join('')}</ol>
        ${pct != null && activo ? `<div class="barra-prog"><i style="width:${pct}%"></i></div><p class="tenue" style="font-size:12px;margin:4px 0 0">${t.hechos ? `faltan ~${duracion((Date.now() - t.creado) / t.hechos * (t.objetivo - t.hechos))} · ` : 'Investigando cada pregunta en varias fuentes… · '}sigue aunque cierres la app.</p>` : ''}
        ${t.fase === 'entrenando' ? '<p class="tenue" style="font-size:13px;margin:6px 0 0">Kaggle entrena en su GPU: suele tardar 20-60 min (más si hay cola).</p>' : ''}
        ${t.fase === 'listo' ? `<p style="margin:8px 0 0">★ <b>${esc(t.lora || t.nombre)}</b> ${t.prueba?.ok ? 'ya responde.' : 'está subido, pero aún no responde: ' + esc(t.prueba?.error || '')}</p>${t.resultado?.muestra ? `<details style="margin-top:6px"><summary class="tenue" style="font-size:13px">Ejemplo de respuesta</summary><div class="instrucciones-skill">${esc(t.resultado.muestra)}</div></details>` : ''}` : ''}
        ${t.fase === 'error' ? `<p class="error" style="margin:8px 0 0">${esc(t.error || 'Error')}</p>` : ''}
        ${t.kaggle?.url ? `<p style="font-size:13px;margin:6px 0 0"><a href="${esc(t.kaggle.url)}" target="_blank" rel="noopener">Ver el trabajo en Kaggle ↗</a></p>` : ''}
        <details class="registro-auto"><summary class="tenue" style="font-size:13px">Registro</summary>${(t.registro || []).slice().reverse().map(r => `<div><small>${new Date(r.t).toLocaleTimeString()}</small> ${esc(r.texto)}</div>`).join('')}</details>
        <div class="fila-botones">${activo ? '<button class="btn chico" data-auto="cancelar">Cancelar</button>' : `${t.fase === 'listo' ? '<button class="btn chico primario" data-auto="usar">Usar mi modelo</button>' : ''}<button class="btn chico" data-auto="nuevo">Entrenar otro</button>`}</div>`;
    }
    const falta = [!a.kaggle && 'tu clave de <b>Kaggle</b> (GPU gratis, 30 h/semana)', !a.cloudflare && 'una clave de <b>Cloudflare API</b> para subir el modelo'].filter(Boolean);
    return `<h3>✦ Entrenar automáticamente</h3>
      <p style="font-size:14px;margin:0 0 8px">laboratorio.ia genera preguntas de tus temas, las responde investigando con fuentes, junta eso con tus conversaciones, entrena en la GPU gratis de Kaggle y sube el modelo a tu nube. Todo solo.</p>
      ${falta.length ? `<p class="error" style="margin:0 0 8px">Falta ${falta.join(' y ')}.</p><div class="fila-botones" style="margin-top:0"><button class="btn chico rojo" data-auto="proveedores">⚿ Añadir claves</button></div>` : `
      <form id="form-auto" class="campo" style="display:grid;gap:8px">
        <label class="tenue" style="font-size:12px">Ejemplos a generar <select id="auto-objetivo"><option value="0">0: solo mis conversaciones</option><option value="60">60 (~1 h)</option><option value="150" selected>150 (~3 h, recomendado)</option><option value="300">300 (~6 h)</option></select></label>
        <label class="tenue" style="font-size:12px">Temas (separados por comas)<textarea id="auto-temas" rows="3">${esc(a.temas.join(', '))}</textarea></label>
        <label class="tenue" style="font-size:12px">Modelo base <select id="auto-base"><option value="@cf/meta/llama-3.2-3b-instruct">Llama 3.2 3B (recomendado)</option><option value="@cf/mistral/mistral-7b-instruct-v0.2-lora">Mistral 7B</option><option value="@cf/google/gemma-7b-it-lora">Gemma 7B</option><option value="@cf/google/gemma-2b-it-lora">Gemma 2B</option></select></label>
        <input id="auto-nombre" placeholder="nombre (p. ej. mi-laboratorio)" value="mi-laboratorio">
        <button class="btn chico rojo" type="submit">✦ Entrenar automáticamente</button>
      </form>`}
      ${t?.fase === 'error' ? `<p class="tenue" style="font-size:12px">Último intento: ${esc(t.error || '')}</p>` : ''}`;
  }

  // ── Memoria del chat ─────────────────────────────────────────────────────
  async function hojaMemoria() {
    if (!est.conv) { aviso('Empieza una conversación: la memoria se crea con los mensajes.'); return; }
    const c = await api(`/api/conversaciones/${est.conv}`);
    const ultimo = [...c.mensajes].reverse().find(m => m.meta?.memoria);
    const refs = c.mensajes.filter(m => m.rol === 'assistant' && m.meta?.fuentes?.length).length;
    abrirHoja('Memoria del chat', `
      <div class="panel" style="margin-top:0">
        <h3>Qué recuerda laboratorio.ia de esta conversación</h3>
        <p style="margin:4px 0;font-size:14px">${c.mensajes.length} mensajes · ${ultimo ? `${ultimo.meta.memoria.literales} enviados completos al modelo` : 'todos enviados completos'}${c.memoria_hasta ? ` · ${c.memoria_hasta} más antiguos resumidos abajo` : ''}</p>
        <p class="tenue" style="font-size:13px;margin:4px 0">Las referencias citadas (${refs} respuestas con fuentes) se recuerdan siempre con su título y enlace exactos, aunque el chat sea largo.</p>
      </div>
      <label class="campo"><span>Memoria resumida${c.memoria_hasta ? '' : ' (aún vacía: el chat cabe entero)'}</span>
        <textarea id="mem-texto" placeholder="Cuando el chat no quepa entero, aquí aparecerá el resumen de lo anterior. También puedes escribir datos que quieras que recuerde.">${esc(c.memoria || '')}</textarea></label>
      <div class="fila-botones"><button class="btn primario" data-op="guardar">Guardar memoria</button><button class="btn" data-op="borrar">Borrar memoria</button></div>`, cuerpo => cuerpo.addEventListener('click', async e => {
      const op = e.target.closest('[data-op]')?.dataset.op;
      if (op === 'guardar') { await api(`/api/conversaciones/${est.conv}`, { metodo: 'PATCH', cuerpo: { memoria: cuerpo.querySelector('#mem-texto').value } }); aviso('Memoria guardada'); cerrarHoja(); }
      if (op === 'borrar' && confirm('¿Borrar la memoria resumida? Se rehará desde el principio en el próximo mensaje.')) { await api(`/api/conversaciones/${est.conv}`, { metodo: 'PATCH', cuerpo: { memoria: '' } }); aviso('Memoria borrada'); cerrarHoja(); }
    }), true);
  }

  // ── Modelos por tarea ────────────────────────────────────────────────────
  async function hojaModelosTareas() {
    abrirHoja('Modelos por tarea', '<div class="estado"><span class="matriz">' + '<i></i>'.repeat(9) + '</span>Cargando modelos…</div>', null, true);
    await cargarModelos();
    const opciones = t => {
      if (t.id === 'imagen') return est.modelos.imagen.map(m => `<option value="${esc(m.id)}"${m.id === t.modelo ? ' selected' : ''}>${esc(m.nombre)}</option>`).join('');
      const rec = new Set(t.recomendados.map(m => m.id));
      const op = m => `<option value="${esc(m.id)}"${m.id === t.modelo ? ' selected' : ''}>${esc(m.nombre)}${m.contexto ? ` · ${Math.round(m.contexto / 1000)}k` : ''}</option>`;
      return `<option value="auto"${t.modelo === 'auto' ? ' selected' : ''}>Automático (FreeLLMAPI elige)</option>
        ${t.recomendados.length ? `<optgroup label="Recomendados para ${esc(t.nombre.toLowerCase())}">${t.recomendados.map(op).join('')}</optgroup>` : ''}
        <optgroup label="Todos">${est.modelos.texto.filter(m => m.id !== 'auto' && !rec.has(m.id)).map(op).join('')}</optgroup>`;
    };
    const html = `
      <p class="tenue" style="font-size:13px;margin:0 0 6px">Cada tarea usa su modelo cuando en el chat eliges «auto». Si el modelo falla, laboratorio.ia reintenta con el automático.</p>
      <div class="fila-botones" style="margin-top:4px"><button class="btn chico rojo" data-op="recomendar">✦ Usar los recomendados</button><button class="btn chico" data-op="todo-auto">Todo automático</button></div>
      ${est.modelos.error ? `<p class="error">${esc(est.modelos.error)}</p>` : ''}
      ${est.tareas.map(t => `
        <div class="panel" data-tarea="${t.id}">
          <h3>${esc(t.icono)} ${esc(t.nombre)}</h3>
          <p class="tenue" style="font-size:13px;margin:0 0 8px">${esc(t.descripcion)}</p>
          <label class="campo" style="margin:0"><select data-sel="${t.id}">${opciones(t)}</select></label>
          <div class="fila-botones" style="margin-top:8px;align-items:center"><button class="btn chico" data-probar="${t.id}">Probar</button><span class="tenue" data-res="${t.id}" style="font: 12px var(--mono)"></span></div>
        </div>`).join('')}`;
    abrirHoja(`Modelos por tarea · ${est.modelos.texto.length}`, html, cuerpo => {
      cuerpo.addEventListener('change', async e => {
        const id = e.target.dataset.sel;
        if (!id) return;
        await api('/api/tareas', { metodo: 'PUT', cuerpo: { id, modelo: e.target.value } });
        const t = est.tareas.find(x => x.id === id);
        if (t) t.modelo = e.target.value;
        pintarChips();
        aviso(`${t?.nombre}: ${e.target.value === 'auto' ? 'automático' : nombreModelo(e.target.value)}`);
      });
      cuerpo.addEventListener('click', async e => {
        const op = e.target.closest('[data-op]')?.dataset.op;
        if (op === 'recomendar') {
          const b = e.target.closest('button');
          b.disabled = true;
          b.textContent = 'Probando modelos… (hasta 1 min)';
          try { await api('/api/tareas/recomendar', { metodo: 'POST' }); aviso('Modelos asignados y probados'); } catch (err) { aviso(err.message, 4000); }
          hojaModelosTareas();
          return;
        }
        if (op === 'todo-auto') {
          for (const t of est.tareas) await api('/api/tareas', { metodo: 'PUT', cuerpo: { id: t.id, modelo: 'auto' } });
          hojaModelosTareas();
          return;
        }
        const b = e.target.closest('[data-probar]');
        if (!b) return;
        const id = b.dataset.probar;
        const res = cuerpo.querySelector(`[data-res="${id}"]`);
        const modelo = cuerpo.querySelector(`[data-sel="${id}"]`).value;
        b.disabled = true;
        res.textContent = 'probando…';
        try {
          const r = await api('/api/tareas/probar', { metodo: 'POST', cuerpo: { modelo, tipo: id === 'imagen' ? 'imagen' : 'texto' } });
          res.innerHTML = r.ok
            ? `<span style="color:var(--verde)">● ${(r.ms / 1000).toFixed(1)} s</span> · ${esc(r.modelo || modelo)}${r.respuesta ? ' · «' + esc(r.respuesta) + '»' : ''}`
            : `<span style="color:var(--rojo)">● ${esc(r.error)}</span>`;
        } catch (err) { res.textContent = err.message; }
        b.disabled = false;
      });
    }, true);
  }

  // ── Proveedores de FreeLLMAPI ────────────────────────────────────────────
  async function hojaProveedores(filtro = '') {
    let d;
    try { d = await api('/api/proveedores'); } catch (err) { abrirHoja('Proveedores', `<p class="error">${esc(err.message)}</p>`); return; }
    if (d.sesion !== 'ok') {
      const nueva = d.sesion === 'setup';
      abrirHoja('Proveedores', `
        <div class="panel">
          <h3>${nueva ? 'Crear la cuenta de FreeLLMAPI' : 'Iniciar sesión en FreeLLMAPI'}</h3>
          <p class="tenue" style="font-size:13px;margin:0 0 8px">${nueva ? 'Solo la primera vez. Después se activan solos los proveedores gratis que no piden clave.' : 'La sesión caducó o aún no se ha iniciado. Es la misma cuenta del dashboard y de <code>ia</code>.'}</p>
          <label class="campo"><span>Email</span><input id="pv-email" type="email" autocomplete="username"></label>
          <label class="campo"><span>Contraseña</span><input id="pv-pass" type="password" autocomplete="${nueva ? 'new-password' : 'current-password'}"></label>
          <p id="pv-error" class="error"></p>
          <div class="fila-botones"><button class="btn primario" data-op="entrar">${nueva ? 'Crear cuenta' : 'Entrar'}</button></div>
        </div>`, cuerpo => cuerpo.addEventListener('click', async e => {
        if (e.target.closest('[data-op]')?.dataset.op !== 'entrar') return;
        try {
          const r = await api('/api/proveedores/sesion', { metodo: 'POST', cuerpo: { email: cuerpo.querySelector('#pv-email').value.trim(), password: cuerpo.querySelector('#pv-pass').value } });
          if (r.activados?.length) aviso(`Activados: ${r.activados.join(', ')}`, 4000);
          hojaProveedores();
        } catch (err) { cuerpo.querySelector('#pv-error').textContent = err.message; }
      }), true);
      return;
    }
    const lista = d.proveedores;
    const orden = p => (p.configurado ? 0 : p.sinClave ? 1 : 2);
    const fila = p => `
      <div class="panel prov" data-prov="${p.id}" style="padding:10px 12px;margin:8px 0">
        <button class="opcion" data-abrir="${p.id}" style="padding:4px 0">
          <span class="ic" style="color:var(${p.configurado ? (p.estado === 'sana' || p.estado === 'healthy' ? '--verde' : '--texto') : '--apagado'})">${p.configurado ? '●' : p.sinClave ? '○' : '·'}</span>
          <span class="txt"><span class="nm">${esc(p.nombre)}${p.tipo && p.tipo !== 'chat' ? ` <small class="tenue">· ${esc(p.tipo)}</small>` : ''}</span>
          <span class="ds">${p.configurado ? 'Configurado' + (p.estado ? ' · ' + esc(p.estado) : '') : p.sinClave ? 'Funciona sin clave' : 'Necesita clave'}${p.nota ? ' · ' + esc(p.nota) : ''}</span></span>
        </button>
        <div class="detalle-prov" hidden>
          ${p.enlace ? `<p style="margin:6px 0;font-size:14px">1. Consigue la clave: <a href="${esc(p.enlace)}" target="_blank" rel="noopener">${esc(p.enlace.replace(/^https?:\/\//, ''))}</a></p>` : ''}
          <p style="margin:6px 0;font-size:14px">${p.enlace ? '2. ' : ''}Pégala aquí:</p>
          <div class="fila" style="display:flex;gap:8px"><input type="password" data-clave="${p.id}" placeholder="API key" autocomplete="off" style="flex:1;min-width:0;padding:10px 12px;border-radius:12px;border:1px solid var(--linea2);background:var(--negro)"><button class="btn chico primario" data-guardar="${p.id}">Guardar y probar</button></div>
          <p class="tenue" data-resultado="${p.id}" style="font: 12px var(--mono);margin:8px 0 0">${p.detalle ? esc(p.detalle) : ''}</p>
          ${p.recomendado ? `<p style="font-size:13px;margin:6px 0 0"><span style="color:var(--rojo)">✦</span> ${esc(p.recomendado)}</p>` : ''}
          ${p.propia ? `<div class="fila-botones" style="margin-top:8px"><button class="btn chico" data-quitar="${p.id}">Quitar mi clave</button></div>` : ''}
        </div>
      </div>`;
    const pintar = f => [...lista].filter(p => !f || (p.nombre + p.id + p.nota).toLowerCase().includes(f)).sort((a, b) => orden(a) - orden(b) || a.nombre.localeCompare(b.nombre)).map(fila).join('');
    abrirHoja(`Proveedores · ${d.resumen.configured}/${d.resumen.total}`, `
      <p class="tenue" style="font-size:13px;margin:0 0 8px">● configurado · ○ gratis sin clave · toca uno para añadir su clave. ${d.nube ? 'Las claves se guardan cifradas en tu laboratorio.ia (D1) y solo las usas tú.' : 'Las claves se guardan cifradas en FreeLLMAPI.'}</p>
      ${d.nube ? '' : '<div class="fila-botones" style="margin-top:0"><button class="btn chico rojo" data-op="gratis">Activar los gratis sin clave</button></div>'}
      <input class="buscar" id="pv-filtro" type="search" placeholder="Buscar proveedor (groq, gemini, cloudflare…)" value="${esc(filtro)}" style="margin-top:10px">
      <div id="pv-lista">${pintar(filtro)}</div>`, cuerpo => {
      cuerpo.querySelector('#pv-filtro').addEventListener('input', e => { cuerpo.querySelector('#pv-lista').innerHTML = pintar(e.target.value.toLowerCase()); });
      cuerpo.addEventListener('click', async e => {
        if (e.target.closest('[data-op="gratis"]')) {
          const r = await api('/api/proveedores/gratis', { metodo: 'POST' });
          aviso(r.activados.length ? `Activados: ${r.activados.join(', ')}` : 'Ya estaban todos activos', 4000);
          hojaProveedores();
          return;
        }
        const quitar = e.target.closest('[data-quitar]');
        if (quitar && confirm('¿Quitar esta clave?')) {
          await api(`/api/proveedores/clave/${quitar.dataset.quitar}`, { metodo: 'DELETE' });
          aviso('Clave quitada');
          cargarModelos();
          hojaProveedores();
          return;
        }
        const abrir = e.target.closest('[data-abrir]');
        if (abrir) { const det = abrir.parentElement.querySelector('.detalle-prov'); det.hidden = !det.hidden; return; }
        const g = e.target.closest('[data-guardar]');
        if (!g) return;
        const id = g.dataset.guardar;
        const clave = cuerpo.querySelector(`[data-clave="${id}"]`).value.trim();
        const out = cuerpo.querySelector(`[data-resultado="${id}"]`);
        if (!clave) { out.textContent = 'Pega la clave primero.'; return; }
        g.disabled = true;
        out.textContent = 'Guardando y probando…';
        try {
          const r = await api('/api/proveedores/clave', { metodo: 'POST', cuerpo: { plataforma: id, clave } });
          const ok = r.estado === 'válida';
          out.innerHTML = `<span style="color:var(${ok ? '--verde' : '--rojo'})">●</span> ${esc(r.enmascarada || '')} · ${esc(r.estado)}${r.modelos != null ? ' · ' + r.modelos + ' modelos' : ''}${r.detalle ? ' · ' + esc(r.detalle) : ''}`;
          cuerpo.querySelector(`[data-clave="${id}"]`).value = '';
          cargarModelos();
        } catch (err) { out.textContent = err.message; }
        g.disabled = false;
      });
    }, true);
  }

  // ── Lateral, visor y acciones globales ───────────────────────────────────
  function abrirLateral() { $('#lateral').classList.add('abierta'); $('#velo').hidden = false; }
  function cerrarLateral() { $('#lateral').classList.remove('abierta'); $('#velo').hidden = true; }
  function abrirVisor(src) {
    $('#visor img').src = src;
    $('#visor-guardar').href = src;
    $('#visor').hidden = false;
  }
  $('#visor-guardar').addEventListener('click', e => {
    if (app?.guardarImagen) { e.preventDefault(); app.guardarImagen(new URL($('#visor img').src, location.href).href); }
  });

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-accion]')?.dataset.accion;
    if (!a) return;
    ({
      nueva: nuevaConversacion,
      'abrir-lateral': abrirLateral,
      'cerrar-lateral': cerrarLateral,
      'cerrar-hoja': cerrarHoja,
      'cerrar-visor': () => { $('#visor').hidden = true; },
      'elegir-skill': hojaSkills,
      memoria: hojaMemoria,
      skills: () => { cerrarLateral(); gestorSkills(); },
      ajustes: () => { cerrarLateral(); hojaAjustes(); },
      fuentes: hojaFuentes,
      tamano: hojaTamano,
      combinar: hojaCombinar,
      modelo: hojaModelo,
    })[a]?.();
  });

  window.permisosCambiados = () => { if (!$('#hoja').hidden && $('#hoja-titulo').textContent === 'Ajustes') hojaAjustes(); };

  // Botón «atrás» de Android: cierra lo que esté abierto antes de salir.
  window.cardonAtras = function () {
    if (!$('#visor').hidden) { $('#visor').hidden = true; return true; }
    if (!$('#hoja').hidden) { cerrarHoja(); return true; }
    if ($('#lateral').classList.contains('abierta')) { cerrarLateral(); return true; }
    return false;
  };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.cardonAtras(); });

  iniciar();
})();
