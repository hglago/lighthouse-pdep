# TESTING.md

Comandos y pruebas manuales mínimas. No hay test runner automatizado todavía.

## Comandos básicos

```powershell
# Validar tipos sin tocar .next/
npx tsc --noEmit

# Arrancar dev server
npm run dev

# Producción (SOLO con dev apagado)
taskkill /F /IM node.exe
npm run build
npm start

# Limpiar build cache (cuando aparecen 404 de chunks)
taskkill /F /IM node.exe
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev
```

## Health check rápido del entorno

1. `npm run dev` arranca y dice "Ready in Xs"
2. `http://localhost:3000` redirige a `/login`
3. Login con admin → llega a `/dashboard`
4. Cada módulo (`/fondos`, `/gastos`, `/pagos`, `/proveedores`) abre sin 500 ni overlay de error
5. El log del dev server NO muestra `GET /_next/static/.../layout.css 404`

Si el punto 5 falla → `.next/` corrupto. Recovery arriba.

## Smoke test funcional

### Fondos
- Crear fondo nuevo con monto_inicial > 0 → aparece en lista
- Registrar aporte → saldo sube
- "Dar de baja" fondo con saldo=0 → desaparece de activos
- "Dar de baja" fondo con saldo != 0 → alert bloqueante, no RPC

### Proveedores
- Crear proveedor sin uplift → aparece, columna Uplift = "—"
- Crear proveedor con uplift 10% → aparece con "10.00%"
- Editar para activar uplift → cambio refleja en tabla
- "Dar de baja" → confirm con conteos → desaparece de selectores nuevos pero sigue en gastos históricos

### Gastos
- Nuevo gasto → estado='enviado' (no borrador)
- Aprobar → aparece como obligación pendiente en /pagos
- Editar mientras 'enviado' → permitido; mientras 'aprobado' → bloqueado
- Bulk: seleccionar varios → Autorizar / Cancelar / Eliminar funcionan con resumen procesados/errores
- Adjuntar comprobante → archivo en Storage, link "Ver comprobante"

### Pagos
- Desde obligación pendiente, "Pagar" → modal con monto prellenado → "Registrar pago" → desaparece, fondo descuenta, gasto pasa a pagado/pagado_parcial
- Anti-overpayment: intentar pago > saldo pendiente → error inline, no se crea
- Anti-dup borrador: si existe borrador legacy con misma (gasto, tipo, monto), nuevo intento bloquea
- "Anular" pago confirmado → reversa de movimiento, saldo vuelve

### Cuenta corriente (etapa 1 read-only)
- Sin pagos cruzados → badge "⇄ Por cuenta de" no aparece
- Forzar manualmente vía SQL `UPDATE pagos SET fondo_responsable_id = <otro_fondo_id> WHERE id = ...` → badge aparece en la tabla

## Pruebas anti-regresión cuando se modifica algo

Después de cualquier cambio en:

### `pagos/actions.ts` o `pagos/PagosClient.tsx`
1. Crear un pago normal (mismo fondo) → debe quedar como pagado
2. Intentar over-payment → debe bloquear
3. Anular un pago → debe revertir saldo
4. Confirmar que la tabla muestra todos los pagos sin 500

### `gastos/actions.ts` o `GastosClient.tsx`
1. Crear gasto manual → estado='enviado'
2. Aprobar → llega a obligaciones pendientes
3. Bulk autorizar 2-3 gastos → resumen verde
4. Verificar comprobante upload/remove

### `lib/supabase/*` o `layout.tsx` o `middleware.ts`
1. Logout + login completo
2. Navegación entre 4-5 rutas distintas
3. Recarga forzada (Ctrl+Shift+R)
4. Confirmar que cookies persisten entre rutas

### `RPCs SECURITY DEFINER`
1. Logearse como un user que no es el creador
2. Intentar la acción que invoca la RPC
3. Confirmar que funciona (sin error 42501)
4. Verificar SQL post-acción: que el cambio efectivamente persiste

## SQL diagnóstico rápido

```sql
-- ¿Qué policies tiene una tabla?
SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = '<x>';

-- ¿Qué triggers tiene?
SELECT t.tgname, p.proname FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.<x>'::regclass AND NOT t.tgisinternal;

-- ¿Mi user en la sesión actual?
SELECT auth.uid(), (SELECT role FROM profiles WHERE id = auth.uid()) AS role;

-- Reset de datos operativos (ver /safe-db-migration)
```

## Cuándo hace falta `npm run build`

Solo cuando:
- El usuario lo pide explícitamente
- Vas a desplegar a producción
- Querés verificar que un cambio compila para prod (tsc es suficiente para 95% de los casos)

**Antes**: matar `npm run dev`. **Después**: recordar reiniciar dev si la sesión sigue activa.
