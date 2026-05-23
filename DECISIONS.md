# DECISIONS.md

Decisiones funcionales cerradas. Cada decisión incluye **qué**, **por qué** y **cuándo aplicar**. No revisitar a menos que cambien las premisas.

---

## D1. ActionResult en lugar de throw

**Qué**: Todas las server actions destructivas o sensibles devuelven
`{ ok: true } | { ok: false; error: string }`.

**Por qué**: En Next 14 App Router, `throw new Error()` en una server action escapa al boundary global y muestra el error overlay sin layout. Esto rompía visualmente la pantalla cada vez que la action fallaba (ej: RLS rejection en delete).

**Cuándo aplicar**: en toda action que pueda fallar por RLS, validación de negocio, o trigger DB.

---

## D2. SECURITY DEFINER RPC para soft-delete

**Qué**: Cuando RLS bloquea inexplicablemente un UPDATE de soft-delete (aunque las policies parezcan correctas y la sesión esté OK), migrar la acción a una función SQL `SECURITY DEFINER` con validación explícita de `auth.uid()` + lógica de negocio.

**Por qué**: Vimos en Proveedores y Fondos que `USING(true) WITH CHECK(true)` no era suficiente — había algún trigger / policy oculta / interacción que bloqueaba. La RPC SECURITY DEFINER corre con privilegios del owner (no del caller) y bypasea esa capa.

**Cuándo aplicar**: si después de:
- confirmar policies vía `pg_policies`
- verificar sesión (auth.uid() llega)
- chequear triggers

…el UPDATE/DELETE sigue fallando. NO usar como atajo sin diagnóstico previo.

**Patrón**: ver `RLS_RPC.md` sección "RPC SECURITY DEFINER".

---

## D3. Baja lógica, nunca DELETE físico

**Qué**: Proveedores, Fondos, Gastos, Pagos nunca se eliminan físicamente. Usan `deleted_at` (soft) o `estado='anulado'` (cuando hay reversa financiera).

**Por qué**: Trazabilidad. Reportes históricos deben mostrar movimientos pasados aunque la entidad esté inactiva.

**UI labels**:
- Proveedor / Fondo: "Dar de baja"
- Gasto / Pago: "Anular"

**Cuándo aplicar**: cualquier acción destructiva sobre entidades financieras.

---

## D4. SELECTs tolerantes en pages

**Qué**: Cuando un page.tsx selecciona una columna que puede no existir en DB todavía (migración pendiente), implementar retry sin esa columna en lugar de crashear.

**Patrón**:
```typescript
if (result.error?.code === '42703' && message.includes('columna_nueva')) {
  const fallback = await select(/* sin columna nueva */)
  data = (fallback.data ?? []).map(r => ({ ...r, columna_nueva: defaultValue }))
}
```

**Por qué**: El SQL se entrega al usuario pero no se aplica automáticamente. Si el código asume la migración aplicada, el listado se rompe hasta que el usuario corra el SQL. El SELECT tolerante hace que el listado funcione siempre.

**Cuándo aplicar**: en cualquier `page.tsx` que pida columnas agregadas por migración reciente.

---

## D5. SQL idempotente

**Qué**: Todo SQL entregable al usuario debe usar `IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP IF EXISTS … ADD/CREATE`. Envuelto en `BEGIN…COMMIT` cuando hace mutaciones múltiples.

**Por qué**: El usuario puede correr el mismo bloque dos veces sin querer. Idempotencia evita errores y permite re-aplicar después de un rollback parcial.

---

## D6. No `npm run build` durante `npm run dev`

**Qué**: Nunca correr `npm run build` mientras el dev server está activo. Solo `npx tsc --noEmit` para validación de tipos durante una sesión.

**Por qué**: `build` pisa los chunks de `.next/` que el dev server tiene referenciados. Resultado: chunks 404 → CSS no carga → UI se ve plana ("PD, PDEP, Gestión de Fondos" sin formato + íconos gigantes).

**Recovery**: `taskkill /F /IM node.exe` → `rm -rf .next` → `npm run dev`.

