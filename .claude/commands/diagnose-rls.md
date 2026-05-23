---
description: Diagnóstico estandarizado cuando una operación falla con RLS
---

# /diagnose-rls

Recipe para diagnosticar bloqueos RLS en Supabase. Usar cuando una server action devuelva `42501 new row violates RLS` u otro error tipo permiso.

## Paso 1 — Confirmar que la sesión llega

Agregar logs temporales en la action que falla:

```typescript
const { data: { user }, error: userError } = await supabase.auth.getUser()
console.log("[<action>] user:", user)
console.log("[<action>] userError:", userError)

// SQL session check: si esto devuelve nuestra propia fila, auth.uid() propaga
const { data: profileSelf } = await supabase
  .from('profiles')
  .select('id, role').eq('id', user.id).maybeSingle()
console.log("[<action>] PROFILE SELF-CHECK:", profileSelf)
```

Si `user` es null → cliente Supabase no lee cookies. Arreglar `lib/supabase/server.ts`.
Si `user` OK pero `profileSelf` null → auth.uid() no propaga al SQL. Cliente mal armado.
Si ambos OK → seguir paso 2.

## Paso 2 — Diagnosticar policies de la tabla afectada

Pasar al usuario:

```sql
-- Listar policies
SELECT policyname, cmd, permissive, roles, qual AS using_expr, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = '<tabla>'
ORDER BY permissive DESC, cmd, policyname;

-- Verificar RLS activo
SELECT tablename, rowsecurity, forcerowsecurity
FROM pg_tables WHERE tablename = '<tabla>';

-- Mi user actual
SELECT auth.uid() AS my_uid,
       (SELECT role FROM profiles WHERE id = auth.uid()) AS my_role,
       (SELECT email FROM profiles WHERE id = auth.uid()) AS my_email;
```

Buscar **permissive='RESTRICTIVE'** específicamente — esas se AND-ean y bloquean aunque la PERMISSIVE pase.

## Paso 3 — Diagnosticar triggers

```sql
-- Triggers sobre la tabla
SELECT t.tgname, p.proname AS function_name,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.<tabla>'::regclass
  AND NOT t.tgisinternal;

-- Código fuente de los triggers
SELECT p.proname, pg_get_functiondef(p.oid)
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.<tabla>'::regclass
  AND NOT t.tgisinternal;
```

## Paso 4 — Confirmar el payload exacto

```typescript
const payload = { ... }
console.log("[<action>] PAYLOAD:", JSON.stringify(payload))
console.log("[<action>] payload keys:", Object.keys(payload))
```

Confirmar que **NO** se mandan campos `created_by`, `updated_by`, `role`, `activo`, ni nada que pueda chocar con `WITH CHECK`.

## Paso 5 — Si todo lo anterior es correcto

Migrar la acción a **RPC SECURITY DEFINER**. Ver `RLS_RPC.md` sección "Plantilla". Patrón resumido:

```sql
CREATE OR REPLACE FUNCTION public.<accion>_<entidad>(...)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  -- validaciones + mutación
END $$;

REVOKE ALL ON FUNCTION ... FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ... TO authenticated;
```

Luego en la action:
```typescript
const { error } = await supabase.rpc('<accion>_<entidad>', { ... })
if (error) return { ok: false, error: error.message }
```

## Lo que NO hacer

- ❌ Desactivar RLS
- ❌ Usar service_role en frontend
- ❌ "Abrir" anon
- ❌ Asumir que `USING(true) WITH CHECK(true)` resuelve todo — puede haber RESTRICTIVE oculta
