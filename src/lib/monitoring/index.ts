import 'server-only'
import { unstable_cache } from 'next/cache'
import { listMonitors, monitorStats, listRuns } from './supercheck'
import { projectHosts } from './match'
import { projectMonitors, aggregateUptime, lastRunForProject, type UptimeView, type TestsView } from './status'
import { fetchSpeed, isPagespeedConfigured, type SpeedView } from './pagespeed'

/**
 * „Stan strony" dla jednego projektu: dostępność, testy, szybkość.
 *
 * Wszystko jedzie przez cache, bo to jest dodatek do Dashboardu, a nie jego
 * treść: klient wchodzący na stronę nie ma czekać na trzy cudze API. Okna są
 * różne, bo dane zmieniają się w różnym tempie — monitory co kilka minut,
 * PageSpeed to ciężki pomiar, którego nie ma sensu robić częściej niż raz na
 * dobę (i za który płacimy limitem).
 *
 * Każde źródło może zawieść osobno i wtedy jego kafel mówi „nie wiemy".
 * Milczące zero byłoby gorsze: „0%" czyta się jak „strona nie działa".
 */

const OKNO_DNI = 30
const CACHE_MONITORING_S = 15 * 60
const CACHE_SPEED_S = 24 * 60 * 60

export interface SiteStatus {
  uptime: UptimeView | null
  tests: TestsView | null
  speed: SpeedView | null
  /** Dlaczego pusto, gdy pusto. Widget mówi to klientowi wprost. */
  powod: 'brak-tokenu' | 'brak-domen' | 'brak-monitorow' | 'blad' | null
}

async function pobierzSuperCheck(
  token: string,
  hosts: string[],
  portalName: string,
): Promise<{ uptime: UptimeView | null; tests: TestsView | null; powod: SiteStatus['powod'] }> {
  const [monitory, przebiegi] = await Promise.all([listMonitors(token), listRuns(token)])
  if (monitory === null && przebiegi === null) return { uptime: null, tests: null, powod: 'blad' }

  const nasze = projectMonitors(monitory ?? [], hosts)
  // Statystyki po jednym zapytaniu na monitor. Lista projektu jest krótka
  // (rzędu kilku), a cache trzyma wynik przez kwadrans.
  const statystyki = new Map(
    (
      await Promise.all(
        nasze.map(async m => {
          const s = await monitorStats(token, m.id, OKNO_DNI)
          return s ? ([m.id, s] as const) : null
        }),
      )
    ).filter((x): x is readonly [string, NonNullable<Awaited<ReturnType<typeof monitorStats>>>] => x !== null),
  )

  const uptime = aggregateUptime(nasze, statystyki, OKNO_DNI)
  const tests = lastRunForProject(przebiegi ?? [], hosts, portalName)
  const powod = !uptime && !tests ? (nasze.length === 0 ? 'brak-monitorow' : 'blad') : null
  return { uptime, tests, powod }
}

export async function getSiteStatus(portal: {
  id: string
  name: string
  siteDomains: string | null
  supercheckToken: string | null
}): Promise<SiteStatus> {
  const hosts = projectHosts(portal.siteDomains)
  if (hosts.length === 0) return { uptime: null, tests: null, speed: null, powod: 'brak-domen' }
  if (!portal.supercheckToken) return { uptime: null, tests: null, speed: null, powod: 'brak-tokenu' }

  /* Klucz cache'u zawiera identyfikator projektu, więc dane jednego klienta
     nie mogą trafić na Dashboard drugiego — to jest ważniejsze niż sam zysk
     na czasie. Tokenu w kluczu NIE MA: nie wpisujemy sekretów do nazw. */
  const zSuperChecka = unstable_cache(
    () => pobierzSuperCheck(portal.supercheckToken!, hosts, portal.name),
    ['monitoring', 'supercheck', portal.id],
    { revalidate: CACHE_MONITORING_S, tags: [`monitoring:${portal.id}`] },
  )

  const szybkosc = unstable_cache(
    () => fetchSpeed(`https://${hosts[0]}`),
    ['monitoring', 'pagespeed', portal.id],
    { revalidate: CACHE_SPEED_S, tags: [`monitoring:${portal.id}`] },
  )

  const [sc, speed] = await Promise.all([
    zSuperChecka(),
    isPagespeedConfigured() ? szybkosc() : Promise.resolve(null),
  ])

  return { uptime: sc.uptime, tests: sc.tests, speed, powod: sc.powod }
}
