'use client'

import { useState, useTransition } from 'react'
import type { UserRole } from '@/types'
import type { CrearUsuarioPayload, UpdateUsuarioPayload, ActionResult, GoogleAllowedPayload } from './actions'

export interface UsuarioRow {
  id: string
  email: string
  usuario_login: string | null
  full_name: string | null
  role: UserRole
  activo: boolean
  puede_exportar: boolean
  puede_aprobar_gastos: boolean
  puede_confirmar_pagos: boolean
  fondo_default_id: string | null
  notas_admin: string | null
  created_at: string
}

export interface GoogleAllowedRow {
  id: string
  email: string
  activo: boolean
  role: UserRole
  usuario_login: string | null
  full_name: string | null
  notas_admin: string | null
  created_at: string
  created_by: string | null
}

// Fase 2A (2026-05-25): selects de rol exponen UserRole directo (los 7 valores).
// Nuevos (preferidos) primero, legacy en <optgroup> al final.
const NEW_ROLES: UserRole[] = ['admin', 'supervisor', 'operador', 'user', 'socio']
const LEGACY_ROLES: UserRole[] = ['contador', 'revisor', 'visualizador']

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  supervisor: 'Supervisor',
  operador: 'Operador',
  user: 'User',
  socio: 'Socio',
  contador: 'Contador (legacy)',
  revisor: 'Revisor (legacy)',
  visualizador: 'Visualizador (legacy)',
}

// Defaults sugeridos al cambiar de rol en el modal. No modifica comportamiento
// de permisos en otras pantallas — son solo valores iniciales del form.
const DEFAULTS_POR_ROLE: Record<UserRole, { puede_exportar: boolean; puede_aprobar_gastos: boolean; puede_confirmar_pagos: boolean }> = {
  admin:        { puede_exportar: true,  puede_aprobar_gastos: true,  puede_confirmar_pagos: true },
  supervisor:   { puede_exportar: true,  puede_aprobar_gastos: false, puede_confirmar_pagos: false },
  operador:     { puede_exportar: true,  puede_aprobar_gastos: false, puede_confirmar_pagos: false },
  user:         { puede_exportar: false, puede_aprobar_gastos: false, puede_confirmar_pagos: false },
  socio:        { puede_exportar: false, puede_aprobar_gastos: false, puede_confirmar_pagos: false },
  contador:     { puede_exportar: true,  puede_aprobar_gastos: true,  puede_confirmar_pagos: false },
  revisor:      { puede_exportar: true,  puede_aprobar_gastos: true,  puede_confirmar_pagos: false },
  visualizador: { puede_exportar: false, puede_aprobar_gastos: false, puede_confirmar_pagos: false },
}

const USUARIO_LOGIN_REGEX = /^[a-z0-9._-]+$/

interface Fondo { id: string; nombre: string; moneda: string }

interface Props {
  usuarios: UsuarioRow[]
  fondos: Fondo[]
  googleAllowed: GoogleAllowedRow[]
  currentUserId: string
  onCrear: (payload: CrearUsuarioPayload) => Promise<ActionResult>
  onUpdate: (id: string, data: UpdateUsuarioPayload) => Promise<ActionResult>
  onToggleActivo: (id: string) => Promise<ActionResult>
  onResetPassword: (id: string, newPassword: string) => Promise<ActionResult>
  onCrearGoogle: (payload: GoogleAllowedPayload) => Promise<ActionResult>
  onUpdateGoogle: (id: string, payload: GoogleAllowedPayload) => Promise<ActionResult>
  onToggleGoogle: (id: string) => Promise<ActionResult>
  onDeleteGoogle: (id: string) => Promise<ActionResult>
}

