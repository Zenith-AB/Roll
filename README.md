# Rollo

Convierte un PDF en un documento web para leer: texto reflowable, subrayados,
notas y buscador. Funciona en Android, iPhone y escritorio, sin servidor — el
PDF nunca sale del dispositivo.

```bash
npm install
npm run dev      # http://localhost:5173/Roll/
npm test         # pruebas del extractor y del anclaje de subrayados
npm run check    # lint + pruebas + build
```

## Cómo está hecho

Un PDF no guarda párrafos, columnas, tablas ni figuras: guarda operaciones de
dibujo y trozos de texto con coordenadas. Reconstruir el documento a partir de
eso es casi todo el programa, y vive en `src/services`:

| archivo | qué reconstruye |
| --- | --- |
| `pdfLayout.js` | El **orden de lectura**, con un XY-cut recursivo: bandas horizontales primero (para despegar un título del cuerpo), columnas después. Distingue el corredor entre columnas del hueco entre celdas de una tabla. |
| `pdfExtractor.js` | **Párrafos** (reuniendo líneas partidas, incluso entre páginas), **encabezados**, **tablas** (columnas por alineación, celdas que se parten en varias líneas, tablas que siguen en la página siguiente), **pies de figura** y **notas al pie**. |
| `pdfGraphics.js` | **Figuras**, re-dibujando con pdf.js las zonas de la página que se pintan en vez de componerse — así aparecen también los gráficos vectoriales, no solo las imágenes incrustadas — y los **comentarios de autor** guardados en las anotaciones del PDF. |

Cada bloque conserva su etiqueta real (`<figure>`, `<table>`, `<aside>`,
`<figcaption>`, `h2`–`h4`), de modo que el documento sigue teniendo estructura
al copiarlo, imprimirlo o leerlo con un lector de pantalla.

## Notas de plataforma

- Se usa el build **legacy** de pdf.js a propósito: el normal llama a
  `Promise.withResolvers()` sin polyfill y eso rompe Safari anterior a iOS 17.4.
- El texto se extrae leyendo el stream a mano, porque Safari no implementa
  `ReadableStream[Symbol.asyncIterator]`.
- Las figuras se rasterizan en un canvas del tamaño de la figura, con topes de
  memoria distintos para móvil y escritorio; los canvas se liberan poniendo su
  tamaño a cero, que es lo único que devuelve la memoria en iOS.
- Una tabla ancha se muestra como fichas en pantallas estrechas, sin dejar de
  ser un `<table>` en el DOM.
