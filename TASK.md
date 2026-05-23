# TASK.md

Tarea actual. Solo la activa. Cuando se cierre, reemplazar contenido.

## Tarea: Refactor financiero — Etapa 2 (UI Fondos)

### Estado de etapas

| Etapa | Scope | Estado |
|---|---|---|
| 0 | Diagnóstico + plan corto | ✅ Cerrada |
| 1 | DB / Migración | ✅ Aplicada y validada |
| 2A | UI Fondos read-only | ✅ Cerrada |
| **2B** | **Alta de socios + financiadores (UI + actions + SQL socios.codigo)** | ✅ **SQL aplicado. Crear socio funciona con SOC-001. Crear financiador con FIN-001.** |
| **2C** | **Registrar aporte a RISA / cancelar financiación (UI + RPC)** | 🟡 **Código pusheado. SQL del RPC `registrar_aporte_socio` PENDIENTE de aplicar.** |
| 2D | Refinamientos visuales y validaciones extra | ⏸ pendiente |
| 3 | UI Gastos — `forma_cancelacion` + selector financiador | ⏸ pendiente |
| 4 | UI Pagos — confirmar con RISA vs financiador | ⏸ pendiente |
| 5 | Anulaciones / reversas | ⏸ pendiente |

### SQL pendiente inmediato (bloqueante para 2C)

```sql
CREATE OR REPLACE FUNCTION public.registrar_aporte_socio(
  p_fecha date,
  p_socio_id uuid,
  p_importe numeric,
  p_moneda text,
  p_destino_aporte text,
  p_financiador_id uuid DEFAULT NULL,
  p_observaciones text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$...$$;

REVOKE ALL ON FUNCTION public.registrar_aporte_socio(...) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_aporte_socio(...) TO authenticated;
NOTIFY pgrst, 'reload schema';
```

**Hasta aplicarlo, el modal "Nuevo aporte" muestra error "function does not exist". La página NO rompe (ActionResult).**

El SQL completo de este RPC está en el mensaje del chat (Etapa 2 commit `4a0788c`, sección "PASO 1 — SQL → C").

### Códigos funcionales activos

| Entidad | Formato | Estado SQL | Estado UI |
|---|---|---|---|
| Fondos | `FON-001` | ✅ | ✅ visible en card RISA |
| Aportes | `APO-001` | ✅ trigger listo | ⏸ visible una vez creado el primer aporte (depende del RPC pendiente) |
| Socios | `SOC-001` | ✅ aplicado en Etapa 2B | ✅ visible en tabla Socios + selectores |
| Financiadores | `FIN-001` | ✅ | ✅ visible en tabla Financiadores + selectores |
| Gastos | `G000001` | ⚠️ SQL pendiente (commit `9872748`) | — |
| Pagos | `P000001` | ⚠️ SQL pendiente (commit `9872748`) | — |

### Done definition de Etapa 2C (cuando se aplique RPC)

- [ ] SQL del RPC `registrar_aporte_socio` aplicado en Supabase
- [ ] Crear aporte destino RISA → saldo sube, codigo APO-001, movimiento aparece en cuenta corriente
- [ ] Crear aporte destino cancelación → saldo RISA no se toca, movimiento aparece en financiación pendiente con tipo `cancelacion_por_aporte`
- [ ] Bloqueo cuando importe > saldo pendiente con financiador
- [ ] Mensaje claro cuando no hay deuda con ningún financiador

### Restricciones de scope (siguen aplicando)

- NO avanzar a Gastos (Etapa 3) hasta cerrar 2C
- NO tocar UI de gastos/pagos/proveedores
- NO usar service_role
- NO desactivar RLS
- Commits de docs operativos permitidos

### Siguiente paso

1. **El usuario aplica el SQL del RPC `registrar_aporte_socio`** (queda en el chat)
2. Probar modal "Nuevo aporte" → APO-001 + saldo correcto
3. Confirmar y cerrar Etapa 2C
4. Entonces planificar 2D o saltar a Etapa 3 (Gastos)
