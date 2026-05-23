# TASK.md

Tarea actual. Solo la activa. Cuando se cierre, reemplazar contenido (no acumular historial).

## Tarea: Refactor financiero — Etapa 2 (UI Fondos)

### Estado de etapas

| Etapa | Scope | Estado |
|---|---|---|
| 0 | Diagnóstico + plan corto | ✅ Cerrada |
| 1 | DB / Migración | ✅ **SQL aplicado y validado** |
| **2** | **UI Fondos — resumen RISA, aportes, financiadores, cuentas corrientes** | **🟡 Plan propuesto, esperando confirmación de scope** |
| 3 | UI Gastos — `forma_cancelacion` + selector financiador + alta rápida | ⏸ pendiente |
| 4 | UI Pagos — confirmar con RISA vs financiador, RPCs nuevas | ⏸ pendiente |
| 5 | Anulaciones / reversas | ⏸ pendiente |

### Etapa 1 — Cierre

Schema operativo del nuevo modelo financiero ya está en producción:

- ✅ Tablas: `socios`, `financiadores`, `movimientos_financiacion`
- ✅ Columnas: `fondos.codigo` + soft-delete; `aportes_fondo` con codigo/socio_id/destino_aporte/financiador_id; `gastos.forma_cancelacion` + financiador_id; `pagos.forma_cancelacion` + financiador_id + afecta_saldo_risa + movimiento_financiacion_id
- ✅ Sequences + triggers BEFORE INSERT para FON/APO/FIN
- ✅ View `v_saldos_financiadores` (incluye `financiador_deleted_at` — no filtra históricos)
- ✅ Policies RLS authenticated en las 3 tablas nuevas
- ✅ Constraint `fondos_saldo_no_negativo` eliminada — RISA puede quedar en saldo negativo
- ✅ RISA creada como `FON-001`, saldo 0, moneda ARS

### Etapa 2 — Scope propuesto (NO IMPLEMENTAR HASTA CONFIRMACIÓN)

UI del módulo Fondos rediseñada para reflejar el nuevo modelo:

#### A) Layout target (FondosClient.tsx)

1. **Resumen RISA** (card destacado arriba)
   - Codigo: `FON-001` (visible)
   - Nombre: RISA
   - Saldo actual (puede ser negativo, con color rojo si <0)
   - Total aportes de socios
   - Total egresos pagados con RISA
   - Total financiación pendiente (suma de saldos_pendientes en `v_saldos_financiadores`)

2. **Acciones rápidas**
   - "+ Nuevo aporte de socio" (modal)
   - "+ Nuevo financiador" (modal)
   - "Ver cuenta corriente RISA"
   - "Ver financiación pendiente"

3. **Sección "Cuenta corriente RISA"** (tabla)
   - Columnas: fecha, tipo, referencia, detalle, ingreso, egreso, saldo resultante
   - Fuente: `movimientos_fondo` filtrando por fondo RISA

4. **Sección "Financiación pendiente"** (tabla)
   - Columnas: codigo financiador, nombre, total deuda generada, cancelado, ajustes, saldo pendiente
   - Fuente: `v_saldos_financiadores`

5. **Sección "Aportes"** (tabla)
   - Columnas: codigo (APO-XXX), fecha, socio, destino, financiador (si aplica), importe, observaciones
   - Acción "Dar de baja aporte" (futuro, ahora no)

#### B) Componentes nuevos sugeridos

- `SocioSelect` + `SocioQuickCreateModal`
- `FinanciadorSelect` + `FinanciadorQuickCreateModal`
- Posiblemente extraer "Cuenta corriente RISA" como subcomponente

#### C) Server actions (en `fondos/actions.ts`)

- `crearSocio(payload)` — INSERT en socios; usa `created_by = auth.uid()`
- `crearFinanciador(payload)` — idem en financiadores
- `crearAporteSocio(payload)` — destino='risa' → INSERT aportes_fondo + INSERT movimiento_fondo + UPDATE saldo
  - destino='cancelacion_financiacion' → INSERT aportes_fondo + INSERT movimientos_financiacion (tipo='cancelacion_por_aporte')
  - **Validación**: importe ≤ saldo pendiente con ese financiador (bloquear excedente)
- `getDashboardRISA()` — devuelve todos los totales del card resumen

#### D) Decisión: ¿RPCs SECURITY DEFINER o server actions normales?

Para `crearAporteSocio` con destino `cancelacion_financiacion`, hay que crear 2 filas en 2 tablas con transacción. Si RLS bloquea (como pasó con Proveedores y Fondos), migrar a RPC SECURITY DEFINER. Patrón conocido: `/diagnose-rls`.

#### E) Tipos a agregar en `src/types/database.ts`

```ts
interface Socio { id, nombre, cuit, email, telefono, observaciones, deleted_at, created_by, created_at, updated_at }
interface Financiador { id, codigo, nombre, cuit, email, telefono, observaciones, deleted_at, created_by, created_at, updated_at }
type DestinoAporte = 'risa' | 'cancelacion_financiacion'
type TipoMovimientoFinanciacion = 'deuda_generada' | 'cancelacion_por_aporte' | 'ajuste' | 'reversa'
interface MovimientoFinanciacion { id, fecha, financiador_id, tipo_movimiento, importe, moneda, gasto_id, pago_id, aporte_id, socio_id, descripcion, created_by, created_at }
interface SaldoFinanciador { financiador_id, financiador_codigo, financiador_nombre, financiador_deleted_at, moneda, total_deuda_generada, total_cancelado, total_ajustes, total_reversas, saldo_pendiente }
```

### Restricciones de scope (siguen aplicando)

- NO implementar Etapa 2 hasta que confirmes scope
- NO tocar UI hasta confirmación
- NO tocar gastos/pagos/proveedores/profiles
- NO usar service_role en frontend
- NO desactivar RLS
- Commits de docs operativos permitidos

### Done definition de Etapa 2 (cuando arranque)

- [ ] Tipos en database.ts
- [ ] `fondos/actions.ts` extendido (4 actions nuevas)
- [ ] `FondosClient.tsx` rediseñado (5 secciones según layout target)
- [ ] Componentes nuevos: `SocioSelect`, `FinanciadorSelect`, modales quick-create
- [ ] Validación de exceso al cancelar financiación (importe ≤ saldo pendiente)
- [ ] `npx tsc --noEmit` clean
- [ ] Smoke test manual: crear socio, crear financiador, aportar a RISA, ver saldo subir
- [ ] Cuenta corriente refleja movimiento
- [ ] Commit + push

### Siguiente paso inmediato

Esperar confirmación del usuario sobre alcance Etapa 2. Cuando confirme, **proponer sub-etapas A/B/C dentro de Etapa 2** porque es grande (5 secciones UI + 4 actions + 4 componentes nuevos).
