/**
 * ============================================================================
 * Mapa Interactivo de Becarios — Fase 2: datos, panel lateral y vistas
 * ----------------------------------------------------------------------------
 * JavaScript puro (Vanilla JS), sin dependencias de terceros.
 *
 * Cómo funciona el mapa:
 *  - assets/world.svg contiene un <path id="xx"> por país (código ISO 3166-1
 *    alpha-2 en minúsculas). Los países con islas van agrupados en <g id="xx">
 *    y los microestados son <circle id="xx">. El SVG se inyecta INLINE para
 *    que cada país sea un nodo accesible por CSS y JS.
 *  - DELEGACIÓN DE EVENTOS: unos pocos listeners sobre el <svg> completo.
 *
 * Cómo funcionan los datos (Fase 2):
 *  - data/becarios.json se carga en paralelo con el SVG y se indexa en un
 *    Map código-país → becarios. Todo el filtrado es en cliente e instantáneo.
 *  - Vista PÚBLICA: al pulsar un país el panel muestra SOLO el total y un
 *    botón de registro. Vista PRIVADA (sesión simulada con el botón de la
 *    cabecera): listado detallado con buscador en tiempo real.
 *  - En la FASE 3 (WordPress) el JSON lo generará PHP desde el CPT "becario"
 *    y el estado de sesión vendrá de is_user_logged_in(); este archivo no
 *    necesitará cambios estructurales.
 *
 * Zoom y pan: manipulando el atributo viewBox (ver comentarios en su sección).
 * ============================================================================
 */

