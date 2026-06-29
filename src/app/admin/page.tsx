'use client'
import { useState, useEffect, useCallback } from 'react'
import { UserPlus, LogOut, RefreshCw, ToggleLeft, ToggleRight, KeyRound, Trash2, FolderPlus } from 'lucide-react'

type Portal = { id: string; slug: string; name: string; isActive: boolean }
type User = {
  id: string; email: string; name: string | null; isActive: boolean
  portalName: string | null; portalSlug: string | null; portalId: string
  createdAt: string; lastLoginAt: string | null
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [users, setUsers] = useState<User[]>([])
  const [portals, setPortals] = useState<Portal[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showCreatePortal, setShowCreatePortal] = useState(false)
  const [form, setForm] = useState({ portalId: '', email: '', name: '', password: '' })
  const [formError, setFormError] = useState('')
  const [resetUserId, setResetUserId] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [portalForm, setPortalForm] = useState({
    name: '', slug: '', clickupFolderId: '', clickupFolderUrl: '', clickupSpaceId: '90100136256',
    listId: '', listName: '',
  })
  const [portalFormError, setPortalFormError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [uRes, pRes] = await Promise.all([
      fetch('/api/admin/users'),
      fetch('/api/admin/portals'),
    ])
    if (uRes.ok) setUsers(await uRes.json().then((d: { users: User[] }) => d.users))
    if (pRes.ok) setPortals(await pRes.json().then((d: { portals: Portal[] }) => d.portals))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (authed) load()
  }, [authed, load])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail, password: loginPassword }),
    })
    if (res.ok) { setAuthed(true); setLoginError('') }
    else {
      const d = await res.json()
      setLoginError(d.error ?? 'Błąd logowania')
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) { setFormError(data.error?.formErrors?.[0] ?? data.error ?? 'Błąd'); return }
    setShowCreate(false)
    setForm({ portalId: '', email: '', name: '', password: '' })
    load()
  }

  async function handleCreatePortal(e: React.FormEvent) {
    e.preventDefault()
    setPortalFormError('')

    // Auto-extract folder ID from URL
    let folderId = portalForm.clickupFolderId
    if (!folderId && portalForm.clickupFolderUrl) {
      const match = portalForm.clickupFolderUrl.match(/\/f\/(\d+)/)
      if (match) folderId = match[1]
    }

    // Auto-generate slug from name
    const slug = portalForm.slug || portalForm.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

    const res = await fetch('/api/admin/portals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: portalForm.name,
        slug,
        clickupFolderId: folderId,
        clickupSpaceId: portalForm.clickupSpaceId,
        lists: [{ clickupListId: portalForm.listId, displayName: portalForm.listName || portalForm.name, isDefault: true }],
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      const err = data.error
      setPortalFormError(typeof err === 'string' ? err : JSON.stringify(err?.fieldErrors ?? err))
      return
    }
    setShowCreatePortal(false)
    setPortalForm({ name: '', slug: '', clickupFolderId: '', clickupFolderUrl: '', clickupSpaceId: '90100136256', listId: '', listName: '' })
    load()
  }

  async function toggleActive(user: User) {
    await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !user.isActive }),
    })
    load()
  }

  async function handleResetPassword(userId: string) {
    if (!newPassword || newPassword.length < 8) return
    await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    })
    setResetUserId(null)
    setNewPassword('')
  }

  async function handleDelete(userId: string) {
    if (!confirm('Na pewno usunąć tego użytkownika?')) return
    await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
    load()
  }

  if (!authed) return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary text-primary-foreground text-xl font-bold mb-4">i</div>
          <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
          <p className="text-sm text-muted-foreground mt-1">Client Portal — important.is</p>
        </div>
        <div className="bg-card rounded-xl border border-border shadow-sm p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
              <input
                type="email"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                autoFocus
                required
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="admin@important.is"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Hasło</label>
              <input
                type="password"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                required
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="••••••••"
              />
            </div>
            {loginError && <p className="text-sm text-destructive">{loginError}</p>}
            <button type="submit" className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
              Zaloguj
            </button>
          </form>
        </div>
      </div>
    </div>
  )

  const byPortal = portals.map(p => ({
    portal: p,
    users: users.filter(u => u.portalId === p.id),
  }))

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-foreground">Admin Panel</h1>
          <p className="text-xs text-muted-foreground">Client Portal — important.is</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md hover:bg-muted transition-colors disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Odśwież
          </button>
          <button
            onClick={() => setShowCreatePortal(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            <FolderPlus className="h-4 w-4" />
            Nowy portal
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
          >
            <UserPlus className="h-4 w-4" />
            Nowy użytkownik
          </button>
          <button
            onClick={async () => { await fetch('/api/admin/logout', { method: 'POST' }); setAuthed(false) }}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="p-6 max-w-4xl mx-auto space-y-8">
        {byPortal.map(({ portal, users: pu }) => (
          <section key={portal.id}>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
                {portal.name[0]}
              </div>
              <h2 className="font-semibold text-foreground">{portal.name}</h2>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">/{portal.slug}</span>
              {!portal.isActive && <span className="text-xs text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">nieaktywny</span>}
              <a
                href={`/${portal.slug}`}
                target="_blank"
                className="text-xs text-primary hover:underline ml-1"
              >
                ↗ otwórz portal
              </a>
              <span className="text-xs text-muted-foreground ml-auto">{pu.length} użytkownik{pu.length === 1 ? '' : pu.length < 5 ? 'i' : 'ów'}</span>
            </div>

            <div className="bg-card rounded-xl border border-border overflow-hidden">
              {pu.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4">Brak użytkowników</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Email</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Imię</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Ostatnie logowanie</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Akcje</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pu.map(user => (
                      <tr key={user.id} className={!user.isActive ? 'opacity-50' : ''}>
                        <td className="px-4 py-3">
                          <span className="font-medium text-foreground">{user.email}</span>
                          {!user.isActive && <span className="ml-2 text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full">nieaktywny</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{user.name ?? '—'}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString('pl-PL') : 'nigdy'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => toggleActive(user)} title={user.isActive ? 'Dezaktywuj' : 'Aktywuj'}
                              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                              {user.isActive ? <ToggleRight className="h-4 w-4 text-primary" /> : <ToggleLeft className="h-4 w-4" />}
                            </button>
                            <button onClick={() => { setResetUserId(user.id); setNewPassword('') }} title="Resetuj hasło"
                              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                              <KeyRound className="h-4 w-4" />
                            </button>
                            <button onClick={() => handleDelete(user.id)} title="Usuń użytkownika"
                              className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          {resetUserId === user.id && (
                            <div className="flex items-center gap-2 mt-2">
                              <input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                                placeholder="Nowe hasło (min. 8 znaków)" autoFocus
                                className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                              <button onClick={() => handleResetPassword(user.id)} disabled={newPassword.length < 8}
                                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors">
                                Zapisz
                              </button>
                              <button onClick={() => setResetUserId(null)}
                                className="h-8 px-3 rounded-md border border-input text-xs text-muted-foreground hover:text-foreground transition-colors">
                                Anuluj
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        ))}
      </main>

      {/* Create user modal */}
      {showCreate && (
        <>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={() => setShowCreate(false)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-card rounded-xl border border-border shadow-2xl z-50">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="font-semibold text-foreground">Nowy użytkownik</h2>
              <button onClick={() => setShowCreate(false)} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-lg leading-none">×</button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Portal</label>
                <select value={form.portalId} onChange={e => setForm(f => ({ ...f, portalId: e.target.value }))} required
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="">Wybierz portal...</option>
                  {portals.map(p => <option key={p.id} value={p.id}>{p.name} (/{p.slug})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Imię i nazwisko</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="Jan Kowalski" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="jan@firma.pl" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Hasło tymczasowe</label>
                <input type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={8}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="min. 8 znaków" />
              </div>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="flex-1 h-9 rounded-md border border-input bg-background text-sm hover:bg-accent transition-colors">Anuluj</button>
                <button type="submit"
                  className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">Utwórz</button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Create portal modal */}
      {showCreatePortal && (
        <>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={() => setShowCreatePortal(false)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-card rounded-xl border border-border shadow-2xl z-50">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="font-semibold text-foreground">Nowy portal</h2>
              <button onClick={() => setShowCreatePortal(false)} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-lg leading-none">×</button>
            </div>
            <form onSubmit={handleCreatePortal} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Nazwa klienta</label>
                  <input type="text" value={portalForm.name} onChange={e => setPortalForm(f => ({ ...f, name: e.target.value }))} required
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="Onyx" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Slug URL <span className="text-muted-foreground font-normal">(auto)</span></label>
                  <input type="text" value={portalForm.slug} onChange={e => setPortalForm(f => ({ ...f, slug: e.target.value }))}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder={portalForm.name ? portalForm.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : 'onyx'} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Link do folderu ClickUp</label>
                <input type="url" value={portalForm.clickupFolderUrl}
                  onChange={e => {
                    const url = e.target.value
                    const match = url.match(/\/f\/(\d+)/)
                    setPortalForm(f => ({ ...f, clickupFolderUrl: url, clickupFolderId: match ? match[1] : f.clickupFolderId }))
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="https://app.clickup.com/4552118/v/li/f/90129..." />
                {portalForm.clickupFolderId && (
                  <p className="text-xs text-green-600 mt-1">✓ Folder ID: {portalForm.clickupFolderId}</p>
                )}
              </div>
              {!portalForm.clickupFolderUrl && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Folder ID <span className="text-muted-foreground font-normal">(jeśli nie podajesz linku)</span></label>
                  <input type="text" value={portalForm.clickupFolderId} onChange={e => setPortalForm(f => ({ ...f, clickupFolderId: e.target.value }))}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="90129337874" />
                </div>
              )}
              <div className="border-t border-border pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Główna lista ClickUp</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">List ID</label>
                    <input type="text" value={portalForm.listId} onChange={e => setPortalForm(f => ({ ...f, listId: e.target.value }))} required
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="901201180992" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Nazwa listy</label>
                    <input type="text" value={portalForm.listName} onChange={e => setPortalForm(f => ({ ...f, listName: e.target.value }))}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      placeholder={portalForm.name || 'Projekty'} />
                  </div>
                </div>
              </div>
              {portalFormError && <p className="text-sm text-destructive">{portalFormError}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowCreatePortal(false)}
                  className="flex-1 h-9 rounded-md border border-input bg-background text-sm hover:bg-accent transition-colors">Anuluj</button>
                <button type="submit"
                  className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">Utwórz portal</button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
