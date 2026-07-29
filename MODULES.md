# MODULES.md

Vista módulo por módulo. Para cada uno: archivos clave + comportamiento actual + dónde meter mano cuando hay que cambiar algo.

## Módulos en `src/app/(dashboard)/`

### `dashboard/`
Home post-login. Muestra widgets de fondos / gastos pendientes. Cambios mínimos en esta sesión.

---

### `fondos/`
- `page.tsx`: SELECT de fondos (filtro `activo` + `deleted_at IS NULL`) + aportes. Pasa todo a `FondosClient`.
- `FondosClient.tsx`: dos secciones (Fondos + Aportes). Fondos usa `DataTable`. Aportes usa SortableHeader (no migrado).
- `actions.ts`:
  - `createFondo` (con logs de diagnóstico RLS - cleanup pendiente)
  - `updateFondo`
  - `deleteFondo` (ActionResult, invoca RPC `soft_delete_fondo`)
  - `getFondoDependencies` (read-only, conteos + saldo)
  - `registrarAporte` (invoca RPC `fn_registrar_aporte`)

**Comportamiento**:
- "Dar de baja" valida saldo=0 antes de invocar RPC
- Aportes registran automáticamente movimiento + actualizan saldo

**Notas**:
- `createFondo` aún throw (legacy). Cuando se haga cleanup, migrar a ActionResult.
- Los logs `console.log("AUTH USER", ...)` y similares son temporales de diagnóstico RLS — pendiente cleanup (`/cleanup-logs`).

---

### `gastos/`
- `page.tsx`: SELECT con tolerancia para columna `codigo`. Llama `generarGastosRecurrentes()` al cargar (auto-gen mensual).
- `GastosClient.tsx`: tabla custom con `SortableHeader` + checkbox selection + bulk actions. NO usa DataTable todavía.
- `actions.ts`:
  - `createGasto` (estado='enviado' directo, sin borrador)
  - `updateGasto` (allow estado IN [borrador, enviado])
  - `deleteGasto` (soft via UPDATE deleted_at; legacy throw)
  - `cambiarEstadoGasto` (enviado/aprobado/rechazado)
  - `bulkAprobarGastos`, `bulkRechazarGastos`, `bulkDeleteGastos` (ActionResult con resumen procesados/errores)
  - `createGastoRecurrente`, `updateGastoRecurrente`, `deleteGastoRecurrente`
  - `setComprobanteGasto`, `removeComprobanteGasto` (Storage)
  - `generarGastosRecurrentes` (invoca RPC)
- `[id]/orden/` (2026-07-06): vista **imprimible** de la Orden de Gasto (server `page.tsx` + `PrintButton.tsx`). Detalle completo de solo lectura, incluidas observaciones (`notas`) y condiciones de pago. Print vía `.print-document` en `globals.css`. Se abre desde el ítem "Ver orden del gasto" del menú del ojo (todos los estados, pestaña nueva). No es snapshot: refleja el gasto en vivo.

**Comportamiento**:
- Nuevo gasto → `enviado` → admin/revisor lo aprueba → aparece en `/pagos` como obligación pendiente
- Comprobante editable mientras estado != pagado/rechazado
- Bulk: validations por estado de origen, retorna `{procesados, errores}`
- "Ver orden del gasto": disponible siempre (solo lectura); las acciones de escritura del menú siguen gateadas por rol.

**Notas**:
- "Eliminar" (label legacy) → debería ser "Anular" (Etapa B pendiente)
- Tabla con checkbox + sort + filtros minimales, falta filter por columna (DataTable no migrado)

---

### `pagos/`
- `page.tsx`: SELECT con tolerancia para `codigo` + columnas cuenta corriente.
- `PagosClient.tsx`: dos secciones (Obligaciones pendientes + Pagos registrados). Tabla con SortableHeader. Bulk confirm de borradores legacy.
- `actions.ts`:
  - `createPagoYConfirmar` (atómico: insert + validar saldo pendiente + RPC confirmar). ActionResult. **Reemplaza a `createPago` (no se usa más en UI).**
  - `updatePago` (para legacy borradores)
  - `confirmarPago` (RPC fn_confirmar_pago)
  - `anularPago` (RPC fn_anular_pago)
  - `confirmarPagosBulk` (loop server-side con validaciones)