(() => {
    'use strict';

    // ------------------------------------------------------------------ config

    const RUTA_SVG = 'assets/world.svg';
    const RUTA_DATOS = 'data/becarios.json';

    /** Ampliación máxima respecto a la vista completa (16 = ver 1/16 del ancho) */
    const ZOOM_MAXIMO = 16;

    /** Sensibilidad de la rueda: más alto = zoom más rápido por giro */
    const SENSIBILIDAD_RUEDA = 0.0015;

    /** Píxeles de movimiento por debajo de los cuales un arrastre cuenta como clic */
    const UMBRAL_ARRASTRE = 5;

    // Un id de país válido es "xx" (ISO alpha-2) o "_nombre" (territorios sin
    // código ISO, p. ej. "_somaliland"). Así descartamos el id del propio SVG.
    const REGEX_ID_PAIS = /^([a-z]{2}|_[a-z]+)$/i;

    // Nombres para territorios sin código ISO (no resolubles vía Intl)
    const NOMBRES_ESPECIALES = {
        _somaliland: 'Somalilandia'
    };

    // Traductor nativo del navegador: código ISO → nombre de país en español.
    const nombresRegion = new Intl.DisplayNames(['es'], { type: 'region' });

    // -------------------------------------------------------------------- DOM

    const contenedorMapa = document.getElementById('map-container');
    const gota = document.getElementById('map-drop');
    const gotaNumero = document.getElementById('map-drop-num');
    const botonReset = document.getElementById('map-reset');
    const botonLogin = document.getElementById('toggle-login');

    const panel = document.getElementById('side-panel');
    const panelCerrar = document.getElementById('panel-close');
    const panelTitulo = document.getElementById('panel-title');
    const panelContador = document.getElementById('panel-count');
    const panelPrivado = document.getElementById('panel-private');
    const panelPublico = document.getElementById('panel-public');
    const buscador = document.getElementById('panel-search');
    const lista = document.getElementById('panel-list');

    const modal = document.getElementById('access-modal');
    const modalCerrar = document.getElementById('modal-close');
    const modalContador = document.getElementById('modal-count');
    const modalLogin = document.getElementById('modal-login');

    /** Referencia al <svg> una vez inyectado */
    let svg = null;

    // ------------------------------------------------------------------ estado

    /** Índice código-país → array de becarios (ordenados por apellido) */
    const becariosPorPais = new Map();

    /** Simulación del login del área privada (en WP vendrá del servidor) */
    let sesionIniciada = false;

    /** País (path, g o circle) actualmente bajo el cursor */
    let paisActivo = null;

    /** País actualmente seleccionado (panel abierto) */
    let paisSeleccionado = null;

    /** viewBox original del SVG: zoom mínimo y jaula del encuadre */
    const vistaInicial = { x: 0, y: 0, w: 0, h: 0 };

    /** viewBox actual (lo que se está viendo ahora mismo) */
    const vista = { x: 0, y: 0, w: 0, h: 0 };

    /** Estado del arrastre en curso */
    const arrastre = {
        activo: false,   // botón pulsado
        movio: false,    // superó el umbral → es un arrastre real, no un clic
        origenX: 0,      // posición del puntero al pulsar (px de pantalla)
        origenY: 0,
        vistaX: 0,       // copia de la vista al pulsar
        vistaY: 0,
        escala: 1        // unidades SVG por píxel de pantalla en ese momento
    };

    /** true si ya hay un repintado encolado para el próximo frame */
    let frameSolicitado = false;

    // ------------------------------------------------------------- arranque

    init();

    async function init() {
        try {
            // Mapa y datos viajan en paralelo
            const [svgTexto, datos] = await Promise.all([
                cargar(RUTA_SVG).then((r) => r.text()),
                cargar(RUTA_DATOS).then((r) => r.json())
            ]);
            indexarBecarios(datos.becarios);
            inyectarMapa(svgTexto);
            pintarPaisesConBecarios();
            activarPanel();
            activarModal();
        } catch (error) {
            const aviso = contenedorMapa.querySelector('.map-loading');
            if (aviso) {
                aviso.className = 'map-error';
                aviso.textContent =
                    'No se pudo cargar el mapa. Recuerda abrir el proyecto con un ' +
                    'servidor local (p. ej. la extensión Live Server), no con doble clic al archivo.';
            }
            console.error('[Mapa] Error en la carga:', error);
        }
    }

    async function cargar(ruta) {
        const respuesta = await fetch(ruta);
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status} al pedir ${ruta}`);
        return respuesta;
    }

    /**
     * Inserta el SVG inline y lo deja listo para interactuar.
     */
    function inyectarMapa(svgTexto) {
        contenedorMapa.querySelector('.map-loading')?.remove();
        // insertAdjacentHTML (y no innerHTML=) para conservar leyenda, botón y panel
        contenedorMapa.insertAdjacentHTML('afterbegin', svgTexto);
        svg = contenedorMapa.querySelector('svg');

        // El tamaño lo gobiernan el viewBox + CSS (mapa fluido/responsive)
        svg.removeAttribute('width');
        svg.removeAttribute('height');

        // Guardamos el viewBox original: define el zoom mínimo y los límites
        const vb = svg.viewBox.baseVal;
        Object.assign(vistaInicial, { x: vb.x, y: vb.y, w: vb.width, h: vb.height });
        Object.assign(vista, vistaInicial);

        activarInteraccion();
        activarZoomPan();
        console.info('[Mapa] SVG cargado. Países interactivos listos.');
    }

    // -------------------------------------------------------------- datos

    /**
     * Construye el índice país → becarios. Es la ÚNICA estructura que consulta
     * el resto del código: cuando los datos vengan de WordPress bastará con
     * alimentar este índice igual.
     */
    function indexarBecarios(listaBecarios) {
        for (const becario of listaBecarios) {
            const clave = becario.pais.toLowerCase();
            if (!becariosPorPais.has(clave)) becariosPorPais.set(clave, []);
            becariosPorPais.get(clave).push(becario);
        }
        for (const grupo of becariosPorPais.values()) {
            grupo.sort((a, b) => a.apellidos.localeCompare(b.apellidos, 'es'));
        }
        console.info(`[Datos] ${listaBecarios.length} becarios en ${becariosPorPais.size} países.`);
    }

    /**
     * Marca con la clase .has-fellows los países que tienen al menos un
     * becario. El color (azul suave en reposo, azul oscuro al pasar el
     * ratón, con transición de 0.3s) lo resuelve el CSS con :hover nativo.
     */
    function pintarPaisesConBecarios() {
        for (const codigo of becariosPorPais.keys()) {
            const elemento = svg.querySelector(`#${codigo}`);
            if (elemento) {
                elemento.classList.add('has-fellows');
            } else {
                console.warn(`[Datos] El país "${codigo}" del JSON no existe en el SVG.`);
            }
        }
    }

    function becariosDe(codigo) {
        return becariosPorPais.get(codigo) || [];
    }

    // ------------------------------------------------- interacción (hover/clic)

    function activarInteraccion() {
        // ENTRADA en un país (mouseover delegado en el <svg> = mouseenter por
        // país, sin necesitar ~200 listeners individuales)
        svg.addEventListener('mouseover', (evento) => {
            if (arrastre.activo && arrastre.movio) return; // sin gota mientras se arrastra
            const pais = obtenerPais(evento.target);
            if (!pais || pais === paisActivo) return;

            paisActivo = pais;
            const total = becariosDe(pais.id).length;

            if (total > 0) {
                // País con becarios: número dentro de la gota y a escena.
                // Se posiciona ANTES de activarla para que no "salte".
                gotaNumero.textContent = String(total);
                posicionarGota(evento);
                gota.classList.add('activo');
            } else {
                ocultarGota();
            }
        });

        // SALIDA del país: solo se oculta si realmente lo abandona (moverse
        // entre dos islas del MISMO país no debe hacer parpadear la gota)
        svg.addEventListener('mouseout', (evento) => {
            if (!paisActivo) return;
            const destino = evento.relatedTarget;
            if (destino && paisActivo.contains(destino)) return;
            limpiarHover();
        });

        // MOVIMIENTO: la gota sigue al cursor mientras esté activa
        contenedorMapa.addEventListener('mousemove', (evento) => {
            if (gota.classList.contains('activo')) posicionarGota(evento);
        });

        // Clic: seleccionar país y abrir panel; clic en el océano cierra
        svg.addEventListener('click', (evento) => {
            if (arrastre.movio) return; // era el final de un arrastre, no un clic
            const pais = obtenerPais(evento.target);
            if (pais) {
                seleccionarPais(pais);
            } else if (!panel.hidden) {
                cerrarPanel();
            }
        });
    }

    // ------------------------------------------------------- panel lateral

    function activarPanel() {
        panelCerrar.addEventListener('click', cerrarPanel);

        document.addEventListener('keydown', (evento) => {
            if (evento.key !== 'Escape') return;
            if (!modal.hidden) cerrarModal();
            else cerrarPanel();
        });

        // Filtro en tiempo real sobre el listado (solo vista privada)
        buscador.addEventListener('input', () => {
            if (!paisSeleccionado) return;
            renderizarLista(filtrarBecarios(becariosDe(paisSeleccionado.id), buscador.value));
        });

        // SOLO DESARROLLO: alterna la simulación de sesión iniciada
        botonLogin.addEventListener('click', () => {
            sesionIniciada = !sesionIniciada;
            botonLogin.textContent = sesionIniciada
                ? '🔓 Vista privada (sesión simulada)'
                : '🔒 Vista pública';
            botonLogin.setAttribute('aria-pressed', String(sesionIniciada));
            botonLogin.classList.toggle('is-private', sesionIniciada);
            // Continuidad: si había modal o panel abierto, se re-evalúa qué
            // interfaz corresponde ahora (p. ej. modal → listado al "loguearse")
            if ((!modal.hidden || !panel.hidden) && paisSeleccionado) {
                mostrarDetallePais(paisSeleccionado.id);
            }
        });
    }

    function seleccionarPais(pais) {
        paisSeleccionado?.classList.remove('country-selected');
        paisSeleccionado = pais;
        paisSeleccionado.classList.add('country-selected');
        mostrarDetallePais(pais.id);
    }

    /**
     * Decide qué interfaz corresponde al país seleccionado:
     *  - vista pública + país CON becarios → modal de acceso (captación),
     *  - resto de casos (vista privada, o país aún sin becarios) → panel.
     */
    function mostrarDetallePais(codigo) {
        if (!sesionIniciada && becariosDe(codigo).length > 0) {
            abrirModal(codigo);
        } else {
            abrirPanel(codigo);
        }
    }

    function deseleccionarPais() {
        paisSeleccionado?.classList.remove('country-selected');
        paisSeleccionado = null;
    }

    /**
     * Rellena y muestra el panel según la vista activa.
     * REGLA DE PRIVACIDAD: la vista pública solo conoce el TOTAL; los datos
     * personales únicamente se renderizan con sesión iniciada.
     */
    function abrirPanel(codigo) {
        modal.hidden = true; // panel y modal nunca conviven
        const grupo = becariosDe(codigo);

        panelTitulo.textContent = nombrePais(codigo);
        panelContador.textContent =
            grupo.length === 0 ? 'Aún no hay becarios en este país' :
            grupo.length === 1 ? '1 becario' :
            `${grupo.length} becarios`;

        panelPrivado.hidden = !sesionIniciada;
        panelPublico.hidden = sesionIniciada;

        if (sesionIniciada) {
            buscador.value = '';
            buscador.hidden = grupo.length === 0;
            renderizarLista(grupo);
        }

        panel.hidden = false;
    }

    function cerrarPanel() {
        panel.hidden = true;
        deseleccionarPais();
    }

    // ------------------------------------------------------ modal de acceso

    function activarModal() {
        modalCerrar.addEventListener('click', cerrarModal);

        // Clic en el fondo oscuro (fuera del recuadro blanco) también cierra
        modal.addEventListener('click', (evento) => {
            if (evento.target === modal) cerrarModal();
        });

        modalLogin.addEventListener('click', () => {
            // TODO Fase 3: redirigir a wp_login_url() / página de registro
            console.log('[Modal] Redirigir al login/registro de WordPress (Fase 3).');
            cerrarModal();
        });
    }

    function abrirModal(codigo) {
        panel.hidden = true; // panel y modal nunca conviven
        const total = becariosDe(codigo).length;
        modalContador.textContent = total === 1
            ? `Hay 1 becario residente en ${nombrePais(codigo)}.`
            : `Hay ${total} becarios residentes en ${nombrePais(codigo)}.`;
        modal.hidden = false;
        modalLogin.focus(); // accesibilidad: el foco entra al modal
    }

    function cerrarModal() {
        if (modal.hidden) return;
        modal.hidden = true;
        deseleccionarPais();
    }

    /**
     * Pinta el listado detallado (vista privada). Se construye con la API DOM
     * y textContent — nunca innerHTML con datos —, de modo que cuando los
     * nombres vengan de WordPress no haya riesgo de inyección HTML.
     */
    function renderizarLista(becarios) {
        lista.textContent = '';

        if (becarios.length === 0) {
            const vacio = document.createElement('li');
            vacio.className = 'panel-empty';
            vacio.textContent = 'Ningún becario coincide con la búsqueda.';
            lista.appendChild(vacio);
            return;
        }

        for (const becario of becarios) {
            const item = document.createElement('li');
            item.className = 'panel-item';

            const info = document.createElement('div');
            info.className = 'panel-item-info';

            const nombre = document.createElement('strong');
            nombre.textContent = `${becario.nombre} ${becario.apellidos}`;

            const detalle = document.createElement('span');
            detalle.className = 'panel-item-detalle';
            detalle.textContent = `${becario.area} · ${becario.ciudad}`;

            const promo = document.createElement('span');
            promo.className = 'panel-item-promo';
            promo.textContent = `Promoción ${becario.promocion}`;

            info.append(nombre, detalle, promo);
            item.append(crearAvatar(becario), info);
            lista.appendChild(item);
        }
    }

    /** Paleta para los avatares de iniciales (color estable por becario) */
    const PALETA_AVATAR = ['#4a90c2', '#7a6fb0', '#4faa8c', '#d98b5f', '#c25b7a'];

    /**
     * Avatar del becario: su foto si la tiene (en WordPress será la URL de la
     * "imagen destacada" del CPT) y, si no la tiene —o la imagen falla al
     * cargar—, un círculo con sus iniciales. El listado nunca queda roto.
     */
    function crearAvatar(becario) {
        if (becario.foto) {
            const img = document.createElement('img');
            img.className = 'panel-avatar';
            img.src = becario.foto;
            img.alt = '';        // decorativa: el nombre ya está al lado en texto
            img.loading = 'lazy';
            img.addEventListener(
                'error',
                () => img.replaceWith(avatarIniciales(becario)),
                { once: true }
            );
            return img;
        }
        return avatarIniciales(becario);
    }

    function avatarIniciales(becario) {
        const avatar = document.createElement('div');
        avatar.className = 'panel-avatar panel-avatar-iniciales';
        avatar.textContent =
            `${becario.nombre[0] || ''}${becario.apellidos[0] || ''}`.toUpperCase();
        avatar.style.backgroundColor = PALETA_AVATAR[becario.id % PALETA_AVATAR.length];
        return avatar;
    }

    /**
     * Filtro instantáneo, insensible a mayúsculas y tildes
     * ("perez" encuentra "Pérez").
     */
    function filtrarBecarios(grupo, consulta) {
        const q = normalizar(consulta.trim());
        if (!q) return grupo;
        return grupo.filter((b) =>
            normalizar(`${b.nombre} ${b.apellidos} ${b.area} ${b.ciudad}`).includes(q)
        );
    }

    function normalizar(texto) {
        // NFD separa letra y tilde; el rango U+0300-036F son las tildes sueltas
        return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    // ----------------------------------------------------------- zoom y pan

    function activarZoomPan() {
        // passive:false → podemos hacer preventDefault y que la página no scrollee
        svg.addEventListener('wheel', alGirarRueda, { passive: false });

        // Pointer Events en vez de mouse events: setPointerCapture mantiene el
        // arrastre aunque el cursor salga del mapa, y funciona también en táctil.
        svg.addEventListener('pointerdown', alPulsar);
        svg.addEventListener('pointermove', alMover);
        svg.addEventListener('pointerup', alSoltar);
        svg.addEventListener('pointercancel', alSoltar);
        // Red de seguridad: si el botón se suelta fuera del mapa antes de que
        // exista captura, que el estado de arrastre no se quede "pegado"
        window.addEventListener('pointerup', alSoltar);

        botonReset.addEventListener('click', () => {
            Object.assign(vista, vistaInicial);
            solicitarRender();
        });
    }

    /**
     * Zoom con la rueda, centrado en el cursor: el punto del mapa que está
     * bajo el ratón debe seguir bajo el ratón después de escalar.
     */
    function alGirarRueda(evento) {
        evento.preventDefault();
        if (arrastre.activo) return;

        // Normalizamos: Firefox puede medir la rueda en "líneas" (deltaMode 1)
        const delta = evento.deltaMode === 1 ? evento.deltaY * 33 : evento.deltaY;
        const factor = Math.exp(delta * SENSIBILIDAD_RUEDA);

        // Anchura de vista deseada, acotada entre zoom máximo y vista completa
        const anchoNuevo = limitar(
            vista.w * factor,
            vistaInicial.w / ZOOM_MAXIMO,
            vistaInicial.w
        );
        const factorReal = anchoNuevo / vista.w;
        if (factorReal === 1) return; // ya estábamos en un tope de zoom

        // Punto del dibujo bajo el cursor (coordenadas SVG, no de pantalla)
        const foco = puntoSVG(evento);

        // Reescalar la ventana manteniendo el foco fijo bajo el cursor
        vista.x = foco.x - (foco.x - vista.x) * factorReal;
        vista.y = foco.y - (foco.y - vista.y) * factorReal;
        vista.w *= factorReal;
        vista.h *= factorReal;

        encuadrarVista();
        solicitarRender();
    }

    function alPulsar(evento) {
        if (evento.button !== 0) return; // solo botón izquierdo
        evento.preventDefault();         // evita selecciones de texto/arrastres nativos
        // OJO: aquí NO se llama a setPointerCapture. Capturar en el pointerdown
        // hace que el click posterior tenga como target el <svg> completo
        // (comportamiento de Chrome), rompiendo la selección de país por
        // delegación. La captura se toma en alMover, solo si hay arrastre real.

        arrastre.activo = true;
        arrastre.movio = false;
        arrastre.origenX = evento.clientX;
        arrastre.origenY = evento.clientY;
        arrastre.vistaX = vista.x;
        arrastre.vistaY = vista.y;
        // Conversión px de pantalla → unidades SVG, fija durante todo el arrastre
        arrastre.escala = vista.w / svg.getBoundingClientRect().width;
    }

    function alMover(evento) {
        if (!arrastre.activo) return;

        const dx = evento.clientX - arrastre.origenX;
        const dy = evento.clientY - arrastre.origenY;

        // Hasta superar el umbral no es un arrastre (protege el clic de país)
        if (!arrastre.movio) {
            if (Math.hypot(dx, dy) < UMBRAL_ARRASTRE) return;
            arrastre.movio = true;
            // Ahora sí es un arrastre: capturamos el puntero para que no se
            // corte aunque el cursor salga del mapa. El click fantasma que
            // llega al soltar se descarta con arrastre.movio.
            svg.setPointerCapture(evento.pointerId);
            svg.classList.add('is-panning');
            limpiarHover(); // sin gota mientras se arrastra
        }

        // Arrastrar el mapa = mover la ventana en dirección contraria
        vista.x = arrastre.vistaX - dx * arrastre.escala;
        vista.y = arrastre.vistaY - dy * arrastre.escala;

        encuadrarVista();
        solicitarRender();
    }

    function alSoltar() {
        if (!arrastre.activo) return;
        arrastre.activo = false;
        svg.classList.remove('is-panning');
        // arrastre.movio se queda como esté: el evento click que llega justo
        // después lo consulta para distinguir "clic en país" de "fin de arrastre".
    }

    // ------------------------------------------------------ gestión de vista

    /**
     * Mantiene la vista dentro de los límites lógicos:
     *  - la anchura entre el zoom máximo y la vista completa,
     *  - el encuadre siempre dentro del dibujo (el mapa nunca "se escapa").
     */
    function encuadrarVista() {
        vista.w = limitar(vista.w, vistaInicial.w / ZOOM_MAXIMO, vistaInicial.w);
        vista.h = vista.w * (vistaInicial.h / vistaInicial.w); // misma proporción
        vista.x = limitar(vista.x, vistaInicial.x, vistaInicial.x + vistaInicial.w - vista.w);
        vista.y = limitar(vista.y, vistaInicial.y, vistaInicial.y + vistaInicial.h - vista.h);
    }

    /**
     * Encola un repintado para el próximo frame. Aunque lleguen 30 eventos de
     * rueda/movimiento entre frames, el viewBox solo se escribe una vez.
     */
    function solicitarRender() {
        if (frameSolicitado) return;
        frameSolicitado = true;
        requestAnimationFrame(() => {
            frameSolicitado = false;
            svg.setAttribute('viewBox', `${vista.x} ${vista.y} ${vista.w} ${vista.h}`);
            botonReset.hidden = esVistaCompleta();
        });
    }

    function esVistaCompleta() {
        return Math.abs(vista.w - vistaInicial.w) < 0.001;
    }

    /**
     * Convierte las coordenadas de pantalla de un evento a coordenadas del
     * dibujo SVG, usando la matriz de transformación real del elemento.
     */
    function puntoSVG(evento) {
        const punto = new DOMPoint(evento.clientX, evento.clientY);
        return punto.matrixTransform(svg.getScreenCTM().inverse());
    }

    // ------------------------------------------------------------- países

    /**
     * A partir del elemento donde ocurrió el evento, sube por el DOM hasta
     * encontrar el nodo-país (<path>, <g> o <circle> con id ISO). Devuelve
     * null si el evento ocurrió sobre el océano o fuera de un país.
     */
    function obtenerPais(elemento) {
        if (!(elemento instanceof Element)) return null;
        const candidato = elemento.closest('[id]');
        if (!candidato || !REGEX_ID_PAIS.test(candidato.id)) return null;
        return candidato;
    }

    function limpiarHover() {
        paisActivo = null;
        ocultarGota();
    }

    /**
     * Nombre legible del país en español a partir de su id del SVG.
     */
    function nombrePais(id) {
        if (NOMBRES_ESPECIALES[id]) return NOMBRES_ESPECIALES[id];
        try {
            return nombresRegion.of(id.toUpperCase());
        } catch {
            return id.toUpperCase(); // último recurso: mostrar el código
        }
    }

    // --------------------------------------------------------- gota marcadora

    /**
     * Ancla la PUNTA de la gota al cursor. El CSS se encarga del resto:
     * translate(-50%, -100%) centra el marcador sobre ese punto y la clase
     * .activo lo hace flotar 10px por encima con su animación de subida.
     */
    function posicionarGota(evento) {
        gota.style.left = `${evento.clientX}px`;
        gota.style.top = `${evento.clientY}px`;
    }

    function ocultarGota() {
        gota.classList.remove('activo');
    }

    // ---------------------------------------------------------------- utils

    function limitar(valor, minimo, maximo) {
        return Math.min(Math.max(valor, minimo), maximo);
    }
})();