---

## D7. Eliminación del flujo "Borrador" para gastos y pagos

**Qué**: Gastos nacen como `enviado` (pendientes de aprobación), no `borrador`. Pagos se crean ya `pagado` (atómico create+confirm), no `borrador`.

**Por qué**: El borrador era un paso intermedio confuso. La UX simplificada evita pagos huérfanos y dups.

**Excepción**: legacy borradores (creados antes de esta decisión) siguen funcionando y la UI los respeta. Los nuevos no se crean en ese estado.

---

## D8. Identificadores funcionales G/P por sequence + trigger DB

**Qué**: Cada gasto recibe `codigo = 'G' || LPAD(nextval, 6, '0')` y cada pago `codigo = 'P' || …`. Trigger BEFORE INSERT en DB.

**Por qué**: UUID es PK estable pero ilegible. El codigo es para humanos y reportes.

**Patrón extensible**: F/A/H/PR para Fondos / Anticipos / Honorarios / Proveedores. Plantillas en `DB.md`.

---

## D9. DataTable reutilizable

**Qué**: `src/components/DataTable.tsx` provee tabla con selection + sort + per-column filter + bulk actions. Se usa en Fondos y Proveedores. Pagos y Gastos todavía usan `SortableHeader` directo (no migrado por celdas custom).

**Por qué**: Consistencia operativa. Filtros por columna sin librerías nuevas.

**Cuándo migrar Gastos/Pagos**: cuando se quiera unificar; requiere portar render functions de las celdas custom (badges, comprobante icon, etc.).

---

## D10. Uplift en Proveedores: NO afecta importes originales

**Qué**: Proveedor puede tener `tiene_uplift=true` y `porcentaje_uplift=X`. Pero el importe del gasto/honorario se carga por el valor real presentado, no incrementado.

**Por qué**: El uplift se aplica solo en informes / rendiciones futuras. La trazabilidad del importe original queda intacta.

**Helper**: `src/lib/uplift.ts` con `aplicarUplift()` y `desglosarUplift()`.

---

## D11. Cuenta corriente entre fondos (estructura)

**Qué**: Cuando fondo A paga por cuenta de fondo B, se generan:
- pago con `fondo_pagador_id = A`, `fondo_responsable_id = B`, `genera_deuda_interna = true`
- registro en `movimientos_entre_fondos` (tipo='deuda_generada')

Reintegro genera otro registro con tipo='cancelacion'.

**View**: `v_cuenta_corriente_fondos` agrupa por (deudor, acreedor, moneda) y muestra `saldo_pendiente`.

**Estado**: Etapa 1 (read-only display) implementada. Etapas 2 (UI dual selector) y 3 (reintegros UI) pendientes.

---

## D12. Reset operativo sin tocar maestros

**Qué**: Procedimiento de reset borra fondos, gastos, pagos, movimientos, aportes, anticipos. NO borra proveedores, profiles, users, gastos_recurrentes (definiciones).

**Patrón**: `DELETE FROM` en orden de dependencia (hijos → padres) con `to_regclass` defensivo. Disable temporal de `fn_pagos_hardening`. Reset de secuencias de codigo.

**Ver**: `/safe-db-migration` para el bloque completo.

---

## D13. Convención de respuesta cuando user da spec grande

**Qué**: Si la spec impacta > 2 archivos o introduce SQL no trivial, **preguntar con AskUserQuestion** antes de meter mano. Ofrecer etapas A/B/C.

**Por qué**: Sesiones largas consumen contexto. Mejor entregar etapa estable que dejar 3 etapas a medias.

---

## D14. Deprecación del modelo de cuenta corriente entre fondos

**Qué**: El modelo de "varios fondos internos con deudas entre sí" introducido en commit `f66325b` (`fondo_pagador_id`, `fondo_responsable_id`, `genera_deuda_interna`, `deuda_interna_id`, tabla `movimientos_entre_fondos`, view `v_cuenta_corriente_fondos`) queda **deprecado y NO se debe aplicar**.

