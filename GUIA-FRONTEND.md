# Guía de Frontend

Sistema de diseño y patrones de Josias Credit Hub. **Leer antes de crear una página nueva.**
El objetivo es que una página portada desde APEX sea indistinguible de las que ya existen.

---

## 1. Tipografía

Dos familias, cargadas desde Google Fonts en [src/routes/\_\_root.tsx](src/routes/__root.tsx):

| Uso | Familia | Clase |
| --- | --- | --- |
| Títulos | `Libre Baskerville` (serif) | `font-display` |
| Texto, labels, inputs | `Inter` (sans) | por defecto en `body` |

`h1`–`h4` ya usan la serif automáticamente (regla en `@layer base`), pero **en la práctica siempre
se escribe `font-display` explícito** junto con el tamaño, porque muchos títulos son `<p>` o `<span>`.

Escala real en uso:

```
Título de página     font-display text-3xl font-semibold
Título de sección    font-display text-lg font-semibold
Monto destacado      font-display text-2xl font-semibold tracking-tight
Subtítulo/ayuda      text-sm text-muted-foreground
Metadato/badge       text-xs  ·  text-[10px]  ·  text-[11px]
```

---

## 2. Colores

> ⚠️ **Ojo con los nombres.** Las utilidades se llaman `wood`, `caramel`, `ivory` —herencia de una
> paleta cálida anterior— pero **la paleta actual es azul** (zafiro/celeste, hue 245–260 en oklch).
> No asumas marrón por el nombre. La fuente de verdad es [src/styles.css](src/styles.css).

Tokens semánticos (nunca hardcodear un color; siempre la clase del token, así funciona el modo oscuro):

| Token | Qué es | Dónde se usa |
| --- | --- | --- |
| `background` / `foreground` | fondo de la app / texto | base |
| `card` / `card-foreground` | superficie de tarjeta | todo `<Card>` |
| `primary` | zafiro profundo | botón de acción principal, estado seleccionado |
| `secondary` | celeste — **es el color de acento** | iconos de sección, badges, links |
| `muted` / `muted-foreground` | gris suave | fondos neutros, texto secundario |
| `destructive` | rojo | errores, borrar, asterisco de obligatorio |
| `success` | verde | pasos completados |
| `warning` | ámbar | avisos |
| `border` / `input` / `ring` | bordes y foco | — |

Utilidades compuestas:

```
bg-gradient-wood      azul oscuro → usado en el hero del dashboard
bg-gradient-caramel   azul medio  → CTA principal, avatares, tarjeta de cuota
bg-gradient-ivory     sutil claro/oscuro
shadow-soft           elevación mínima
shadow-elegant        hover de tarjetas, elementos destacados
shadow-warm           hero, botón flotante
```

Modismos de color que se repiten:

- **Acento suave**: `bg-secondary/15 text-secondary` (badges, cuadraditos de icono).
- **Seleccionado**: `border-primary bg-primary/10 text-foreground`.
- **No seleccionado**: `border-border text-muted-foreground`.
- **Peligro al hover**: `hover:bg-destructive/10 hover:text-destructive`.

---

## 3. Forma y espaciado

- `--radius: 0.75rem`. En la práctica: `rounded-xl` para inputs/filas, `rounded-2xl`/`rounded-3xl`
  para tarjetas grandes y heros, `rounded-full` para badges, botones de icono y píldoras.
- Separación vertical de página: `space-y-6`. Dentro de tarjeta: `space-y-5` o `space-y-4`.
- Grillas de campos: `grid gap-4 sm:grid-cols-2`. Grillas de tarjetas: `grid gap-3 lg:grid-cols-2`.
- Ancho: listados usan todo el ancho (`max-w-6xl` lo pone el layout); **detalle** `mx-auto max-w-3xl`;
  **formulario** `mx-auto max-w-2xl`.

**Mobile-first, siempre.** La app se usa en el celular. Nada de tablas anchas: el equivalente de un
reporte APEX acá es una grilla de tarjetas.

---

## 4. Los tres arquetipos de página

Toda página de APEX cae en uno de estos tres. Copiá el archivo de referencia y adaptá.

