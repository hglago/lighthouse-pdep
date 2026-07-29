'use client'

import Link from 'next/link'

// Toolbar de la Orden de Gasto. Se oculta al imprimir (print:hidden).
// La orden suele abrirse en pestaña nueva desde el listado, por eso el
// "Volver" es un Link a /gastos en lugar de router.back().
export default function PrintButton() {
  return (
    <div className="flex gap-2 print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
      >
        Imprimir
      </button>
      <Link
        href="/gastos"
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
      >
        Volver a Gastos
      </Link>
    </div>
  )
}
