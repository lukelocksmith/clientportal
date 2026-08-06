'use client'

import { useState, useEffect, useCallback } from 'react'
import { UserPlus, LogOut, RefreshCw, ToggleLeft, ToggleRight, KeyRound, Trash2, FolderPlus, Send, Loader2, History } from 'lucide-react'
import { PORTAL_TABS, type PortalFlags } from '@/lib/portalTabs'
import { PortalConfigForm } from '@/components/admin/PortalConfigForm'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { UserActivityDialog } from '@/components/admin/UserActivityDialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProjectAiStats } from '@/components/admin/ProjectAiStats'
import { AiUsageStats } from '@/components/admin/AiUsageStats'
import { AdminLoginScreen } from '@/components/admin/AdminLoginScreen'
import { ProjectEvents } from '@/components/admin/ProjectEvents'
import { ProjectSyncLog } from '@/components/admin/ProjectSyncLog'
import { ProjectMailLog } from '@/components/admin/ProjectMailLog'
import { plural, USERS } from '@/lib/plural'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Portal = {
  id: string; slug: string; name: string; isActive: boolean
  logoUrl: string | null; brandColor: string | null
  contactMemberIds: string | null
  contactName: string | null; contactEmail: string | null; contactPhone: string | null
} & PortalFlags
type Stat = { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number }
type Stats = {
  totals: Stat
  byProject: Array<Stat & { portalId: string; slug: string | null; name: string | null; lastUsedAt: string | null }>
  byUser: Array<Stat & { userEmail: string | null }>
  byModel: Array<Stat & { provider: string; model: string }>
  /** Rozbicia z kluczem projektu, pod zakładkę „Zużycie AI" w karcie projektu. */
  byProjectUser: Array<Stat & { portalId: string; userEmail: string | null }>
  byProjectModel: Array<Stat & { portalId: string; provider: string; model: string }>
}

type User = {
  id: string; email: string; name: string | null; isActive: boolean
  portalName: string | null; portalSlug: string | null; portalId: string
  createdAt: string; lastLoginAt: string | null
}