### A. Listado — ref: [\_app.solicitudes.index.tsx](src/routes/_app.solicitudes.index.tsx), [\_app.precios.tsx](src/routes/_app.precios.tsx)

Estructura: encabezado con título + contador + botón recargar + CTA · buscador · uno de cuatro
estados (cargando / error / vacío / datos) · grilla de tarjetas clickeables.

```tsx
const API_URL = import.meta.env.VITE_API_URL as string | undefined;

function Pagina() {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!API_URL) { setError("Configura VITE_API_URL para ver …"); setLoading(false); return; }
    setLoading(true); setError(null);
    listarX()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);
  // … cargando → error → vacío → datos
}
```

Los cuatro estados no son opcionales; el usuario trabaja con conexión móvil inestable.

**Variante "reporte de APEX"** — ref: [\_app.recibos.tsx](src/routes/_app.recibos.tsx). Cuando se porta
un Interactive Grid y hay que conservar sus columnas, va **tabla en escritorio y tarjetas en el
celular**: `<Card className="hidden lg:block">` con `<Table>` adentro, más un `<div className="lg:hidden">`
con las tarjetas. Misma data, dos presentaciones — el cobrador no scrollea siete columnas de costado.

Si el listado puede tener decenas de miles de filas, la búsqueda y la paginación van **del lado del
servidor** (botón "Cargar más" + debounce de ~350 ms), no con el `traer-todo-y-filtrar-local` del
resto de la app.

### B. Detalle — ref: [\_app.solicitudes.$id.tsx](src/routes/_app.solicitudes.$id.tsx)

Link "Volver" arriba · tarjeta de encabezado con avatar/monto/estado · una `<Card>` por sección,
cada una con `<h2>` + icono `text-secondary` + contador · el helper `Row` para pares label/valor.

Los códigos se resuelven a descripciones con `lovLabels(...)` en paralelo vía `Promise.all`, y cada
uno con `.catch()` propio para que un LOV caído no tumbe la página.

### C. Formulario — ref: [\_app.clientes.nuevo.tsx](src/routes/_app.clientes.nuevo.tsx), [\_app.solicitudes.nueva.tsx](src/routes/_app.solicitudes.nueva.tsx)

Un `useState` con el objeto del formulario + helper `update(k, v)` · secciones en `<Card>` ·
helper `Field` con asterisco rojo si es obligatorio · validación que junta **todos** los faltantes en
un solo toast (`Completá: A, B, C`) · botones Cancelar/Guardar al pie · `navigate()` al terminar.

Para flujos largos usar el patrón de wizard con `Stepper` de `solicitudes.nueva`.

---

## 5. Equivalencias APEX → esta app

| APEX | Acá |
| --- | --- |
| Interactive / Classic Report | Grilla de `<Card>` clickeables (arquetipo A). Tabla solo si es realmente tabular y cabe en móvil. |
| Form Region + proceso DML | Arquetipo C |
| Page Item `P10_X` | `useState` |
| Popup LOV / Select con muchas filas | `<AsyncCombobox>` — abre un diálogo con buscador |
| Select List / Radio Group corto y fijo | Botones segmentados (ver Sexo / Estado civil / Vivienda en `clientes.nuevo`) |
| Switch / Checkbox `Y-N` | `<Switch>` de shadcn, mapeando a `"S"`/`"N"` |
| Date Picker | `<Input type="date">`, valor `YYYY-MM-DD` |
| Modal dialog page | `<Dialog>` |
| Validaciones de página | Validación en el submit + validación en el paquete PL/SQL |
| Branch tras submit | `navigate({ to: "…" })` |
| Mensaje de éxito/error | `toast.success(...)` / `toast.error(...)` de `sonner` |
| Botón region | `<Button>`; el principal `bg-primary text-primary-foreground hover:opacity-90` |
| `:APP_USER` | `getStoredUsername()` — en el backend, el token |

---

## 6. Componentes propios

- **[`<AsyncCombobox>`](src/components/async-combobox.tsx)** — selector de LOV. Recibe un
  `fetcher: (q?) => Promise<LovItem[]>`, debounce de 250 ms, y `renderItem` opcional para mostrar
  dos líneas (ej. nombre + CI). Es el reemplazo de todo popup LOV de APEX.
