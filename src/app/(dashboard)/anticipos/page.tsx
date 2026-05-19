import { IconAnticipos } from '@/components/ui/icons'

export default function AnticiposPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Anticipos</h1>
        <p className="mt-1 text-sm text-gray-500">
          Adelantos y anticipos de fondos.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
        <div className="mb-3 text-gray-300">
          <IconAnticipos className="w-10 h-10" />
        </div>
        <h3 className="text-base font-medium text-gray-700">Módulo en desarrollo</h3>
        <p className="mt-1 text-sm text-gray-400">
          Este módulo se implementará en la próxima etapa.
        </p>
      </div>
    </div>
  )
}
