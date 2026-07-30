/**
 * Zespół important.is dostępny jako kontakt na zakładce Dashboard.
 *
 * Lista w kodzie, nie w bazie, świadomie: skład zespołu zmienia się rzadko,
 * a wpis w bazie wymagałby własnego CRUD-a w panelu. Cena tej decyzji jest
 * jawna: dodanie osoby to jedna linijka tutaj plus deploy. Gdy skład zacznie
 * się zmieniać częściej niż raz na kwartał, to jest moment na tabelę.
 *
 * `id` jest zapisywane do `portals.contact_member_ids`, więc NIE zmieniaj
 * istniejących identyfikatorów. Zmiana odwiąże kontakt od projektów.
 */
export type TeamRole = 'technical' | 'pm'

export type TeamMember = {
  id: string
  name: string
  role: TeamRole
  roleLabel: string
  email: string
  /** Null, gdy nie podano. Dashboard wtedy nie rysuje wiersza z telefonem. */
  phone: string | null
}

export const TEAM_MEMBERS: readonly TeamMember[] = [
  {
    id: 'filip',
    // Same imiona, bez nazwisk: nie zgaduję ich z adresu e-mail. Jeśli mają
    // być pełne, trzeba je podać, a nie wyprowadzać z części przed małpą.
    name: 'Filip',
    role: 'technical',
    roleLabel: 'Opiekun techniczny',
    email: 'filip.g@important.is',
    phone: null,
  },
  {
    id: 'paulina',
    name: 'Paulina',
    role: 'pm',
    roleLabel: 'Project manager',
    email: 'paulina.a@important.is',
    phone: null,
  },
]

/** Domyślny skład kontaktów dla nowego projektu: cały zespół. */
export const DEFAULT_CONTACT_MEMBER_IDS = TEAM_MEMBERS.map(m => m.id)

export function findTeamMember(id: string): TeamMember | undefined {
  return TEAM_MEMBERS.find(m => m.id === id)
}

/**
 * Zamienia zapis z kolumny (`"filip,paulina"`) na obiekty zespołu.
 *
 * Nieznane identyfikatory są pomijane po cichu. To celowe: usunięcie osoby z
 * TEAM_MEMBERS nie może wysadzić Dashboardu projektów, które ją miały
 * przypisaną. Kolejność wynika z TEAM_MEMBERS, nie z zapisu w bazie, żeby
 * kolejność na stronie była taka sama we wszystkich projektach.
 */
export function parseContactMemberIds(raw: string | null | undefined): TeamMember[] {
  if (raw === null || raw === undefined) return []
  const wanted = new Set(
    raw.split(',').map(s => s.trim()).filter(s => s.length > 0)
  )
  return TEAM_MEMBERS.filter(m => wanted.has(m.id))
}

/** Serializuje wybór do kolumny. Odfiltrowuje nieistniejące identyfikatory. */
export function serializeContactMemberIds(ids: string[]): string {
  const valid = TEAM_MEMBERS.filter(m => ids.includes(m.id)).map(m => m.id)
  return valid.join(',')
}
