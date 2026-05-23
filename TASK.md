# TASK.md

Tarea actual. Solo la activa. Cuando se cierre, reemplazar contenido.

## Tarea: ✅ Cerrado tag `v0.2.0-risa-fondos` — listo para Etapa 3 (UI Gastos)

### Hito recién cerrado

**v0.2.0-risa-fondos — Modelo RISA + Socios + Financiadores + Aportes** (commit `e6195fd`).

Ver `RELEASES.md` para el detalle completo de qué incluye y qué queda pendiente.

### Estado de etapas

| Etapa | Scope | Estado |
|---|---|---|
| 0 | Diagnóstico + plan corto | ✅ Cerrada |
| 1 | DB / Migración | ✅ Aplicada y validada |
| 2A | UI Fondos read-only | ✅ Cerrada |
| 2B | Alta de socios + financiadores | ✅ Cerrada |
| 2C | Registrar aporte (RPC) | ✅ Cerrada (rama RISA validada) |
| 2D | N° transacción + `movimientos_fondo.aporte_id` | ✅ Cerrada |
| F1 | Búsqueda + filtros + sort en /fondos | ✅ Cerrada |
| **🏁 TAG** | **v0.2.0-risa-fondos** | ✅ |
| 3 | UI Gastos — `forma_cancelacion` + selector financiador + alta rápida | ⏸ pendiente, **próximo** |
| 4 | UI Pagos — confirmar con RISA vs financiador | ⏸ pendiente |
| 5 | Anulaciones / reversas | ⏸ pendiente |
| F2 | Filtros en /proveedores | ⏸ pendiente |
| F3 | Filtros en /gastos | ⏸ pendiente (parte de Etapa 3) |
| F4 | Filtros en /pagos | ⏸ pendiente (parte de Etapa 4) |
| F5 | Filtros en módulos restantes | ⏸ pendiente |

### Próximo paso sugerido — Etapa 3 (UI Gastos)

Scope objetivo (a confirmar antes de implementar):
- Agregar selector "Forma de cancelación" en form de gasto (RISA / Financiador)
- Si Financiador: selector `FinanciadorSelect` con búsqueda + alta rápida via `FinanciadorQuickCreateModal`
- Persistir `gastos.forma_cancelacion` y `gastos.financiador_id` (columnas ya existentes en DB desde Etapa 1)
- Tabla de gastos: badge "RISA" o "Financiador: FIN-### Nombre"
- NO toca aún la lógica de pago (eso es Etapa 4)
- Aplicar D19 (filtros globales) a la tabla de gastos en el mismo movimiento (F3)

### Decisiones de scope a confirmar antes de Etapa 3

1. ¿Reemplazar el modal actual de gasto o crear uno nuevo paralelo?
2. ¿Aplicar Etapa 3 + F3 juntas en una sesión, o por separado?
3. ¿La tabla de gastos debe migrar a DataTable o mantener el SortableHeader actual + agregar input search/filtros adyacentes?

### Restricciones que siguen vigentes

- NO tocar Gastos / Pagos / Proveedores fuera del scope de su etapa
- NO aplicar migración vieja de cuenta corriente entre fondos (D14)
- NO usar service_role
- NO desactivar RLS
- NO usar palabra "Prestamista"
- Cierre cada hito con tag (D20)

### Volver al hito si algo se rompe en Etapa 3

```bash
git reset --hard v0.2.0-risa-fondos
```

Si se aplicaron migraciones SQL después del tag y rompen, ver `RELEASES.md` sección "SQL aplicado al momento del tag" para reconstruir el estado de Supabase.