export default function AdminPanel() {
  const [authed, setAuthed] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [portals, setPortals] = useState<Portal[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showCreatePortal, setShowCreatePortal] = useState(false)
  const [form, setForm] = useState({ portalId: '', email: '', name: '', password: '' })
  const [formError, setFormError] = useState('')
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string; reason: string } | null>(null)
  const [resetUserId, setResetUserId] = useState<string | null>(null)
  // Historia jednej osoby. Wczytuje sie po otwarciu okna, nie razem z lista.
  const [activityUserId, setActivityUserId] = useState<string | null>(null)
  /** Id uzytkownika, do ktorego wlasnie leci link. Blokuje przycisk, zeby
      dwuklik nie uniewaznil swiezo wyslanego zaproszenia drugim. */
  const [sendingInvite, setSendingInvite] = useState<string | null>(null)
  const [inviteResult, setInviteResult] = useState<{ userId: string; ok: boolean; text: string } | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [portalForm, setPortalForm] = useState({
    name: '', slug: '', clickupFolderId: '', clickupSpaceId: '90100136256',
    listId: '', listName: '',
  })
  const [portalFormError, setPortalFormError] = useState('')
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([])
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [availableLists, setAvailableLists] = useState<Array<{ id: string; name: string }>>([])
  const [listsLoading, setListsLoading] = useState(false)

  async function openCreatePortal() {
    setShowCreatePortal(true)
    setFoldersLoading(true)
    setFolders([])
    setAvailableLists([])
    setPortalForm({ name: '', slug: '', clickupFolderId: '', clickupSpaceId: '90100136256', listId: '', listName: '' })
    setPortalFormError('')
    const res = await fetch('/api/admin/clickup/folders')
    if (res.ok) setFolders(await res.json().then((d: { folders: Array<{ id: string; name: string }> }) => d.folders))
    setFoldersLoading(false)
  }

  async function handleFolderSelect(folderId: string) {
    const folder = folders.find(f => f.id === folderId)
    setPortalForm(f => ({
      ...f,
      clickupFolderId: folderId,
      listId: '',
      listName: '',
      name: f.name || (folder?.name ?? ''),
    }))
    setAvailableLists([])
    if (!folderId) return
    setListsLoading(true)
    const res = await fetch(`/api/admin/clickup/folders/${folderId}/lists`)
    if (res.ok) setAvailableLists(await res.json().then((d: { lists: Array<{ id: string; name: string }> }) => d.lists))
    setListsLoading(false)
  }

  /** Zwraca false, gdy serwer odrzucil zadania, czyli sesja admina nie dziala. */
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [uRes, pRes, sRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/portals'),
        fetch('/api/admin/stats'),
      ])
      if (uRes.ok) setUsers(await uRes.json().then((d: { users: User[] }) => d.users))
      if (pRes.ok) setPortals(await pRes.json().then((d: { portals: Portal[] }) => d.portals))
      if (sRes.ok) setStats(await sRes.json() as Stats)
      return pRes.ok
    } catch (e) {
      // BEZ tego panel wisial na "Ladowanie panelu..." NA ZAWSZE: wolajacy
      // czekal na `.then`, ktore przy odrzuconej obietnicy nigdy nie przychodzi.
      // Jedno zerwane polaczenie albo odpowiedz, ktora nie jest JSON-em,
      // wystarczaly, zeby panel zamilkl bez komunikatu.
      console.error('[admin] nie udalo sie pobrac danych panelu:', e)
      setLoadError('Nie udalo sie pobrac danych panelu. Odswiez strone.')
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * Sprawdzenie istniejacej sesji przy wejsciu na strone.
   *
   * `authed` to zwykly stan Reacta, wiec bez tego kazde odswiezenie /admin
   * pokazywalo formularz logowania, mimo ze ciasteczko admina zyje 8 godzin.
   * Wygladalo to jak wygasajaca sesja, a bylo brakiem jej sprawdzenia.
   *
   * Probujemy pobrac dane; 200 znaczy, ze ciasteczko dziala. Dzieki temu nie
   * ma osobnego endpointu "czy jestem zalogowany", a jedno zadanie robi obie
   * rzeczy: weryfikuje i wypelnia panel.
   */
  const [checkingSession, setCheckingSession] = useState(true)
  useEffect(() => {
    let cancelled = false
    // setState leci w callbacku obietnicy, czyli w mikrozadaniu PO renderze,
    // a nie w ciele efektu, wiec kaskady renderow tu nie ma. Regula nie
    // odroznia tych dwoch przypadkow, a trzy proby przebudowy tego miejsca
    // dawaly gorszy kod i NOWE bledy lintu, wiec zostaje wyciszenie z opisem.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().then(ok => {
      if (cancelled) return
      if (ok) setAuthed(true)
      setCheckingSession(false)
    })
    return () => { cancelled = true }
    // Tylko na wejsciu. Kolejne pobrania ida przez handleLogin i Odswiez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    // Puste hasło jest ścieżką domyślną: serwer wysyła zaproszenie mailem,
    // a użytkownik ustawia hasło sam. Dlatego pola nie wysyłamy, gdy puste.
    const payload: Record<string, string> = {
      portalId: form.portalId,
      email: form.email,
      name: form.name,
    }
    if (form.password.trim()) payload.password = form.password.trim()

    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) { setFormError(data.error?.formErrors?.[0] ?? data.error ?? 'Błąd'); return }

    // Gdy mail nie poszedł (brak SMTP albo błąd wysyłki), pokazujemy link do
    // przekazania z ręki. Bez tego konto istniałoby, a nikt nie mógłby wejść.
    if (data.invite && !data.invite.sent && data.invite.url) {
      setInviteLink({ email: data.user.email, url: data.invite.url, reason: data.invite.reason })
    } else {
      setShowCreate(false)
    }
    setForm({ portalId: '', email: '', name: '', password: '' })
    load()
  }

  async function handleCreatePortal(e: React.FormEvent) {
    e.preventDefault()
    setPortalFormError('')

    // Auto-generate slug from name
    const slug = portalForm.slug || portalForm.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

    const res = await fetch('/api/admin/portals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: portalForm.name,
        slug,
        clickupFolderId: portalForm.clickupFolderId,
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
    setPortalForm({ name: '', slug: '', clickupFolderId: '', clickupSpaceId: '90100136256', listId: '', listName: '' })
    load()
  }

  /**
   * Włącza albo wyłącza jedną zakładkę dla jednego projektu.
   * Optymistycznie odbija checkbox, żeby nie czekać na przeładowanie listy,
   * i cofa go, gdy zapis się nie udał.
   */
  async function toggleFlag(portal: Portal, flag: keyof PortalFlags) {
    const next = !portal[flag]
    setPortals(prev => prev.map(p => (p.id === portal.id ? { ...p, [flag]: next } : p)))

    const res = await fetch('/api/admin/portals', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: portal.slug, [flag]: next }),
    })

    if (!res.ok) {
      setPortals(prev => prev.map(p => (p.id === portal.id ? { ...p, [flag]: !next } : p)))
    }
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

  /**
   * Wysyla uzytkownikowi link do ustawienia hasla.
   *
   * Poprzednie zaproszenia tracą moc, wiec potwierdzenie mowi to wprost:
   * admin musi wiedziec, ze stary link przestal dzialac, zanim klient zadzwoni,
   * ze "ten z wczoraj nie dziala".
   */
  async function handleSendInvite(userId: string, email: string) {
    setSendingInvite(userId)
    setInviteResult(null)
    try {
      const res = await fetch('/api/admin/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setInviteResult({ userId, ok: false, text: data?.error ?? 'Nie udalo sie wyslac.' })
        return
      }
      if (data?.sent) {
        setInviteResult({ userId, ok: true, text: `Wyslane na ${email}. Poprzednie linki tego uzytkownika przestaly dzialac.` })
      } else {
        // Mail nie poszedl: pokazujemy link, zeby bylo co przekazac inna droga.
        setInviteResult({
          userId,
          ok: false,
          text: `Mail NIE wyszedl (${data?.reason ?? 'blad'}). Link do przekazania: ${data?.url ?? 'brak'}`,
        })
      }
    } catch {
      setInviteResult({ userId, ok: false, text: 'Brak polaczenia.' })
    } finally {
      setSendingInvite(null)
    }
  }

  async function handleDelete(userId: string) {
    if (!confirm('Na pewno usunąć tego użytkownika?')) return
    await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
    load()
  }

  // Bez tego przy waznej sesji formularz logowania mignalby na ekranie,
  // zanim sprawdzenie wroci.
  if (checkingSession) return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <p className="text-sm text-muted-foreground">Ładowanie panelu...</p>
    </div>
  )

  // Blad pobrania nie moze konczyc sie milczeniem.
  if (loadError && !authed) return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="text-center">
        <p className="text-sm text-destructive">{loadError}</p>
        <button
          onClick={() => { setLoadError(null); setCheckingSession(true); load().then(ok => { if (ok) setAuthed(true); setCheckingSession(false) }) }}
          className="mt-3 text-xs text-muted-foreground underline"
        >
          Spróbuj ponownie
        </button>
      </div>
    </div>
  )

  if (!authed) return (
    <AdminLoginScreen onLoggedIn={async () => { setAuthed(true); await load() }} />
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
          <Button onClick={load} disabled={loading} variant="ghost" size="sm" className="text-muted-foreground">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Odśwież
          </Button>
          <Button
            onClick={openCreatePortal}
            variant="outline" size="sm"
          >
            <FolderPlus className="h-4 w-4" />
            Nowy portal
          </Button>
          <Button
            onClick={() => setShowCreate(true)}
            size="sm"
          >
            <UserPlus className="h-4 w-4" />
            Nowy użytkownik
          </Button>
          <Button
            onClick={async () => { await fetch('/api/admin/logout', { method: 'POST' }); setAuthed(false) }}
            variant="ghost" size="iconSm" className="text-muted-foreground"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="p-6 max-w-4xl mx-auto space-y-8">
        {stats && (
          <AiUsageStats
            totals={stats.totals}
            byProject={stats.byProject}
            byUser={stats.byUser}
            byModel={stats.byModel}
          />
        )}

        {/* Projekty w zakladkach, nie jedna sekcja pod druga: przy szesnastu
            folderach klientow lista pionowa byla nie do przejscia.
            overflow-x-auto na liscie, bo poziomy pasek zakladek musi sie dac
            przewinac, a nie rozpychac strony. */}
        <Tabs defaultValue={byPortal[0]?.portal.slug} className="gap-4">
          <div className="overflow-x-auto">
            <TabsList className="w-max">
              {byPortal.map(({ portal, users: pu }) => (
                <TabsTrigger key={portal.id} value={portal.slug} className="gap-1.5">
                  {portal.name}
                  {/* Licznik userow na samej zakladce: widac go bez wchodzenia
                      w projekt, a to najczestsze pytanie przy tej liscie. */}
                  <span className="text-[10px] text-muted-foreground">{pu.length}</span>
                  {!portal.isActive && (
                    <span className="text-[10px] text-destructive">nieaktywny</span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {byPortal.map(({ portal, users: pu }) => (
          <TabsContent key={portal.id} value={portal.slug} className="mt-0">
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
                className="ml-1 text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline"
              >
                ↗ otwórz portal
              </a>
              <span className="ml-auto text-xs text-muted-foreground">{plural(pu.length, USERS)}</span>
            </div>

            <Tabs defaultValue="konfiguracja">
              <TabsList>
                <TabsTrigger value="konfiguracja">Konfiguracja</TabsTrigger>
                <TabsTrigger value="uzytkownicy">Użytkownicy</TabsTrigger>
                <TabsTrigger value="ai">Zużycie AI</TabsTrigger>
                <TabsTrigger value="zgloszenia">Zgłoszenia</TabsTrigger>
                <TabsTrigger value="synchronizacja">Synchronizacja</TabsTrigger>
                <TabsTrigger value="poczta">Poczta</TabsTrigger>
              </TabsList>

              <TabsContent value="konfiguracja">
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  {/* Zakładki per projekt. Każda poza kanbanem startuje wyłączona.
                      Zakładka, której strona jeszcze nie istnieje (implemented:
                      false), daje się tu włączyć, ale w portalu pojawi się dopiero
                      po wdrożeniu strony. Dopisek "wkrótce" mówi to wprost, żeby
                      włączenie nie wyglądało na zepsute. */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 px-4 py-3">
                    {/* Bez etykiety grupy nie wiadomo, czym sa te ptaszki:
                        wygladaly jak luzne opcje, a sa lista zakladek portalu. */}
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Zakładki w portalu
                    </span>
                    {PORTAL_TABS.map(tab => (
                      <label
                        key={tab.key}
                        title={tab.implemented ? undefined : 'Strona jeszcze nie wdrożona, zakładka pojawi się po wdrożeniu'}
                        className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none"
                      >
                        <input
                          type="checkbox"
                          checked={portal[tab.flag]}
                          onChange={() => toggleFlag(portal, tab.flag)}
                          className="h-3.5 w-3.5 cursor-pointer accent-foreground"
                        />
                        {tab.label}
                        {!tab.implemented && (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">wkrótce</span>
                        )}
                      </label>
                    ))}
                  </div>
                  {/* Marka projektu nad listą userów: to konfiguracja projektu,
                      nie użytkownika. Zapis idzie tą samą trasą PATCH co flagi. */}
                  <PortalConfigForm
                    portal={portal}
                    onSaved={changes =>
                      setPortals(prev =>
                        prev.map(p => (p.id === portal.id ? { ...p, ...changes } : p))
                      )
                    }
                  />
                </div>
              </TabsContent>

              <TabsContent value="uzytkownicy">
                <div className="overflow-hidden rounded-xl border border-border bg-card">
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
                                <Button onClick={() => setActivityUserId(user.id)} title="Historia: zgloszenia, wejscia, maile"
                                  variant="ghost" size="iconSm" className="text-muted-foreground">
                                  <History className="h-4 w-4" />
                                </Button>
                                <Button onClick={() => toggleActive(user)} title={user.isActive ? 'Dezaktywuj' : 'Aktywuj'}
                                  variant="ghost" size="iconSm" className="text-muted-foreground">
                                  {user.isActive ? <ToggleRight className="h-4 w-4 text-primary" /> : <ToggleLeft className="h-4 w-4" />}
                                </Button>
                                <Button
                                  onClick={() => handleSendInvite(user.id, user.email)}
                                  disabled={sendingInvite === user.id}
                                  title="Wyślij mailem link do ustawienia hasła"
                                  variant="ghost" size="iconSm" className="text-muted-foreground"
                                >
                                  {sendingInvite === user.id
                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : <Send className="h-4 w-4" />}
                                </Button>
                                <Button onClick={() => { setResetUserId(user.id); setNewPassword('') }} title="Ustaw hasło z ręki (bez maila)"
                                  variant="ghost" size="iconSm" className="text-muted-foreground">
                                  <KeyRound className="h-4 w-4" />
                                </Button>
                                <Button onClick={() => handleDelete(user.id)} title="Usuń użytkownika"
                                  variant="ghost" size="iconSm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                              {inviteResult?.userId === user.id && (
                                <p className={`mt-2 text-xs ${inviteResult.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
                                  {inviteResult.text}
                                </p>
                              )}
                              {resetUserId === user.id && (
                                <div className="flex items-center gap-2 mt-2">
                                  <Input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                                    placeholder="Nowe hasło (min. 8 znaków)" autoFocus
                                    className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                                  <Button onClick={() => handleResetPassword(user.id)} disabled={newPassword.length < 8}
                                    size="xs">
                                    Zapisz
                                  </Button>
                                  <Button onClick={() => setResetUserId(null)}
                                    variant="outline" size="xs" className="text-muted-foreground">
                                    Anuluj
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="ai">
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  {stats ? (
                    <ProjectAiStats
                      portalId={portal.id}
                      byProject={stats.byProject}
                      byProjectUser={stats.byProjectUser}
                      byProjectModel={stats.byProjectModel}
                    />
                  ) : (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Ładowanie statystyk...
                    </p>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="zgloszenia">
                {/* Montowane dopiero po wejściu w zakładkę: Radix domyślnie nie
                    renderuje nieaktywnej treści, więc zapytanie o historię
                    wszystkich projektów nie leci przy wejściu do panelu. */}
                <ProjectEvents slug={portal.slug} />
              </TabsContent>

              <TabsContent value="synchronizacja">
                <ProjectSyncLog slug={portal.slug} />
              </TabsContent>

              <TabsContent value="poczta">
                <ProjectMailLog slug={portal.slug} />
              </TabsContent>
            </Tabs>
          </TabsContent>
          ))}
        </Tabs>
      </main>

      {/* Historia jednej osoby: zgloszenia, wejscia, maile. */}
      <UserActivityDialog userId={activityUserId} onClose={() => setActivityUserId(null)} />

      {/* Nowy uzytkownik. Dialog z Radiksa daje Escape, pulapke fokusa i
          aria-modal, ktorych reczny modal nie mial. */}
      <Dialog
        open={showCreate}
        onOpenChange={open => {
          if (!open) { setShowCreate(false); setInviteLink(null) }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{inviteLink ? 'Konto utworzone' : 'Nowy użytkownik'}</DialogTitle>
          </DialogHeader>

          {/* Mail nie poszedl, wiec pokazujemy link do przekazania z reki.
              Bez tego konto by istnialo, a nikt nie moglby na nie wejsc. */}
          {inviteLink && (
            <div className="space-y-3">
              <p className="text-sm text-foreground">
                Konto <span className="font-medium">{inviteLink.email}</span> jest gotowe, ale
                {inviteLink.reason === 'not-configured'
                  ? ' SMTP nie jest skonfigurowany, więc mail nie wyszedł.'
                  : ' wysyłka maila się nie udała.'}
              </p>
              <p className="text-sm text-muted-foreground">
                Przekaż ten link. Jest jednorazowy i wygasa po 72 godzinach.
              </p>
              <textarea
                readOnly
                value={inviteLink.url}
                onClick={e => (e.target as HTMLTextAreaElement).select()}
                className="w-full resize-none rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-xs text-foreground"
                rows={3}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => { setShowCreate(false); setInviteLink(null) }}
                >
                  Gotowe
                </Button>
              </div>
            </div>
          )}

          {!inviteLink && (
          <>
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
                <Input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required
                  placeholder="Jan Kowalski" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required
                  placeholder="jan@firma.pl" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Hasło <span className="font-normal text-muted-foreground">(zostaw puste)</span>
                </label>
                <p className="mb-1.5 text-xs text-muted-foreground">
                  Puste pole to wariant domyślny: użytkownik dostanie mailem link i ustawi hasło sam,
                  więc my go nie poznamy. Wpisz hasło tylko wtedy, gdy ktoś nie ma dostępu do maila.
                </p>
                <Input type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} minLength={8}
                  placeholder="min. 8 znaków" />
              </div>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <div className="flex gap-3 pt-1">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>Anuluj</Button>
                <Button type="submit" className="flex-1">Utwórz</Button>
              </div>
            </form>
          </>
          )}
        </DialogContent>
      </Dialog>

      {/* Nowy portal. Jak wyzej: Escape i fokus z Radiksa. */}
      <Dialog open={showCreatePortal} onOpenChange={open => !open && setShowCreatePortal(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nowy portal</DialogTitle>
          </DialogHeader>
            <form onSubmit={handleCreatePortal} className="p-5 space-y-4">
              {/* Step 1: pick folder */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Folder ClickUp
                  {foldersLoading && <span className="ml-2 text-xs text-muted-foreground">Ładowanie...</span>}
                </label>
                <select
                  value={portalForm.clickupFolderId}
                  onChange={e => handleFolderSelect(e.target.value)}
                  required
                  disabled={foldersLoading}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                >
                  <option value="">— wybierz folder —</option>
                  {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>

              {/* Step 2: pick list */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Lista ClickUp
                  {listsLoading && <span className="ml-2 text-xs text-muted-foreground">Ładowanie...</span>}
                </label>
                <select
                  value={portalForm.listId}
                  onChange={e => {
                    const list = availableLists.find(l => l.id === e.target.value)
                    setPortalForm(f => ({ ...f, listId: e.target.value, listName: list?.name ?? '' }))
                  }}
                  required
                  disabled={!portalForm.clickupFolderId || listsLoading}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                >
                  <option value="">— wybierz listę —</option>
                  {availableLists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>

              {/* Step 3: name + slug */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Nazwa klienta</label>
                  <Input type="text" value={portalForm.name} onChange={e => setPortalForm(f => ({ ...f, name: e.target.value }))} required
                    placeholder="Onyx" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Slug URL <span className="text-muted-foreground font-normal">(auto)</span></label>
                  <Input type="text" value={portalForm.slug} onChange={e => setPortalForm(f => ({ ...f, slug: e.target.value }))}
                   
                    placeholder={portalForm.name ? portalForm.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : 'onyx'} />
                </div>
              </div>
              {portalFormError && <p className="text-sm text-destructive">{portalFormError}</p>}
              <div className="flex gap-3 pt-1">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setShowCreatePortal(false)}>Anuluj</Button>
                <Button type="submit" className="flex-1">Utwórz portal</Button>
              </div>
            </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