**Comportamiento**:
- "+ Nuevo pago" o "Pagar" desde obligación → modal con UN solo botón "Registrar pago" → crea + confirma atómico
- Anti-dup borrador: si existe un borrador legacy con (gasto, tipo, monto) idénticos, bloquea con mensaje claro
- Anti-overpayment: valida `monto <= saldo_pendiente` antes de confirmar; si falla, rollback (DELETE del borrador transitorio)
- Pago cruzado (etapa 1 read-only): badge "⇄ Por cuenta de [fondo]" cuando `genera_deuda_interna=true`

**Notas**:
- Etapa 2 (dual selector pagador/responsable) pendiente
- "Anular" funciona pero copy podría mejorarse (Etapa C)

---

### `proveedores/`
- `page.tsx`: SELECT dos pasos (base + uplift opcional con fallback).
- `ProveedoresClient.tsx`: usa `DataTable` con columnas: Nombre, CUIT, Email, Teléfono, Uplift. Modal con checkbox + % uplift.
- `actions.ts`:
  - `createProveedor` (ActionResult, retry sin uplift si 42703)
  - `updateProveedor` (idem)
  - `createProveedorQuick` (desde modal de gastos; gateado admin/contador)
  - `deleteProveedor` (ActionResult, invoca RPC `soft_delete_proveedor`)
  - `getProveedorDependencies` (read-only, conteos)

**Comportamiento**:
- "Dar de baja": consulta deps, muestra confirm contextual, invoca RPC
- Soft-delete preserva nombre para historiales vía JOIN

---

### `gastos-recurrentes/`
Subruta de gastos. Listado de definiciones de recurrentes. CRUD básico.

---

### `reportes/`
Índice de informes (`page.tsx`), gateado a roles `admin`/`supervisor`/`socio`. Cards que linkean a cada informe.

- **Informe Dypsa** (`reportes/dypsa/`): informe ejecutivo de gastos pagados. Vista dinámica (pagos confirmados → gastos) + "Generar informe" numerado con snapshot (`reportes_dypsa` + `fn_generar_reporte_dypsa` + `reportes/dypsa/[id]`). `InformeDypsaClient.tsx` (vivo) + `InformeDypsaCongelado.tsx` (snapshot). Export Excel + PDF.
- **Informe de Aportes** (`reportes/aportes/`): **vivo** (sin SQL nuevo). `page.tsx` trae `aportes_fondo` activos (`deleted_at IS NULL`) con join `socios`/`financiadores` + `aporte_imputaciones` para derivar destino (RISA/Tercero/Mixto). `AportesReportClient.tsx` agrupa por socio con subtotal por moneda + total general. Filtros fecha/socio/moneda. Export Excel (Resumen + Detalle) + PDF (una sección por socio). SELECTs tolerantes: degrada si falta `socios.codigo` o `aporte_imputaciones`.

**Notas**:
- Aportes informa solo activos (los anulados quedan fuera, decisión de diseño 2026-07-06).
- La card "Cancelación de gastos" sigue como placeholder "Próximamente".

---

### `usuarios/`
Admin de usuarios. CRUD `profiles` + activar/desactivar.

---

### `honorarios/`, `rendiciones/`
Placeholders. No implementados todavía. Si el spec dice tocar acá: verificar que la tabla existe (probable que no).

---

### `auth/signout/`
Route handler que limpia cookies y redirige a `/login`. Necesario porque Server Components no pueden setear cookies.

## Componentes compartidos

### `src/components/DataTable.tsx`
Tabla reusable. Soporta:
- `columns`: array con `{ key, label, accessor, render?, type?, sortable?, filterable?, align?, className?, enumOptions? }`
- `selectable`: agrega columna checkbox con select-all + indeterminate
- `searchTerm` + `searchKeys`: search general controlado por padre
- `rowActions`: render prop
- `bulkActions`: render prop (toolbar arriba cuando hay selección)
- `onVisibleRowsChange`: callback útil para Excel export
- `initialSort`, `emptyMessage`

Tipos de columna: text (contiene), number (min/max), date (desde/hasta), enum (multi-select).

### `src/components/SortableHeader.tsx`
Header con click-to-sort (asc → desc → none). Usado en tablas que aún no migran a DataTable.

### `src/components/layout/`
`Sidebar`, `Header`, `DashboardShell`. No modificar salvo cambios específicos al menú.

## Helpers

- `src/lib/useSortable.ts` — hook de sort genérico
- `src/lib/uplift.ts` — `aplicarUplift`, `desglosarUplift`
- `src/lib/excel.ts` — `exportToExcel`, `todayForFile`
- `src/lib/supabase/{client,server,admin}.ts`
- `src/lib/auth/roles.ts`