- **[`<BirthdatePicker>`](src/components/birthdate-picker.tsx)** — fecha de nacimiento.
- **[`<AppHeader>`](src/components/app-header.tsx) / [`<BottomNav>`](src/components/bottom-nav.tsx)** —
  navegación. Están sincronizados: **al agregar una ruta al menú hay que tocar los dos.**
- `src/components/ui/*` — shadcn/ui. No editarlos salvo necesidad real.

---

## 7. Formatos (Paraguay)

```ts
formatCurrency(1500000)  // "₲ 1.500.000"  — de @/lib/credit-applications, PYG sin decimales
```

- **Miles mientras se tipea**: guardar solo dígitos y mostrar con `toLocaleString("es-PY")`.
  Ver el helper `fmtMiles` en `solicitudes.nueva`.
- **Redondeo**: los montos de crédito se redondean **hacia arriba a múltiplos de 10.000**
  (`Math.ceil(monto / 10000) * 10000`). Confirmar con Jose si aplica también a recibos.
- **Fechas**: a la API van como `YYYY-MM-DD` (string); en pantalla
  `toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" })`.
  Un string vacío en una fecha revienta el `TO_DATE` de ORDS con ORA-01841 → mandar `null`.
- **Booleanos**: en la base son `'S'`/`'N'`, no `true`/`false`.

---

## 8. Rutas

File-based routing de TanStack Start (ver [src/routes/README.md](src/routes/README.md)).
Las páginas internas van bajo el layout `_app`, que ya exige sesión:

```
src/routes/_app.recibos.tsx          → /recibos
src/routes/_app.recibos.nuevo.tsx    → /recibos/nuevo
src/routes/_app.recibos.$id.tsx      → /recibos/:id
```

`routeTree.gen.ts` es autogenerado: se regenera con `npm run dev` o `npx vite build`. No editarlo a mano.

---

## 9. Desbordes horizontales — `min-width: auto`

La causa nº1 de que algo se salga de la pantalla. Tanto los flex items como los
grid tracks tienen **`min-width: auto`**: no bajan del ancho de su contenido, así
que un texto largo estira el contenedor en vez de cortarse. Hay que desactivarlo
explícitamente, en los dos niveles.

**En grids** — usar siempre columnas explícitas. `grid` a secas crea un track
`auto` que se estira; `grid-cols-1` de Tailwind es `minmax(0, 1fr)`, que sí achica:

```tsx
<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">   {/* ✅ */}
<div className="grid gap-3">                              {/* ❌ desborda */}
```

**En flex** — `min-w-0` en el elemento que trunca, `shrink-0` en lo que va al lado:

```tsx
<div className="flex min-w-0 items-center gap-2">
  <p className="min-w-0 flex-1 truncate font-medium">{nombre}</p>
  <span className="shrink-0 text-xs">#{numero}</span>
</div>
```

**En celdas de tabla** — `max-w-[22rem]` + `truncate`, porque una `<td>` tampoco
se achica sola.

Probar siempre con **el texto más largo de los datos reales**, no con "Juan Pérez".
En recibos el nombre viene como `CI + razón social` ("4.694.130 Yadira Magaly
Ibarra Gonzalez") y rompe cualquier layout que no tenga esto.

## 10. Checklist antes de dar por hecha una página

1. ¿Los cuatro estados (cargando / error / vacío / datos) están cubiertos?
2. ¿Se ve bien a 360 px de ancho, **con los textos más largos de los datos reales**?
   (ver §9: `truncate` sin `min-w-0` desborda)
3. ¿Funciona en modo oscuro? (solo tokens, ningún color literal)
4. ¿Los montos pasan por `formatCurrency` y las fechas por `formatDate`?
5. ¿Los errores llegan al usuario por `toast`, no por `console`?
6. Si es ruta nueva de menú: ¿está en `app-header.tsx` **y** en `bottom-nav.tsx`?
7. `npx tsc --noEmit` limpio.

---

## Ver también

- [GUIA-BACKEND.md](GUIA-BACKEND.md) — cómo se porta el PL/SQL de APEX a ORDS.
- [backend/README.md](backend/README.md) — convenciones de ORDS y Oracle.
- [GUIA-LOGIN.md](GUIA-LOGIN.md) — autenticación y tokens.