**Por qué**: La realidad funcional es que **hay un solo fondo operativo (RISA)** y las deudas son con **terceros externos** (financiadores), no entre fondos internos. El modelo nuevo (D15+) cubre esto correctamente.

**Cuándo aplicar**:
- ❌ No aplicar la SQL de la migración `f66325b`
- ✅ El código TS tolerante existente queda inerte si la columna no está en DB
- ✅ Si en el futuro vuelve a existir un caso de múltiples fondos internos, retomar como punto de partida

---

## D15. socio_id como FK principal en aportes_fondo, aportante text legacy

**Qué**: La columna `aportes_fondo.aportante` (text libre) se conserva como legacy. La nueva relación es `aportes_fondo.socio_id` que apunta a `socios(id)`. La UI nueva usa `socio_id`. El text `aportante` puede dejarse en `null` o como display name secundario.

**Por qué**:
- Trazabilidad: poder agrupar aportes por socio (mismo `socio_id` para múltiples aportes)
- Soft-delete de socio sin perder historia
- Si el aporte se hace con propósito de cancelar financiación, vincular al financiador via `financiador_id`

**Cuándo aplicar**:
- Reset operativo de 2026-05-23 ya borró aportes históricos, así que no hay backfill destructivo
- UI nueva siempre debe crear o seleccionar un socio
- No remover `aportante` text en esta sesión; puede deprecarse en una iteración futura

---

## D16. RISA único + financiadores externos como modelo financiero

**Qué**: Hay un único fondo operativo (RISA, `codigo='FON-001'`). Los gastos se cancelan con RISA (afecta saldo) o con un financiador (genera deuda en `movimientos_financiacion`). Los aportes de socios fondean RISA o cancelan financiación pendiente con un financiador específico.

**Por qué**: Modelo realista para el caso operativo actual. Más simple que múltiples fondos, más expresivo que un solo fondo plano.

**Reglas**:
- RISA puede tener saldo negativo. No hay validación SQL ni frontend de "saldo >= 0".
- Cancelación con RISA: baja el saldo de RISA, genera movimiento en `movimientos_fondo`.
- Cancelación con financiador: NO baja saldo RISA, genera `movimientos_financiacion` tipo `'deuda_generada'`.
- Aporte a RISA: sube saldo RISA, genera movimiento en `movimientos_fondo`.
- Aporte para cancelar financiación: NO toca RISA, genera `movimientos_financiacion` tipo `'cancelacion_por_aporte'`.

**Terminología obligatoria en UI**:
- ✅ "Financiador", "Fuente de financiación", "Cancelado por financiador", "Cuenta corriente de financiación", "Financiación pendiente"
- ❌ NO usar "Prestamista", "Préstamo" en UI (puede aparecer en comentarios internos)

**Estado de implementación**:
- Etapa 1 (schema DB): ✅ aplicado 2026-05-23. Schema operativo del nuevo modelo en producción
- Etapa 2 (UI Fondos): ✅ 2A, 2B, 2C cerradas. 2D en curso.
- Etapa 3 (UI Gastos con `forma_cancelacion`): pendiente
- Etapa 4 (Pagos con rama RISA vs financiador): pendiente
- Etapa 5 (anulaciones / reversas): pendiente

---

## D18. Todo listado debe mostrar Código o N° transacción (no UUID)

**Qué**: Todo registro maestro u operativo debe tener un identificador funcional visible. Las entidades maestras muestran **"Código"**. Las operaciones financieras muestran **"N° transacción"**. Los UUID quedan como identificadores internos y no deben mostrarse como referencia principal en UI, exports ni informes.

**Por qué**: Los UUIDs son ilegibles para humanos y no preservan orden. Los códigos funcionales son legibles, ordenables, búsquedables, y consistentes entre UI, exports, PDFs y reportes.

**Convención por entidad**:

