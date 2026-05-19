import Link from 'next/link'
import {
  IconFondos,
  IconGastos,
  IconPagos,
  IconAnticipos,
  IconProveedores,
  IconHonorarios,
  IconRendiciones,
} from '@/components/ui/icons'

const modules = [
  {
    label: 'Fondos',
    href: '/fondos',
    description: 'Gestión de fondos y cuentas',
    Icon: IconFondos,
  },
  {
    label: 'Gastos',
    href: '/gastos',
    description: 'Registro y control de gastos',
    Icon: IconGastos,
  },
  {
    label: 'Pagos',
    href: '/pagos',
    description: 'Pagos a proveedores y terceros',
    Icon: IconPagos,
  },
  {
    label: 'Anticipos',
    href: '/anticipos',
    description: 'Adelantos y anticipos de fondos',
    Icon: IconAnticipos,
  },
  {
    label: 'Proveedores',
    href: '/proveedores',
    description: 'Alta y gestión de proveedores',
    Icon: IconProveedores,
  },
  {
    label: 'Honorarios',
    href: '/honorarios',
    description: 'Honorarios y remuneraciones',
    Icon: IconHonorarios,
  },
  {
    label: 'Rendiciones',
    href: '/rendiciones',
    description: 'Rendiciones de cuentas y cierres',
    Icon: IconRendiciones,
  },
]

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Panel principal</h1>
        <p className="mt-1 text-sm text-gray-500">
          Seleccioná un módulo para comenzar a operar.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {modules.map(({ label, href, description, Icon }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:border-slate-300"
          >
            <div className="mb-3 text-slate-600 transition group-hover:text-slate-900">
              <Icon className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
            <p className="mt-1 text-xs text-gray-500">{description}</p>
          </Link>
        ))}
      </div>

      {/* Placeholder para métricas — etapa 2 */}
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
        <p className="text-sm text-gray-400">
          Las métricas y resúmenes financieros se implementarán en la próxima etapa.
        </p>
      </div>
    </div>
  )
}
