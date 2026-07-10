# Módulo de Mapa Interactivo de Becarios

Mapa mundial SVG interactivo, 100 % Vanilla JS (sin Google Maps, Leaflet ni
ninguna otra dependencia externa), pensado para integrarse posteriormente en
WordPress mediante un Custom Post Type "becario".

## Cómo ejecutarlo en local

El mapa se carga con `fetch()`, así que **hay que servir la carpeta por HTTP**
(abrir `index.html` con doble clic no funcionará por seguridad del navegador):

- **VS Code → extensión Live Server** → clic derecho sobre `index.html` →
  *"Open with Live Server"*.
- Alternativa por terminal: `npx serve .` o `python -m http.server`.

## Estructura

| Ruta                 | Función                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `index.html`         | Maqueta base: contenedor del mapa, tooltip y panel lateral (Fase 2) |
| `css/styles.css`     | Paleta en variables CSS, estados de país (reposo/hover) y tooltip   |
| `js/main.js`         | Carga inline del SVG, delegación de eventos, hover + tooltip        |
| `assets/world.svg`   | Mapa mundial: un `<path id="xx">` (ISO 3166-1) por país. Los 18 microestados que el mapa original omitía (Andorra, Mónaco, San Marino…) están añadidos como marcadores `<circle id="xx">` sobre su capital |
| `data/becarios.json` | Datos simulados para la Fase 2 (filtrado y panel lateral)           |

## Hoja de ruta

1. ✅ **Fase 1** — Mapa SVG inline + hover con tooltip + zoom hacia el cursor
   (rueda) y desplazamiento por arrastre, con límites de encuadre.
2. ✅ **Fase 2** — Países con becarios en azul (hover oscuro con transición)
   y "gota" marcadora animada que sigue al cursor mostrando el total. Clic en
   país → modal de acceso (vista pública) o panel lateral con listado, fotos
   y buscador (vista privada). Login simulado con el botón de la cabecera;
   todo el filtrado ocurre en cliente al instante.
3. ⬜ **Fase 3** — Integración WordPress: CPT `becario`, roles/login del área
   privada, shortcode que inyecta el SVG vía PHP y expone los datos según rol.

## Crédito del mapa

`assets/world.svg`: *Simple World Map* — Al MacDonald / Fritz Lekschas,
licencia **CC BY-SA 3.0** (uso comercial permitido manteniendo esta atribución).