| Entidad | Tipo | Etiqueta UI | Formato | Tabla.columna |
|---|---|---|---|---|
| Fondo | Maestra | "Código" | `FON-001` | `fondos.codigo` |
| Socio | Maestra | "Código" | `SOC-001` | `socios.codigo` |
| Financiador | Maestra | "Código" | `FIN-001` | `financiadores.codigo` |
| Proveedor (futuro) | Maestra | "Código" | `PRV-001` | `proveedores.codigo` (no implementado) |
| Aporte | Operativa | "N° transacción" | `APO-001` | `aportes_fondo.codigo` |
| Gasto | Operativa | "N° transacción" | `G000001` | `gastos.codigo` |
| Pago | Operativa | "N° transacción" | `P000001` | `pagos.codigo` |
| Anticipo (futuro) | Operativa | "N° transacción" | `ANT-001` | `anticipos.codigo` (no implementado) |
| Honorario (futuro) | Operativa | "N° transacción" | `HON-001` | (no implementado) |
| Rendición (futuro) | Operativa | "N° transacción" | `REN-001` | (no implementado) |
| Ajuste (futuro) | Operativa | "N° transacción" | `AJU-001` | (no implementado) |

**Reglas operativas**:
- El código lo genera la DB via trigger `BEFORE INSERT` cuando `NEW.codigo IS NULL`. El frontend nunca calcula codigos ni envía valores manuales.
- Toda tabla operativa debe tener como **primera columna** el código/N° transacción.
- Toda tabla debe permitir ordenar y buscar por el código.
- En cuenta corriente RISA, cada movimiento debe mostrar la **referencia** al N° transacción que lo generó:
  - Movimiento por aporte → `APO-###` via `movimientos_fondo.aporte_id → aportes_fondo.codigo`
  - Movimiento por pago → `P######` via `movimientos_fondo.pago_id → pagos.codigo` (cuando Etapa 4)
- En `movimientos_financiacion`, idem con `aporte_id` o `pago_id`.
- En exports/informes/PDFs, **nunca** usar UUID como referencia principal visible.
- En messages de éxito post-creación, mostrar el codigo: `"Aporte APO-001 registrado correctamente."`

**Cuándo aplicar**: en cualquier nueva tabla de listado y en cualquier exportación. Aplicable inmediatamente a /fondos en Etapa 2D. A extender a /gastos en Etapa 3 y /pagos en Etapa 4.

---

## D19. Todos los listados deben tener búsqueda, filtros y ordenamiento

**Qué**: Todo listado operativo o maestro debe incluir:
1. **Código** o **N° transacción** como primera columna (per D18)
2. **Input de búsqueda general** (placeholder `"Buscar…"`) que mira los campos más relevantes
3. **Filtros por columna** (texto contiene / número rango / fecha rango / enum multi-select) accesibles vía ícono en el header
4. **Ordenamiento** click-to-sort sobre las columnas relevantes (asc → desc → none)
5. **Botón "Limpiar filtros"** cuando hay filtros activos
6. **Empty states diferenciados**:
   - Sin datos en absoluto: `"No hay X registrados."`
   - Con datos pero filtros sin match: `"No hay X que coincidan con los filtros."`

**Por qué**: Consistencia operativa entre módulos. UX predecible. Datos navegables sin tener que recordar UUIDs ni filtros externos.

**Cómo aplicar**: usar el componente `src/components/DataTable.tsx` (ya existente y probado). Incluye todos los requisitos arriba. La búsqueda general se pasa externamente (`searchTerm` + `searchKeys`). Los filtros por columna se manejan internamente por DataTable.

**Patrón mínimo**:

```tsx
const [search, setSearch] = useState('')
const columns: Column<T>[] = [
  { key: 'codigo', label: 'N° transacción', accessor: r => r.codigo ?? '', type: 'text' },
  { key: 'fecha',  label: 'Fecha',          accessor: r => r.fecha,        type: 'date' },
  { key: 'monto',  label: 'Importe',        accessor: r => r.monto,        type: 'number', align: 'right' },
  // ...
]

<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…" />
<DataTable
  rows={rows}
  columns={columns}
  getRowId={r => r.id}
  searchTerm={search}
  searchKeys={['codigo', 'fecha', ...]}
  initialSort={{ key: 'codigo', dir: 'desc' }}
  emptyMessage={
    rows.length === 0
      ? 'No hay X registrados.'
      : 'No hay X que coincidan con los filtros.'
  }
/>
```

