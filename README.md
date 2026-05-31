# GASTOS PdeP — Lighthouse PdeP

## Descripción general

GASTOS PdeP es una aplicación web multiusuario desarrollada para administrar fondos, gastos, pagos, proveedores, terceros, aportes, reportes e información financiero-operativa del proyecto especial de startup de Lighthouse PdeP.

El sistema permite registrar gastos reales del proyecto, controlar su autorización, gestionar pagos, discriminar medios propios y terceros, generar reportes para socios y consultar indicadores ejecutivos desde un dashboard.

La aplicación está publicada en Vercel y utiliza Supabase como backend de base de datos, autenticación y reglas de seguridad.

## Objetivo del proyecto

El objetivo principal es reemplazar controles manuales o dispersos por un sistema centralizado de registración, control y rendición de gastos.

El sistema busca asegurar:

- trazabilidad de gastos;
- control de pagos;
- separación entre medios propios y terceros;
- registro de aportes e imputaciones;
- reportes confiables para socios;
- control de roles y permisos;
- base preparada para auditoría, reportería y evolución futura.

## Stack tecnológico

- Framework: Next.js
- Lenguaje: TypeScript
- Base de datos: Supabase / PostgreSQL
- Autenticación: Supabase Auth + Google Login
- Hosting: Vercel
- Control de versiones: Git + GitHub
- UI: React / Tailwind
- Exportaciones: PDF / Excel según módulos

## URL de producción

https://lighthouse-pdep.vercel.app/login

## Carpeta local del proyecto

`C:\Users\hglag\lighthouse-pdep`

## Reglas funcionales principales

### Gastos

Los gastos representan obligaciones reales del proyecto.

Cada gasto debe tener:

- proveedor obligatorio;
- fecha de gasto;
- fecha de pago prevista;
- tipo de gasto;
- monto;
- moneda;
- estado;
- comprobante cuando corresponda.

Los gastos pueden ser autorizados, pagados o anulados según permisos del usuario.

Flujo operativo esperado:

Carga de gasto → autorización → pago

No se utiliza flujo de borrador para gastos/pagos.

### Pagos

Los pagos cancelan obligaciones previamente registradas.

Los pagos confirmados generan movimientos financieros y afectan las cuentas correspondientes.

Los pagos deben conservar trazabilidad del gasto, proveedor, importe, moneda, fecha y canal de cancelación.

### Fondos y posición financiera

El sistema distingue entre:

- Medios Propios / efectivo RISA;
- Medios de Terceros.

La posición global RISA se calcula como:

Posición Global = Medios Propios + Medios Terceros

Los terceros pueden afrontar pagos y generar cuenta corriente individual.

### Aportes

Los aportes pueden imputarse a diferentes destinos:

- medios propios;
- terceros específicos.

Cada aporte debe conservar trazabilidad del aportante, monto, moneda e imputación.

Los aportes deben tener código visible y no depender de UUID técnicos como identificador principal para el usuario.

### Terceros

Los terceros representan personas o entidades que afrontan gastos por cuenta del proyecto.

Cada tercero tiene cuenta corriente operativa.

El sistema debe permitir consultar detalle de movimientos por tercero.

### Proveedores

Los proveedores se utilizan para registrar gastos.

Además del nombre operativo, pueden tener un nombre normalizado para informes, usado especialmente en reportes para socios.

### Reportes

El módulo de reportes permite generar informes para socios.

El informe Dypsa tiene dos modos:

1. Vista previa dinámica.
2. Informe emitido/congelado.

Una vez emitido, el informe queda numerado y congelado mediante snapshot histórico.

Los informes emitidos no deben recalcularse desde gastos ni pagos, sino consultarse desde las tablas de snapshot.

El informe Dypsa debe aplicar internamente el coeficiente/mark-up del proveedor al importe final informado, pero no debe mostrar al socio:

- mark-up;
- uplift;
- coeficiente;
- fórmula;
- importe base;
- margen interno.

### Dashboard

El dashboard muestra indicadores ejecutivos y operativos, incluyendo:

- aportes;
- pagos;
- gastos por estado;
- gastos por proveedor;
- gastos por tipo;
- posición global;
- necesidad semanal según fecha de pago prevista;
- saldos por medios propios y terceros.

El período por defecto es el mes actual.

Filtros rápidos previstos:

- semana actual;
- mes actual;
- todo el proyecto.

Para "necesidad semanal" debe usarse exclusivamente `gastos.fecha_pago_prevista`, no `fecha_vencimiento`.

## Roles y permisos

El sistema contempla los siguientes roles:

- admin;
- supervisor;
- operador;
- user;
- socio;
- contador;
- revisor;
- visualizador.

### Admin

Tiene acceso completo al sistema.

Puede administrar usuarios, proveedores, fondos, aportes, terceros, pagos, gastos, reportes y dashboard.

### Supervisor

Puede operar sobre gastos, proveedores y pagos según permisos definidos, pero no accede al dashboard si no está autorizado.

