# ¡Rompe la piñata! — Invitación navideña interactiva 2027

Página HTML para celular y computadora. Se tocan 7 golpes a la piñata, se rompe,
caen 5 frutas que se recolectan y sus deseos forman el letrero final.

## Archivo final
- `index.html` — página ligera que se comparte: lleva las etiquetas de vista previa
  (WhatsApp, iMessage, Messenger) y muestra el juego a pantalla completa.
- `juego.html` — la invitación completa. Es un solo archivo: incluye tipografías,
  gráficos SVG y audios. Se abre en cualquier navegador.
- `preview.jpg` y `apple-touch-icon.png` — imagen e ícono para la vista previa.

## Código fuente
- `src/head_body.html` — HTML y CSS: botón de sonido, manita de indicación y letrero final.
  Tiene marcadores (`__LOBSTER__`, `__TITLE_SVG__`, etc.) que `build.py` reemplaza.
- `src/game.js` — todo el juego, dibujado en canvas:
  - lectura y rasterizado de los SVG (`measure`, `renderPart`)
  - fondo, estrellas y serie de luces (`prepLuces` recolorea los focos)
  - péndulo de la piñata, cuerda de mecate y listones
  - golpes, grietas, piñata rota (golpe 6), estallido (golpe 7) y trozos girando
  - frutas que salen, las 5 recolectables (squash and stretch) y los deseos que vuelan al letrero
  - sonidos generados con Web Audio y los MP3 (canción, porra, jingle)
- `build.py` — arma `juego.html`: incrusta en base64 las tipografías,
  los SVG de `elem/elementos/` y los MP3 de `audio/`.

## Recursos
- `elem/elementos/` — SVG: fondos vertical y horizontal, luces, piñata entera,
  piñata rota (golpe 6, de ahí sale el trozo `Costado-derecho1`), piñata rota original
  (solo para los papeles sueltos), frutas y letrero (`letras.svg`).
- `audio/` — `cancion.mp3` (en bucle mientras la piñata está entera), `porra.mp3`
  (al romperse) y `jingle.mp3` (letrero final).
- `fonts/` — Lobster, Lilita One y Nunito (woff2, licencia SIL Open Font).

## Volver a generar
Con Python 3, desde esta carpeta:

    python3 build.py

Se sobrescribe `juego.html`.

## Notas
- El código usa los `id` de los grupos de cada SVG (por ejemplo `Pinata`, `Asa-y-tapa`,
  `Pico-...-listones`, `Foco-...`, `w-Alegria`). Si se cambian los SVG, deben conservar esos nombres.
- El audio arranca con el primer toque: los navegadores no permiten sonido automático.
- La vibración funciona en Android; Safari en iPhone no la permite.
