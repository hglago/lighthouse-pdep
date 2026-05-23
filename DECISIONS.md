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