### Operador

Puede cargar y operar información según alcance funcional limitado.

### User

Puede cargar proveedores y gastos propios.

Solo puede editar sus propios gastos mientras estén en estado editable y sin pagos activos.

### Socio

Accede únicamente al módulo de reportes.

No debe ver módulos operativos internos.

### Contador

Rol legacy utilizado en etapas iniciales del sistema.

## Seguridad

El sistema utiliza controles server-side mediante guards de autorización.

Las operaciones críticas no deben depender solamente de la interfaz visual.

Toda acción sensible debe validar rol y permisos desde el servidor.

Google Login funciona mediante lista blanca de usuarios autorizados.

Usuarios ADMIN vía Google definidos originalmente:

- hglago@gmail.com
- anibal@northfield.edu.ar
- nicolas@northfield.edu.ar

Usuario legacy:

- admin@lighthouse.com

## Criterios globales de UI/UX

No se deben mostrar UUID técnicos como identificadores principales en la interfaz.

Todos los listados deben priorizar:

- código visible;
- filtros;
- búsqueda;
- ordenamiento por encabezados;
- selección individual;
- selección total;
- acciones masivas cuando corresponda;
- limpiar filtros;
- tablas consistentes entre módulos.

Los encabezados de Gastos, Pagos, Fondos, Proveedores, Reportes y módulos futuros deben mantener una lógica homogénea.

## Ambiente de producción

La aplicación está desplegada en Vercel.

Variables mínimas necesarias:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

La `SUPABASE_SERVICE_ROLE_KEY` debe tratarse como secreto sensible y no debe exponerse ni commitearse.

## Comandos habituales

Instalar dependencias:

```bash
npm install
```

Ejecutar desarrollo local:

```bash
npm run dev
```

Validar TypeScript:

```bash
npx tsc --noEmit
```

Generar build:

```bash
npm run build
```

Ver estado Git:

```bash
git status --short
```

Ver últimos commits:

```bash
git log --oneline -5
```

## Metodología de trabajo recomendada

El desarrollo se realiza por etapas pequeñas.

Antes de implementar una nueva fase:

1. diagnosticar el estado actual;
2. revisar permisos y lógica financiera afectada;
3. evitar tocar SQL/RPC/RLS si no es necesario;
4. implementar la menor unidad funcional posible;
5. validar con TypeScript;
6. ejecutar build;
7. probar visualmente;
8. commitear;
9. pushear a GitHub.

## Validaciones mínimas antes de cerrar una etapa

```bash
npx tsc --noEmit
npm run build
git status --short
git log --oneline -3
```

El cierre correcto de una etapa requiere:

- TypeScript sin errores;
- build exitoso;
- working tree limpio o cambios claramente identificados;
- commit y push realizados si corresponde.

## Principio rector

Construir el sistema como una herramienta financiero-operativa confiable.

Prioridad:

1. datos correctos;
2. seguridad;
3. trazabilidad;
4. lógica financiera;
5. reportería;
6. experiencia de usuario;
7. estética.

La estética no debe comprometer la claridad financiera ni la seguridad del sistema.

## Identidad visual Lighthouse

Usar un estilo institucional educativo sobrio.

Referencia visual:

- logo horizontal Lighthouse School como marca principal;
- ícono circular "i" como recurso secundario;
- paleta con teal/verde como acento principal;
- fondos claros;
- tarjetas limpias;
- buena legibilidad;
- evitar sobrecargar los módulos operativos con imágenes.

Paleta aproximada:

- teal principal: `#079783` / `#189D7B`
- verdes: `#67B855` / `#86C346` / `#95D255`
- azul profundo: `#0C1F6E`
- azul medio: `#525EA6`
- violeta: `#7C2D88`
- amarillo: `#F6CE00`
- naranja: `#D56E39`
- rojo: `#C32421`
- grises neutros: `#898279`

Tipografías recomendadas:

- Montserrat para títulos y énfasis;
- Inter o Nunito Sans para texto/UI;
- opción simple: Montserrat en toda la interfaz con pesos 400/500/600/700.

## Documentación interna complementaria

Este repo mantiene documentación operativa adicional en la raíz, que **no reemplaza** a este README pero lo complementa:

- `CLAUDE.md` — convenciones críticas y anti-patrones para asistentes (Claude Code / agentes).
- `CONTEXT.md` — estado actual del proyecto, SQL aplicado vs pendiente.
- `TASK.md` — tarea activa en curso.
- `DECISIONS.md` — decisiones funcionales cerradas (D14, D16, D18, D21, D22, D23, etc.).
- `DB.md` — tablas, triggers, secuencias, relaciones.
- `RLS_RPC.md` — policies y RPCs `SECURITY DEFINER`.
- `MODULES.md` — descripción por módulo (UI + actions).
- `TESTING.md` — pruebas manuales mínimas.
- `RELEASES.md` — hitos y tags publicados.
