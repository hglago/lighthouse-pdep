'use client'

import { useRouter } from 'next/navigation'

export default function PrintButton() {
  const router = useRouter()
  return (
    <div className="flex gap-2 print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
      >
        Imprimir
      </button>
      <button
        type="button"
        onClick={() => router.back()}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
      >
        Volver
      </button>
    </div>
  )
}
