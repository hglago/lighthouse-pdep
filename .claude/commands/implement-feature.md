---
description: Flujo de delivery por etapas para features grandes
---

# /implement-feature

Patrón para implementar features que tocan > 2 archivos o introducen SQL. Evitar entregas a medias en sesiones largas.

## Antes de tocar nada

1. Leer el spec dos veces.
2. Hacer auditoría rápida del estado actual:
   - Tablas afectadas (`DB.md`)
   - Server actions existentes en el módulo
   - UI components afectados
   - RPCs / triggers relevantes
3. Identificar **scope mínimo shippable** vs **scope completo**.

## Decidir etapas (AskUserQuestion)

Si la implementación impacta:
- > 2 server actions, O
- > 1 tabla DB, O
- Requiere SQL de migración, O
- Toca un trigger conocido (`fn_pagos_hardening`)

→ **PRESENTAR ETAPAS al usuario antes de meter mano**.

Plantilla de pregunta:

```
Es un feature grande. Propongo etapas:

Etapa A: <foundational, lowest risk>
  - SQL: <columnas + RPC>
  - Code: <types + page tolerante + display>
  - Sin UI de mutación

Etapa B: <medium>
  - Code: <action de mutación + modal/form>
  - UI completa de creación

Etapa C: <highest>
  - <reintegros, reverse flow, etc.>

¿Qué etapa hacemos en esta sesión?
```

Opciones del AskUserQuestion deben incluir: "Etapa A sola" (recomendado), "A+B", "A+B+C", "solo diseño SQL sin código".

## Durante la implementación

### Patrones obligatorios

- **ActionResult** en toda action destructiva: `{ ok: true } | { ok: false; error: string }`
- **SELECT tolerante** si la columna nueva puede no estar en DB todavía
- **SQL idempotente** (ver `/safe-db-migration`)
- **`type="button"`** explícito en todo `<button>` que no sea form submit
- **Logs temporales** SOLO con prefijo identificable `[<nombre_action>]` para limpiar después con `/cleanup-logs`

### Patrones a evitar

- ❌ `throw new Error()` en server actions
- ❌ Aplicar SQL automáticamente (siempre entregar al usuario)
- ❌ `npm run build` con dev server activo
- ❌ Mutar `created_at`, `updated_at`, `created_by` en backfills
- ❌ Refactor "de paso" cuando el spec dice "mínima modificación"

### Orden recomendado

1. Tipos (`src/types/database.ts`)
2. Action(s) en `actions.ts` del módulo
3. `page.tsx` SELECT (tolerante si aplica)
4. `Client.tsx` UI (form / button / handler)
5. `npx tsc --noEmit` para validar
6. **NO `npm run build`** durante dev
7. Commit con mensaje claro de qué etapa y qué quedó pendiente
8. Push

## Mensaje de commit

Formato:
```
<Módulo>: <verbo presente, qué hizo>

<Detalle de qué hace, por qué, qué patrón usa>

<Si aplica> DB migration (a aplicar fuera de este commit) <qué requiere>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Ejemplos buenos:
- "Fondos: dar de baja con guarda de saldo via RPC SECURITY DEFINER"
- "Use SECURITY DEFINER RPC for proveedor soft-delete"
- "Add codigo identifier columns for gastos and pagos"
- "Inter-fund debt accounting foundation (stage 1)"

## Reporte final al usuario

Estructura:
1. **Estado** (commit hash + push confirmado)
2. **SQL para aplicar** (si hay) — bloque copiable
3. **Archivos modificados** (tabla 2 columnas)
4. **Comportamiento** (tabla casos + resultado)
5. **NO se tocó** (lista explícita de cosas afuera de scope)
6. **Cómo probar** (lista numerada de pasos)
7. **Pendiente** (etapas que quedan)

## Cuando algo no anda

1. Leer log del dev server (`tail` del archivo background)
2. Buscar línea específica de error
3. Si es RLS → `/diagnose-rls`
4. Si es chunks 404 → `.next/` corrupto, recovery en `CLAUDE.md`
5. Si es schema mismatch (42703) → confirmar migración aplicada o agregar tolerancia
6. Si nada de lo anterior → preguntar al usuario más info en vez de adivinar

## Nunca hacer en producción

- DELETE físico de gastos/pagos confirmados
- Modificar `monto` o `fecha_pago` de pagos confirmados
- Desactivar policies permanentemente
- Usar service_role desde frontend
- Hardcodear UUIDs de usuarios o fondos