**Estado de aplicación por módulo**:

| Módulo | Estado | Etapa |
|---|---|---|
| Fondos (5 tablas: aportes, cuenta corriente RISA, socios, financiadores, financiación pendiente) | ✅ Aplicado | F1 (cerrada) |
| Proveedores | ✅ Parcial (ya usa DataTable desde el refactor previo) | F2 (pendiente revisar) |
| Gastos | ⏸ Pendiente | F3 |
| Pagos | ⏸ Pendiente | F4 |
| Anticipos, Honorarios, Rendiciones | ⏸ Pendiente (si existen los módulos) | F5 |

**Cuándo NO aplicar**: en cuentas legacy / tablas administrativas one-off donde el costo no se justifica. Documentar la excepción.

---

## D20. Versionado de hitos estables

**Qué**: Cada punto estable funcional debe cerrarse con (a) documentación actualizada en los .md operativos, (b) commit en main, y (c) **tag Git anotado** con mensaje descriptivo. El tag permite volver al estado anterior antes de implementar etapas de mayor riesgo.

**Por qué**: En refactors largos (Etapas 1, 2A–2D, F1, etc.) es difícil volver atrás si una etapa rompe algo. Los tags permiten un punto de retorno rápido. La documentación in-place asegura que cualquier futuro contributor entienda qué incluye cada hito.

**Convención**: `vMAJOR.MINOR.PATCH-<scope>`. Ej: `v0.2.0-risa-fondos`, `v0.3.0-gastos`, `v0.4.0-pagos`.

**Procedimiento al cerrar un hito**:
1. Confirmar working tree limpio (`git status`)
2. Actualizar `CONTEXT.md`, `TASK.md`, `DB.md`, `RLS_RPC.md`, `DECISIONS.md` y `TESTING.md` según corresponda
3. Crear/actualizar entrada en `RELEASES.md` con incluido + pendiente + cómo volver
4. Validar: `npx tsc --noEmit` + `npm run build`
5. Commit de docs si hubo cambios
6. Tag anotado: `git tag -a vX.Y.Z-scope -m "vX.Y.Z-scope: <hito>"`
7. Push del commit + push del tag: `git push && git push origin vX.Y.Z-scope`

**Importante**: los tags Git **no incluyen estado de Supabase**. Si se aplicaron migraciones SQL después del tag y se quiere revertir, hay que revertir esas migraciones manualmente. La sección "SQL aplicado al momento del tag" en `RELEASES.md` documenta el estado de DB al crear cada tag.

**Frecuencia recomendada**: tag al cerrar cada etapa significativa o cada vez que el sistema queda en un estado funcional consistente del que vale la pena poder volver.

---

## D21. Honorarios deprecado operativamente — todo se carga como Gasto

**Qué**: El módulo "Honorarios" deja de ser operativo. Los honorarios profesionales se cargan como **Gasto** asociado a un proveedor que tenga `permite_horas_servicio = true`. La tabla `honorarios` nunca existió en DB y no se crea. La ruta `/honorarios` queda como página informativa.

**Por qué**: Honorarios era un placeholder ("Módulo en desarrollo") sin schema ni lógica. Unificar bajo Gastos diferenciando por tipo de proveedor evita duplicar: alta de proveedor, ciclo de aprobación, anticipos, comprobantes, pagos, recurrentes. El "servicio por hora" es solo una variante del gasto.

**Cuándo aplicar**:
- ✅ Cargar todo honorario como Gasto con proveedor que tenga `permite_horas_servicio=true` y `valor_hora>0`.
- ✅ La página `/honorarios` queda viva con mensaje "Módulo deprecado — los honorarios ahora se cargan como Gasto. → Ir a Gastos" (P4 a implementar).
- ❌ NO eliminar la ruta físicamente, NO eliminar la entrada del middleware ni los permisos (`honorarios:write`/`honorarios:read`) — quedan inertes pero presentes por simetría histórica.
- ❌ NO crear tabla `honorarios` en DB.

