# TASK.md

Tarea actual. Solo la activa. Cuando se cierre, reemplazar contenido (no acumular historial).

## Tarea: Refactor financiero — RISA único + financiadores externos

### Modelo nuevo

- Un solo fondo operativo: **RISA** (`codigo = 'FON-001'`)
- RISA puede quedar con saldo negativo
- Gastos se cancelan con RISA o con un financiador externo
- Aportes de socios pueden fondear RISA o cancelar financiación pendiente
- Cuenta corriente de financiación por financiador

### Etapas planeadas

| Etapa | Scope | Estado |
|---|---|---|
| 0 | Diagnóstico + plan corto | ✅ Cerrada |
| **1** | **SQL DB: tablas + columnas + triggers + policies + RISA inicial** | **🟡 SQL entregado, esperando revisión y aplicación** |
| 2 | UI Fondos — resumen RISA, aportes, financiadores, cuentas corrientes | ⏸ pendiente |
| 3 | UI Gastos — campo `forma_cancelacion` + selector financiador + alta rápida | ⏸ pendiente |
| 4 | UI Pagos — confirmar con RISA vs financiador, RPCs nuevas | ⏸ pendiente |
| 5 | Anulaciones / reversas | ⏸ pendiente |

### Done definition de Etapa 1

- [x] SQL idempotente entregado (no aplicado)
- [x] Cubre las 11 secciones del spec
- [x] Detección segura de constraints de saldo antes del DROP
- [x] Policies RLS para 3 tablas nuevas
- [ ] Usuario aplica en Supabase
- [ ] Outputs de validación confirmados (9 SELECTs del Paso 2)
- [ ] Decisiones D14 + D15 documentadas

### Restricciones de scope (literal del usuario)

- NO aplicar SQL automáticamente
- NO modificar código TS en esta etapa
- NO tocar UI (FondosClient / GastosClient / PagosClient)
- NO commits de código funcional hasta Etapa 2+
- Commits de docs operativos permitidos
- No tocar proveedores, profiles, users
- No usar service_role
- No desactivar RLS

### Siguiente tarea sugerida

Etapa 2 (UI Fondos) cuando Etapa 1 esté aplicada y verificada. Antes de arrancar Etapa 2, confirmar conmigo el alcance específico de FondosClient overhaul.
