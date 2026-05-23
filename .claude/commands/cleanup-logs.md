---
description: Quitar console.log temporales de diagnóstico después de confirmar fix
---

# /cleanup-logs

Después de resolver un bug RLS, debugging de payload, o cualquier diagnóstico, los `console.log("[action] ...")` quedan en el código como ruido. Limpiarlos en un commit dedicado.

## Procedimiento

1. **Buscar todos los logs temporales** con grep en `src/`:

```
src/app/(dashboard)/<modulo>/actions.ts
```

Patrones a buscar:
- `console.log("[<action>]...")`
- `console.log("AUTH USER:"`, `console.log("USER ID:"`, `console.log("PAYLOAD..."` (estilo Fondos diagnóstico)
- `console.log("PROFILE SELF-CHECK"`, `console.log("GET_MY_ROLE"`
- `console.log("PROVEEDOR ACTUAL"`, `console.log("INSERT DATA"`, `console.log("UPDATE RESULT"`

**Mantener**:
- `console.error('[action] unhandled:', err)` en catch blocks (útil para producción)
- `console.warn('[modulo] columnas X no disponibles, ...')` (informativos legítimos)
- Logs dentro de acciones operativas que el usuario explícitamente pidió mantener

## Approach

### Opción A — Cleanup quirúrgico
Editar archivo por archivo manualmente, dejando solo `console.error` defensivos.

### Opción B — Convertir a debug condicional
Cambiar `console.log` por una función que solo loguea si `process.env.DEBUG_RLS === '1'`. No recomendado salvo que el debug sea recurrente.

### Opción C — Eliminar todo bloque diagnóstico
Cuando hay un bloque grande como en `createFondo`, reemplazar con la versión final limpia.

## Checklist pre-commit

- [ ] `npx tsc --noEmit` pasa
- [ ] El comportamiento funcional NO cambió (solo se quitaron logs)
- [ ] Quedan los `console.error('[action] unhandled:', err)` en catch
- [ ] Quedan los `console.warn` informativos sobre estado del schema
- [ ] El dev server sigue funcionando (hot-reload sin errores)

## Estado de logs temporales conocidos a 2026-05-23

- `src/app/(dashboard)/fondos/actions.ts` `createFondo`: bloque grande de 5 logs RLS — **pendiente cleanup**
- `src/app/(dashboard)/gastos/actions.ts` `deleteGasto`: `console.error` con bloque deliberado — mantener (ayuda en producción)
- `src/app/(dashboard)/proveedores/actions.ts` `deleteProveedor`: ya limpio post commit `7df8df8`

## Commit message

```
Remove temporary RLS diagnostic logs from <modulo>

These were added during the <fecha> debugging session for <bug>.
The issue was resolved by <solucion> in commit <hash>. The logs are
no longer informative and add noise to the dev server output.

Kept: console.error in catch blocks for production-time issues.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

## Anti-patrones

- ❌ Borrar `console.error` de catch (perdés visibilidad en producción)
- ❌ Borrar logs `[modulo] columnas X no disponibles` (ayudan a saber cuándo aplicar SQL pendiente)
- ❌ Convertir logs a `// TODO` — eliminar limpiamente
- ❌ Cleanup masivo sin verificar que el dev server siga andando después
