# TASK.md

Tarea actual. Solo la activa. Cuando se cierre, reemplazar contenido.

## Tarea: Refactor financiero — Etapa 2 cerrada (operación de Fondos completa)

### Estado de etapas

| Etapa | Scope | Estado |
|---|---|---|
| 0 | Diagnóstico + plan corto | ✅ Cerrada |
| 1 | DB / Migración | ✅ Aplicada y validada |
| 2A | UI Fondos read-only | ✅ Cerrada |
| 2B | Alta de socios + financiadores (UI + actions + SQL socios.codigo) | ✅ Cerrada — SOC-### + FIN-### funcionales |
| **2C** | **Registrar aporte (RPC `registrar_aporte_socio`)** | ✅ **Cerrada — destino RISA funcional. Validación de "cancelar financiación" pendiente de testeo real cuando exista deuda.** |
| 2D | Refinamientos visuales y validaciones extra (opcional) | ⏸ pendiente |
| 3 | UI Gastos — `forma_cancelacion` + selector financiador + alta rápida desde gasto | ⏸ pendiente |
| 4 | UI Pagos — confirmar con RISA vs financiador + RPCs nuevas | ⏸ pendiente |
| 5 | Anulaciones / reversas | ⏸ pendiente |

### Etapa 2C — Cierre

**Validado en producción**:
- Crear socio → SOC-001
- Crear financiador → FIN-001
- Registrar aporte destino RISA → APO-001 + saldo RISA actualizado + movimiento `credito` en cuenta corriente RISA + socio vinculado correctamente.

**Pendiente de testeo real** (no bloqueante para avanzar a Etapa 3):
- Registrar aporte destino `cancelacion_financiacion`. Requiere que exista deuda en `movimientos_financiacion` con `tipo_movimiento='deuda_generada'`, lo cual recién va a aparecer cuando se confirme el primer pago con financiador (Etapa 4). El RPC ya tiene la rama implementada y las validaciones (saldo pendiente > 0, importe ≤ saldo pendiente).

### Códigos funcionales — estado

| Entidad | Formato | Estado SQL | Estado UI |
|---|---|---|---|
| Fondos | `FON-001` | ✅ | ✅ visible en card RISA |
| Aportes | `APO-001` | ✅ | ✅ asignado automáticamente al registrar aporte |
| Socios | `SOC-001` | ✅ | ✅ visible en tabla + selectores |
| Financiadores | `FIN-001` | ✅ | ✅ visible en tabla + selectores |
| Gastos | `G000001` | ⚠️ SQL pendiente (commit `9872748`) | — |
| Pagos | `P000001` | ⚠️ SQL pendiente (commit `9872748`) | — |

### Restricciones que siguen vigentes

- NO tocar Gastos / Pagos / Proveedores / profiles
- NO aplicar migración vieja de cuenta corriente entre fondos (D14)
- NO usar service_role
- NO desactivar RLS
- NO usar palabra "Prestamista"

### Próximo paso sugerido

**Etapa 3 — UI Gastos**. Scope objetivo:
- Agregar selector "Forma de cancelación" en form de gasto (RISA / Financiador)
- Si Financiador: selector FinanciadorSelect + alta rápida con FinanciadorQuickCreateModal
- Persistir `gastos.forma_cancelacion` y `gastos.financiador_id` (columnas ya existentes en DB)
- Tabla de gastos muestra badge "RISA" o "Financiador: [nombre]"
- NO toca lógica de pago todavía (eso es Etapa 4)

Confirmá si arrancamos Etapa 3 o si querés cerrar primero algún pendiente de 2D.
