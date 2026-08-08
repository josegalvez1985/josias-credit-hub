# Guía — Impresión del recibo térmico

El recibo se puede imprimir por **tres vías**:

| Vía | Archivo | Dónde anda | ¿Hay que configurar algo? |
| --- | --- | --- | --- |
| **Windows** (diálogo del sistema) | [src/lib/recibo-sistema.ts](src/lib/recibo-sistema.ts) | Cualquier navegador, cualquier impresora ya instalada | **No** |
| **Bluetooth** | [src/lib/escpos.ts](src/lib/escpos.ts) | Chrome en Android | Emparejar la impresora |
| **USB** (WebUSB) | [src/lib/escpos-usb.ts](src/lib/escpos-usb.ts) | Chrome/Edge en Windows, Linux, Android con OTG | En Windows sí — §2 |

**Cuál usar:**

- **En la PC de escritorio → "Impresora instalada en Windows".** Usa el driver
  que Windows ya tiene, así que no hay nada que configurar. Es la respuesta al
  error *"Windows tiene tomada la impresora"*.
- **En el celular del cobrador → Bluetooth.** Manda los bytes ESC/POS directo,
  sin diálogo de impresión.
- **WebUSB** solo si querés control fino del ESC/POS por cable y estás dispuesto
  a cambiar el driver (§2).

Bluetooth y WebUSB exigen **contexto seguro**: HTTPS o `localhost`. En
`http://<ip-de-la-lan>:8080` no funcionan, igual que la geolocalización. En iOS
no existe ninguna de las dos — ahí queda la impresión por Windows o WhatsApp.

Bluetooth y USB comparten el formato del ticket (`construirRecibo` de
[src/lib/escpos.ts](src/lib/escpos.ts)); la impresión por Windows arma su propio
HTML, porque ahí el ESC/POS lo genera el driver.

---

## 1. El error de Windows con la impresora USB

> **"Windows tiene tomada la impresora con su propio driver."**

Es el error más común y **no es un bug de la app**. Pasa así:

Cuando conectás una térmica por USB, Windows la reclama automáticamente con su
driver de impresión (`usbprint.sys`) para que aparezca en *Dispositivos e
impresoras*. WebUSB necesita **tomar la interfaz USB en exclusiva**, y el
sistema operativo no permite que dos drivers reclamen la misma interfaz: Chrome
llama a `claimInterface()` y recibe *"Access denied"*.

En Android y Linux normalmente no pasa, porque no hay un driver de impresión
peleando por el dispositivo.

### Hay tres salidas

**A. Usar el botón "Impresora instalada en Windows"** — la más simple, y la que
resuelve el problema sin tocar nada. Imprime por el driver que Windows ya tiene
instalado, así que la impresora sigue funcionando normalmente para el resto de
los programas. **Empezá por acá.** Si anda, ignorá todo lo que sigue.

**B. Usar Bluetooth** — para el cobrador en la calle, con el celular. Manda los
bytes ESC/POS directo, sin diálogo de impresión.

**C. Reemplazar el driver por WinUSB con Zadig** — solo si necesitás WebUSB
específicamente (control fino del ESC/POS por cable) y esa impresora no se usa
para nada más.

---

## 2. Cambiar el driver con Zadig

> ⚠ **Leé esto antes de correr Zadig.** Al reemplazar el driver, esa impresora
> **deja de existir como impresora de Windows**: no va a aparecer en *Dispositivos
> e impresoras* ni va a poder imprimir desde Word, el navegador o cualquier otro
> programa. Solo va a andar desde esta app, por WebUSB. Es reversible (§3), pero
> si esa misma impresora se usa para otra cosa, **no lo hagas** — usá Bluetooth.

Requiere **permisos de administrador** en la PC.

1. Descargar Zadig de <https://zadig.akeo.ie/> (es un `.exe` suelto, no se instala).
2. Conectar la impresora y encenderla.
3. Abrir Zadig **como administrador**.
4. Menú **Options → List All Devices**.
5. En la lista desplegable, elegir **la impresora térmica**. Suele figurar como
   *POS-58*, *POS-80*, *Printer* o el modelo que tenga.

   > Asegurate de que sea la impresora y no otro dispositivo. Si le cambiás el
   > driver al teclado o al mouse, dejan de andar. Verificá el nombre.

6. A la derecha de la flecha verde, elegir **WinUSB**.
7. Apretar **Replace Driver** y esperar (puede tardar medio minuto).
8. Desconectar y volver a conectar la impresora.
9. Recargar la app y probar *Original USB*.

---

## 3. Volver atrás (que vuelva a ser impresora de Windows)

1. Abrir el **Administrador de dispositivos** (clic derecho en Inicio).
2. Buscar la impresora — con WinUSB queda bajo *Universal Serial Bus devices*.
3. Clic derecho → **Desinstalar el dispositivo**, y tildar
   *"Intentar quitar el controlador"*.
4. Desconectar y volver a conectar la impresora: Windows reinstala `usbprint.sys` solo.

---

## 4. Otros mensajes que puede dar la impresión USB

| Mensaje | Qué pasa | Qué hacer |
| --- | --- | --- |
| *"Windows tiene tomada la impresora…"* | `usbprint.sys` reclamó la interfaz | Usar **"Impresora instalada en Windows"** (§1.A) |
| *"Este navegador no soporta WebUSB"* | Firefox o Safari | Usar Chrome o Edge |
| *"Tocá el botón de nuevo…"* | WebUSB exige un gesto del usuario | Volver a tocar el botón |
| *"Ese dispositivo no parece una impresora"* | Se eligió otro dispositivo en el selector | *¿No aparece la impresora? Elegir otra* |
| La impresora no figura en el selector | Las térmicas clonadas no declaran la clase 7 de USB | *¿No aparece la impresora? Elegir otra* — abre el selector sin filtro |

El link **"¿No aparece la impresora? Elegir otra"** de la pantalla del recibo
suelta la impresora guardada y vuelve a abrir el selector **sin el filtro de
clase 7**. Es el escape para los dos casos de la tabla que dejan al cobrador
trabado.

---

## Ver también

- [src/lib/escpos.ts](src/lib/escpos.ts) — el formato del ticket ESC/POS y el
  transporte Bluetooth. El formato **no está duplicado**: `escpos-usb.ts` lo importa.
- [src/lib/escpos-usb.ts](src/lib/escpos-usb.ts) — el transporte USB.
- [src/lib/recibo-sistema.ts](src/lib/recibo-sistema.ts) — la impresión por el
  driver del sistema (HTML + `window.print()`), la vía que no configura nada.
- [src/components/recibo-acciones.tsx](src/components/recibo-acciones.tsx) — los
  botones de la pantalla del recibo.
