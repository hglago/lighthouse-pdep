import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { OrdenPago } from '@/types'
import PrintButton from './PrintButton'

/**
 * OP (2026-05-25): vista imprimible de una Orden de Pago.
 *
 * Server component. Lee `ordenes_pago` por `codigo` (UNIQUE). Render
 * print-friendly con CSS @media print que oculta navegación, botones,
 * shell del dashboard. El usuario imprime con window.print() y puede
 * guardar como PDF desde el diálogo del navegador.
 *
 * Todos los datos vienen del snapshot al momento de emisión. Si después
 * cambian el gasto, proveedor o tercero originales, la OP NO se refresca.
 */

function fmtMonto(m: number, moneda: string): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda === 'USD' ? 'USD' : 'ARS',
    minimumFractionDigits: 2,
  }).format(m)
}

function fmtFecha(iso: string): string {
  // ISO date "2026-05-25" o timestamptz "2026-05-25T12:34:56Z" → "25/05/2026"
  const datePart = iso.slice(0, 10)
  const [y, m, d] = datePart.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

const MODALIDAD_LABEL: Record<string, string> = {
  total:      'Pago total',
  parcial:    'Pago parcial',
  no_aplica:  '—',
}

const CANAL_LABEL: Record<string, string> = {
  risa:    'Medios propios RISA',
  tercero: 'Tercero de la red',
}

export default async function OrdenPagoPage({
  params,
}: {
  params: { codigo: string }
}) {
  const supabase = createClient()

  const authResult = await supabase.auth.getUser()
  if (!authResult.data?.user) redirect('/login')

  const { data, error } = await supabase
    .from('ordenes_pago')
    .select('*')
    .eq('codigo', params.codigo)
    .maybeSingle()

  if (error) {
    console.error('[ordenes-pago] error:', error.code, error.message)
    throw new Error(error.message)
  }
  if (!data) notFound()

  const op = data as OrdenPago

  return (
    <div className="mx-auto max-w-3xl p-6 print:p-0 print:max-w-none">
      {/* Toolbar — se oculta al imprimir */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Orden de Pago</h1>
          <p className="mt-1 text-sm text-gray-500">
            Vista lista para imprimir o guardar como PDF.
          </p>
        </div>
        <PrintButton />
      </div>

      {/* Hoja imprimible */}
      <article className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:rounded-none print:border-0 print:shadow-none print:p-6">
        {/* Encabezado */}
        <header className="mb-6 flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Orden de Pago</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-slate-900">{op.codigo}</p>
            <p className="mt-1 text-xs text-slate-500">
              Emitida el {fmtFecha(op.fecha_emision)}
            </p>
          </div>
          <div className="text-right">
            {op.estado === 'anulada' ? (
              <span className="inline-flex rounded-full px-3 py-1 text-sm font-semibold bg-red-50 text-red-700 ring-1 ring-red-200">
                ANULADA
              </span>
            ) : (
              <span className="inline-flex rounded-full px-3 py-1 text-sm font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                EMITIDA
              </span>
            )}
            {op.estado === 'anulada' && op.anulada_en && (
              <p className="mt-1 text-xs text-slate-500">
                Anulada el {fmtFecha(op.anulada_en)}
              </p>
            )}
          </div>
        </header>

        {/* Bloque proveedor + canal */}
        <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Beneficiario</p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {op.proveedor_nombre ?? <span className="text-slate-400">—</span>}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Canal de pago</p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {CANAL_LABEL[op.canal_pago] ?? op.canal_pago}
            </p>
            {op.canal_pago === 'tercero' && (op.tercero_codigo || op.tercero_nombre) && (
              <p className="mt-0.5 text-xs text-slate-600">
                {op.tercero_codigo && <span className="font-mono">{op.tercero_codigo} </span>}
                {op.tercero_nombre}
              </p>
            )}
          </div>
        </section>

        {/* Importe + modalidad */}
        <section className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-5">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Importe</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">
                {fmtMonto(op.importe, op.moneda)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-500">Modalidad</p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {MODALIDAD_LABEL[op.modalidad] ?? op.modalidad}
              </p>
              {op.modalidad === 'parcial' && op.saldo_pendiente != null && op.saldo_pendiente > 0 && (
                <p className="mt-0.5 text-xs text-amber-700">
                  Saldo pendiente: {fmtMonto(op.saldo_pendiente, op.moneda)}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Concepto + referencias */}
        <section className="mb-6 space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Concepto</p>
            <p className="mt-1 text-sm text-slate-900">
              {op.concepto ?? <span className="text-slate-400">—</span>}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">N° Gasto</p>
              <p className="mt-0.5 font-mono text-sm text-slate-900">
                {op.nro_gasto ?? <span className="font-sans text-slate-400">—</span>}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">N° Pago</p>
              <p className="mt-0.5 font-mono text-sm text-slate-900">
                {op.nro_pago ?? <span className="font-sans text-slate-400">—</span>}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Tipo de gasto</p>
              <p className="mt-0.5 text-sm text-slate-900">
                {op.tipo_gasto_codigo
                  ? <span><span className="font-mono">{op.tipo_gasto_codigo}</span>{op.tipo_gasto_nombre ? ` — ${op.tipo_gasto_nombre}` : ''}</span>
                  : <span className="text-slate-400">—</span>}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Período</p>
              <p className="mt-0.5 font-mono text-sm text-slate-900">
                {op.periodo_analitico ?? <span className="font-sans text-slate-400">—</span>}
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Fecha de pago</p>
            <p className="mt-0.5 text-sm text-slate-900">{fmtFecha(op.fecha_pago)}</p>
          </div>

          {op.observaciones && (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Observaciones</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{op.observaciones}</p>
            </div>
          )}
        </section>

        {/* Firma */}
        <section className="mt-12 grid grid-cols-2 gap-12 print:mt-16">
          <div className="border-t border-slate-300 pt-2 text-center">
            <p className="text-xs text-slate-500">Recibí conforme</p>
          </div>
          <div className="border-t border-slate-300 pt-2 text-center">
            <p className="text-xs text-slate-500">Autoriza</p>
          </div>
        </section>
      </article>
    </div>
  )
}