**Estado**: schema P1 aplicado 2026-05-23 (`proveedores.permite_horas_servicio`, `proveedores.valor_hora`, snapshot en `gastos` y `gastos_recurrentes`). UI P2-P3 pendiente. P4 (deprecación visual de `/honorarios`) pendiente.

---

## D22. Uplift es informativo — no modifica gasto, pago, fondo ni deuda

**Qué**: `proveedores.tiene_uplift` + `proveedores.porcentaje_uplift` y su snapshot por gasto (`gastos.porcentaje_uplift_snapshot`, ídem en `gastos_recurrentes`) son **datos informativos** para futura liquidación / rendición a socios. NO modifican ningún importe operativo del sistema.

**Reglas explícitas**:
- ✅ Importe del gasto = `importe_base_servicio` cuando `es_servicio_horas=true`, o `monto` directo cuando es gasto común. **Sin uplift sumado.**
- ✅ Importe del pago = importe del gasto. **Sin uplift sumado.**
- ✅ Saldo del fondo RISA se afecta por el importe del pago. **Sin uplift sumado.**
- ✅ Deuda con financiador en `movimientos_financiacion` se genera por el importe del pago. **Sin uplift sumado.**
- ✅ Liquidación futura a socios (no implementada): se calculará `importe_liquidacion = importe_base × (1 + porcentaje_uplift_snapshot / 100)` en informes / vistas dedicadas, sin modificar columnas existentes.

**Por qué**: El uplift es un margen contractual para retribución a socios, no un costo del proveedor. Si se sumara al gasto se desvirtuaría el balance operativo y la trazabilidad del importe pagado realmente.

**Snapshot histórico**: Al crear/editar un gasto de servicio, se snapshotea `porcentaje_uplift_snapshot` del proveedor en ese momento. Si el proveedor cambia su `porcentaje_uplift` después, los gastos viejos conservan el snapshot. Esto preserva la base de liquidación al momento en que se prestó el servicio.

**Helpers existentes**: `src/lib/uplift.ts` provee `aplicarUplift()` y `desglosarUplift()` para reportes futuros — no usar en flujo operativo de gastos/pagos/fondos.

---

## D23. Gastos recurrentes con servicio por hora copian snapshot al gasto generado

**Qué**: Cuando un `gastos_recurrentes` tiene `es_servicio_horas=true`, mantiene un snapshot completo de servicio (`descripcion_servicio`, `horas_servicio`, `valor_hora_aplicado`, `porcentaje_uplift_snapshot`, `importe_base_servicio`). La función generadora `fn_generar_gastos_recurrentes()` debe **copiar** ese snapshot al gasto del mes generado, no leer en vivo del proveedor.

**Por qué**: Preservar historia. Si el proveedor cambia `valor_hora` después de marzo, el gasto recurrente generado en marzo debe conservar el `valor_hora_aplicado` que tenía marzo, no el actual. Esto es coherente con D22 (snapshot histórico).

**Período del servicio**: En el template recurrente NO se guarda `periodo_servicio_desde/hasta`. La función generadora calcula período = primer/último día del mes correspondiente. Si en el futuro algún proveedor presta servicio en un rango no calendario (ej. "del 15 al 14"), se agregará un campo `offset_desde`/`offset_hasta` en el template (cambio aditivo futuro, no incluido en P1).

**Estado de implementación**:
- ✅ P1 aplicado 2026-05-23: columnas snapshot en `gastos_recurrentes` con CHECK de coherencia.
- ⏸ P3 pendiente: extender `fn_generar_gastos_recurrentes()` para copiar snapshot + calcular período del mes. Hasta que se aplique P3, los recurrentes existentes (todos con `es_servicio_horas=false`) siguen funcionando exactamente igual.

**Riesgo**: si la función generadora se actualiza mal, gastos generados con snapshot inconsistente fallarían el CHECK `gastos_servicio_horas_coherente`. P3 incluirá pruebas antes de aplicar.

---