export default function UsuariosClient({
  usuarios: usuariosProp,
  fondos: fondosProp,
  googleAllowed: googleAllowedProp,
  currentUserId,
  onCrear,
  onUpdate,
  onToggleActivo,
  onResetPassword,
  onCrearGoogle,
  onUpdateGoogle,
  onToggleGoogle,
  onDeleteGoogle,
}: Props) {
  const usuarios = Array.isArray(usuariosProp) ? usuariosProp : []
  const fondos = Array.isArray(fondosProp) ? fondosProp : []
  const googleAllowed = Array.isArray(googleAllowedProp) ? googleAllowedProp : []

  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')
  const [isPending, startTransition] = useTransition()

  // ── Crear modal ────────────────────────────────────────────────────────────
  const [crearOpen, setCrearOpen] = useState(false)
  const [crLogin, setCrLogin] = useState('')
  const [crPwd, setCrPwd] = useState('')
  const [crPwd2, setCrPwd2] = useState('')
  const [crNombre, setCrNombre] = useState('')
  const [crRole, setCrRole] = useState<UserRole>('user')
  const [crExp, setCrExp] = useState(DEFAULTS_POR_ROLE.user.puede_exportar)
  const [crApr, setCrApr] = useState(DEFAULTS_POR_ROLE.user.puede_aprobar_gastos)
  const [crConf, setCrConf] = useState(DEFAULTS_POR_ROLE.user.puede_confirmar_pagos)
  const [crFondo, setCrFondo] = useState('')
  const [crError, setCrError] = useState('')

  function openCrear() {
    setCrLogin('')
    setCrPwd('')
    setCrPwd2('')
    setCrNombre('')
    setCrRole('user')
    setCrExp(DEFAULTS_POR_ROLE.user.puede_exportar)
    setCrApr(DEFAULTS_POR_ROLE.user.puede_aprobar_gastos)
    setCrConf(DEFAULTS_POR_ROLE.user.puede_confirmar_pagos)
    setCrFondo('')
    setCrError('')
    setCrearOpen(true)
  }

  function handleCrRoleChange(r: UserRole) {
    setCrRole(r)
    setCrExp(DEFAULTS_POR_ROLE[r].puede_exportar)
    setCrApr(DEFAULTS_POR_ROLE[r].puede_aprobar_gastos)
    setCrConf(DEFAULTS_POR_ROLE[r].puede_confirmar_pagos)
  }

  function handleCrSubmit(e: React.FormEvent) {
    e.preventDefault()
    setCrError('')
    const login = crLogin.trim().toLowerCase()
    if (!USUARIO_LOGIN_REGEX.test(login)) {
      setCrError('Usuario inválido: solo minúsculas, números, . _ -')
      return
    }
    if (crPwd.length < 4) { setCrError('La contraseña debe tener al menos 4 caracteres.'); return }
    if (crPwd !== crPwd2) { setCrError('Las contraseñas no coinciden.'); return }

    const adminLocked = crRole === 'admin'
    startTransition(async () => {
      const result = await onCrear({
        usuario_login: login,
        password: crPwd,
        full_name: crNombre.trim() || null,
        role: crRole,
        puede_exportar: adminLocked ? true : crExp,
        puede_aprobar_gastos: adminLocked ? true : crApr,
        puede_confirmar_pagos: adminLocked ? true : crConf,
        fondo_default_id: crFondo || null,
      })
      if (!result.ok) { setCrError(result.error); return }
      setCrearOpen(false)
      setActionSuccess(`Usuario "${login}" creado.`)
    })
  }

  // ── Editar modal ───────────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null)
  const [edRole, setEdRole] = useState<UserRole>('user')
  const [edActivo, setEdActivo] = useState(true)
  const [edExp, setEdExp] = useState(false)
  const [edApr, setEdApr] = useState(false)
  const [edConf, setEdConf] = useState(false)
  const [edFondo, setEdFondo] = useState('')
  const [edNotas, setEdNotas] = useState('')
  const [edError, setEdError] = useState('')

  const editingUser = editingId ? usuarios.find(u => u.id === editingId) ?? null : null

  function openEdit(u: UsuarioRow) {
    setEdRole(u.role)
    setEdActivo(u.activo)
    setEdExp(u.puede_exportar)
    setEdApr(u.puede_aprobar_gastos)
    setEdConf(u.puede_confirmar_pagos)
    setEdFondo(u.fondo_default_id ?? '')
    setEdNotas(u.notas_admin ?? '')
    setEdError('')
    setEditingId(u.id)
  }

  function handleEdRoleChange(r: UserRole) {
    setEdRole(r)
    if (r === 'admin') {
      setEdExp(true); setEdApr(true); setEdConf(true)
    }
  }

  function handleEdSubmit(e: React.FormEvent) {
    e.preventDefault()
    setEdError('')
    if (!editingUser) return
    const adminLocked = edRole === 'admin'
    startTransition(async () => {
      const result = await onUpdate(editingUser.id, {
        role: edRole,
        activo: edActivo,
        puede_exportar: adminLocked ? true : edExp,
        puede_aprobar_gastos: adminLocked ? true : edApr,
        puede_confirmar_pagos: adminLocked ? true : edConf,
        fondo_default_id: edFondo || null,
        notas_admin: edNotas.trim() || null,
      })
      if (!result.ok) { setEdError(result.error); return }
      setEditingId(null)
      setActionSuccess('Usuario actualizado')
    })
  }

  // ── Reset password modal ──────────────────────────────────────────────────
  const [resetTarget, setResetTarget] = useState<UsuarioRow | null>(null)
  const [rsPwd, setRsPwd] = useState('')
  const [rsPwd2, setRsPwd2] = useState('')
  const [rsError, setRsError] = useState('')

  function openReset(u: UsuarioRow) {
    setRsPwd(''); setRsPwd2(''); setRsError('')
    setResetTarget(u)
  }

  function handleRsSubmit(e: React.FormEvent) {
    e.preventDefault()
    setRsError('')
    if (!resetTarget) return
    if (rsPwd.length < 4) { setRsError('La contraseña debe tener al menos 4 caracteres.'); return }
    if (rsPwd !== rsPwd2) { setRsError('Las contraseñas no coinciden.'); return }
    startTransition(async () => {
      const result = await onResetPassword(resetTarget.id, rsPwd)
      if (!result.ok) { setRsError(result.error); return }
      const label = resetTarget.usuario_login ?? resetTarget.email
      setResetTarget(null)
      setActionSuccess(`Contraseña actualizada para "${label}".`)
    })
  }

  // ── Toggle activo ─────────────────────────────────────────────────────────
  function handleToggleActivo(u: UsuarioRow) {
    const accion = u.activo ? 'desactivar' : 'activar'
    if (!confirm(`¿${accion[0].toUpperCase() + accion.slice(1)} a ${u.usuario_login ?? u.email}?`)) return
    setActionError(''); setActionSuccess('')
    startTransition(async () => {
      const result = await onToggleActivo(u.id)
      if (!result.ok) { setActionError(result.error); return }
      setActionSuccess(`Usuario ${u.activo ? 'desactivado' : 'activado'}`)
    })
  }

  // ── Google whitelist modal ────────────────────────────────────────────────
  const [googleModalOpen, setGoogleModalOpen] = useState(false)
  const [editingGoogleId, setEditingGoogleId] = useState<string | null>(null)
  const [gEmail, setGEmail] = useState('')
  const [gRole, setGRole] = useState<UserRole>('user')
  const [gUsuarioLogin, setGUsuarioLogin] = useState('')
  const [gNombre, setGNombre] = useState('')
  const [gActivo, setGActivo] = useState(true)
  const [gNotas, setGNotas] = useState('')
  const [gError, setGError] = useState('')

  function openGoogleCrear() {
    setEditingGoogleId(null)
    setGEmail(''); setGRole('user'); setGUsuarioLogin(''); setGNombre('')
    setGActivo(true); setGNotas(''); setGError('')
    setGoogleModalOpen(true)
  }

  function openGoogleEdit(g: GoogleAllowedRow) {
    setEditingGoogleId(g.id)
    setGEmail(g.email)
    setGRole(g.role)
    setGUsuarioLogin(g.usuario_login ?? '')
    setGNombre(g.full_name ?? '')
    setGActivo(g.activo)
    setGNotas(g.notas_admin ?? '')
    setGError('')
    setGoogleModalOpen(true)
  }

  function handleGoogleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setGError('')
    const payload: GoogleAllowedPayload = {
      email: gEmail,
      role: gRole,
      usuario_login: gUsuarioLogin.trim() || null,
      full_name: gNombre.trim() || null,
      activo: gActivo,
      notas_admin: gNotas.trim() || null,
    }
    startTransition(async () => {
      const result = editingGoogleId
        ? await onUpdateGoogle(editingGoogleId, payload)
        : await onCrearGoogle(payload)
      if (!result.ok) { setGError(result.error); return }
      setGoogleModalOpen(false)
      setEditingGoogleId(null)
      setActionSuccess(editingGoogleId ? 'Autorización actualizada.' : `${payload.email} autorizado.`)
    })
  }

  function handleGoogleToggle(g: GoogleAllowedRow) {
    const accion = g.activo ? 'desactivar' : 'activar'
    if (!confirm(`¿${accion[0].toUpperCase() + accion.slice(1)} la autorización de ${g.email}?`)) return
    setActionError(''); setActionSuccess('')
    startTransition(async () => {
      const result = await onToggleGoogle(g.id)
      if (!result.ok) { setActionError(result.error); return }
      setActionSuccess(`Autorización ${g.activo ? 'desactivada' : 'activada'}`)
    })
  }

  function handleGoogleDelete(g: GoogleAllowedRow) {
    if (!confirm(`¿Eliminar la autorización de ${g.email}? Esto NO borra el usuario si ya entró antes; solo le quita el permiso de volver a entrar con Google.`)) return
    setActionError(''); setActionSuccess('')
    startTransition(async () => {
      const result = await onDeleteGoogle(g.id)
      if (!result.ok) { setActionError(result.error); return }
      setActionSuccess('Autorización eliminada.')
    })
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20'

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        Los permisos por usuario se guardan ahora. Su aplicación en exportar, aprobar gastos y confirmar pagos se activará en una próxima versión.
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>
      )}
      {actionSuccess && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{actionSuccess}</div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{usuarios.length} usuario{usuarios.length !== 1 ? 's' : ''}</p>
        <button
          onClick={openCrear}
          disabled={isPending}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
        >
          + Crear usuario
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {usuarios.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Sin usuarios.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Usuario</th>
                  <th className="hidden px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500 lg:table-cell">Email técnico</th>
                  <th className="hidden px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500 md:table-cell">Nombre</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Rol</th>
                  <th className="px-4 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Activo</th>
                  <th className="hidden px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500 xl:table-cell">Atributos</th>
                  <th className="hidden px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500 sm:table-cell">Creado</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {usuarios.map(u => {
                  const esYo = u.id === currentUserId
                  return (
                    <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5 text-sm">
                        <span className="font-medium text-gray-900">
                          {u.usuario_login ?? <span className="italic text-gray-400">— sin asignar</span>}
                        </span>
                        {esYo && <span className="ml-1.5 text-xs text-gray-400">(vos)</span>}
                      </td>
                      <td className="hidden px-4 py-2.5 text-xs text-gray-500 font-mono lg:table-cell">{u.email}</td>
                      <td className="hidden px-4 py-2.5 text-sm text-gray-600 md:table-cell">{u.full_name ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700">{ROLE_LABELS[u.role] ?? u.role}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${u.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          {u.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="hidden px-4 py-2.5 xl:table-cell">
                        <div className="flex gap-1">
                          <AttrChip label="Exp" on={u.puede_exportar} />
                          <AttrChip label="Apr.G" on={u.puede_aprobar_gastos} />
                          <AttrChip label="Conf.P" on={u.puede_confirmar_pagos} />
                        </div>
                      </td>
                      <td className="hidden px-4 py-2.5 text-sm text-gray-500 whitespace-nowrap sm:table-cell">{(u.created_at ?? '').slice(0, 10) || '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => openEdit(u)} disabled={isPending} className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50">Editar</button>
                          <button
                            onClick={() => handleToggleActivo(u)}
                            disabled={isPending || esYo}
                            className={`rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${u.activo ? 'text-amber-700 hover:bg-amber-50' : 'text-emerald-700 hover:bg-emerald-50'}`}
                            title={esYo ? 'No podés desactivarte a vos mismo' : ''}
                          >
                            {u.activo ? 'Desactivar' : 'Activar'}
                          </button>
                          <button onClick={() => openReset(u)} disabled={isPending} className="rounded px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-50">Reset</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Sección: Usuarios Google autorizados ─────────────────────────── */}
      <div className="pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Usuarios Google autorizados</h2>
            <p className="text-xs text-gray-500 mt-0.5">{googleAllowed.length} whitelist{googleAllowed.length !== 1 ? 'eados' : 'eado'}. Solo estos emails pueden entrar con Google.</p>
          </div>
          <button
            onClick={openGoogleCrear}
            disabled={isPending}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            + Autorizar Google
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {googleAllowed.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">Sin autorizaciones Google.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Email Google</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Rol</th>
                    <th className="hidden px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500 md:table-cell">Usuario interno</th>
                    <th className="hidden px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500 lg:table-cell">Nombre</th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Activo</th>
                    <th className="hidden px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500 sm:table-cell">Creado</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {googleAllowed.map(g => (
                    <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5 text-sm text-gray-900">{g.email}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700">{ROLE_LABELS[g.role] ?? g.role}</span>
                      </td>
                      <td className="hidden px-4 py-2.5 text-sm text-gray-600 md:table-cell">{g.usuario_login ?? <span className="text-gray-300">—</span>}</td>
                      <td className="hidden px-4 py-2.5 text-sm text-gray-600 lg:table-cell">{g.full_name ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${g.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          {g.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="hidden px-4 py-2.5 text-sm text-gray-500 whitespace-nowrap sm:table-cell">{(g.created_at ?? '').slice(0, 10) || '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => openGoogleEdit(g)} disabled={isPending} className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50">Editar</button>
                          <button
                            onClick={() => handleGoogleToggle(g)}
                            disabled={isPending}
                            className={`rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${g.activo ? 'text-amber-700 hover:bg-amber-50' : 'text-emerald-700 hover:bg-emerald-50'}`}
                          >
                            {g.activo ? 'Desactivar' : 'Activar'}
                          </button>
                          <button onClick={() => handleGoogleDelete(g)} disabled={isPending} className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">Eliminar</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal Autorizar Google (create + edit) */}
      {googleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              {editingGoogleId ? 'Editar autorización Google' : 'Autorizar usuario Google'}
            </h2>
            <form onSubmit={handleGoogleSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Email Google <span className="text-red-500">*</span></label>
                <input
                  type="email"
                  value={gEmail}
                  onChange={e => setGEmail(e.target.value)}
                  className={inputCls}
                  placeholder="persona@gmail.com"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus={!editingGoogleId}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Rol <span className="text-red-500">*</span></label>
                <RoleSelect value={gRole} onChange={setGRole} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Usuario interno (opcional)</label>
                <input
                  type="text"
                  value={gUsuarioLogin}
                  onChange={e => setGUsuarioLogin(e.target.value)}
                  className={inputCls}
                  placeholder="ej: anibal (minúsculas, . _ -)"
                  autoCapitalize="none"
                  spellCheck={false}
                />
                <p className="mt-0.5 text-xs text-gray-400">Si se completa, en su primer login se le asigna ese usuario_login.</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Nombre (opcional)</label>
                <input type="text" value={gNombre} onChange={e => setGNombre(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-700">
                  <input type="checkbox" checked={gActivo} onChange={e => setGActivo(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500" />
                  Activo
                </label>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Notas internas (opcional)</label>
                <textarea value={gNotas} onChange={e => setGNotas(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20" />
              </div>
              {gError && <p className="text-sm text-red-700">{gError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setGoogleModalOpen(false)} disabled={isPending} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={isPending} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
                  {isPending ? 'Guardando...' : editingGoogleId ? 'Guardar' : 'Autorizar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Crear usuario */}
      {crearOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Crear usuario</h2>
            <form onSubmit={handleCrSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Usuario <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={crLogin}
                  onChange={e => setCrLogin(e.target.value)}
                  className={inputCls}
                  placeholder="ej: anibal"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                />
                <p className="mt-0.5 text-xs text-gray-400">Solo minúsculas, números, punto, guión y guión bajo.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Contraseña <span className="text-red-500">*</span></label>
                  <input type="password" value={crPwd} onChange={e => setCrPwd(e.target.value)} className={inputCls} placeholder="min 4 chars" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Confirmar <span className="text-red-500">*</span></label>
                  <input type="password" value={crPwd2} onChange={e => setCrPwd2(e.target.value)} className={inputCls} placeholder="repetir" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Nombre completo</label>
                <input type="text" value={crNombre} onChange={e => setCrNombre(e.target.value)} className={inputCls} placeholder="opcional" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Rol <span className="text-red-500">*</span></label>
                <RoleSelect value={crRole} onChange={handleCrRoleChange} />
              </div>
              <PermisosBlock
                lockedAdmin={crRole === 'admin'}
                exp={crExp} setExp={setCrExp}
                apr={crApr} setApr={setCrApr}
                conf={crConf} setConf={setCrConf}
              />
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Fondo default</label>
                <select value={crFondo} onChange={e => setCrFondo(e.target.value)} className={inputCls}>
                  <option value="">Sin default</option>
                  {fondos.map(f => <option key={f.id} value={f.id}>{f.nombre} ({f.moneda})</option>)}
                </select>
              </div>
              {crError && <p className="text-sm text-red-700">{crError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setCrearOpen(false)} disabled={isPending} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={isPending} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
                  {isPending ? 'Creando...' : 'Crear usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Editar */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-1 text-lg font-semibold text-gray-900">Editar usuario</h2>
            <p className="mb-4 text-xs text-gray-500">{editingUser.usuario_login ?? editingUser.email}</p>
            <form onSubmit={handleEdSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Rol</label>
                <RoleSelect value={edRole} onChange={handleEdRoleChange} />
              </div>
              <div>
                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={edActivo}
                    onChange={e => setEdActivo(e.target.checked)}
                    disabled={editingUser.id === currentUserId}
                    className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
                  />
                  Activo
                  {editingUser.id === currentUserId && <span className="ml-1 text-xs text-gray-400">(no podés desactivarte)</span>}
                </label>
              </div>
              <PermisosBlock
                lockedAdmin={edRole === 'admin'}
                exp={edExp} setExp={setEdExp}
                apr={edApr} setApr={setEdApr}
                conf={edConf} setConf={setEdConf}
              />
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Fondo default</label>
                <select value={edFondo} onChange={e => setEdFondo(e.target.value)} className={inputCls}>
                  <option value="">Sin default</option>
                  {fondos.map(f => <option key={f.id} value={f.id}>{f.nombre} ({f.moneda})</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Notas internas</label>
                <textarea value={edNotas} onChange={e => setEdNotas(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20" placeholder="Notas del admin (opcional)" />
              </div>
              {edError && <p className="text-sm text-red-700">{edError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setEditingId(null)} disabled={isPending} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={isPending} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
                  {isPending ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Reset password */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-1 text-lg font-semibold text-gray-900">Resetear contraseña</h2>
            <p className="mb-4 text-xs text-gray-500">{resetTarget.usuario_login ?? resetTarget.email}</p>
            <form onSubmit={handleRsSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Nueva contraseña <span className="text-red-500">*</span></label>
                <input type="password" value={rsPwd} onChange={e => setRsPwd(e.target.value)} className={inputCls} placeholder="min 4 chars" autoFocus />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Confirmar <span className="text-red-500">*</span></label>
                <input type="password" value={rsPwd2} onChange={e => setRsPwd2(e.target.value)} className={inputCls} placeholder="repetir" />
              </div>
              <p className="text-xs text-gray-500">Compartí la contraseña con el usuario por un canal seguro (no aparece en email automático).</p>
              {rsError && <p className="text-sm text-red-700">{rsError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setResetTarget(null)} disabled={isPending} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={isPending} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
                  {isPending ? 'Cambiando...' : 'Cambiar contraseña'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function AttrChip({ label, on }: { label: string; on: boolean }) {
  return (
    <span className={`inline-flex rounded px-1.5 py-0 text-xs font-medium ${on ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>{label}</span>
  )
}

// Fase 2A: select de rol unificado. Muestra los 4 roles nuevos primero,
// los 3 legacy en un <optgroup> al final.
function RoleSelect({ value, onChange }: { value: UserRole; onChange: (r: UserRole) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as UserRole)}
      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20"
    >
      {NEW_ROLES.map(r => (
        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
      ))}
      <optgroup label="Legacy (deprecados)">
        {LEGACY_ROLES.map(r => (
          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
        ))}
      </optgroup>
    </select>
  )
}

function PermisosBlock({
  lockedAdmin, exp, setExp, apr, setApr, conf, setConf,
}: {
  lockedAdmin: boolean
  exp: boolean; setExp: (v: boolean) => void
  apr: boolean; setApr: (v: boolean) => void
  conf: boolean; setConf: (v: boolean) => void
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-2">
      <p className="text-xs font-medium text-gray-700">Permisos</p>
      {lockedAdmin && <p className="text-xs text-gray-400">Administrador tiene todos los permisos.</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={exp} onChange={e => setExp(e.target.checked)} disabled={lockedAdmin} className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500" />
        Puede exportar
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={apr} onChange={e => setApr(e.target.checked)} disabled={lockedAdmin} className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500" />
        Puede aprobar gastos
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={conf} onChange={e => setConf(e.target.checked)} disabled={lockedAdmin} className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500" />
        Puede confirmar pagos
      </label>
    </div>
  )
}
