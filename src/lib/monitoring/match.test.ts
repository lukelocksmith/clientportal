/**
 * Granica między klientami przy widgetach „Stan strony".
 *
 * Pomyłka w tych funkcjach nie daje błędu, tylko cudze liczby na ekranie
 * klienta, więc testy są tu ostrzejsze niż zwykle.
 *
 *   npx vitest run src/lib/monitoring/match.test.ts
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import { normalizeHost, projectHosts, targetBelongsToProject, jobBelongsToProject } from '@/lib/monitoring/match'

describe('domeny projektu', () => {
  it('zdejmuje protokol, sciezke, port i www', () => {
    assert.strictEqual(normalizeHost('https://www.wodadlafirmy.pl/kontakt'), 'wodadlafirmy.pl')
    assert.strictEqual(normalizeHost('  HTTP://Onyx.PL:8443  '), 'onyx.pl')
  })

  it('czyta liste po przecinku i odrzuca smieci', () => {
    assert.deepStrictEqual(projectHosts('wodadlafirmy.pl, staging.wodadlafirmy.pl'), ['wodadlafirmy.pl', 'staging.wodadlafirmy.pl'])
    assert.deepStrictEqual(projectHosts(''), [])
    assert.deepStrictEqual(projectHosts(null), [])
    assert.deepStrictEqual(projectHosts('localhost, , ???'), [], 'wpis bez kropki to nie domena')
  })
})

describe('monitor a projekt', () => {
  const hosts = ['wodadlafirmy.pl']

  it('trafia w domene i jej subdomeny', () => {
    assert.strictEqual(targetBelongsToProject('https://wodadlafirmy.pl/', hosts), true)
    assert.strictEqual(targetBelongsToProject('https://www.wodadlafirmy.pl', hosts), true)
    assert.strictEqual(targetBelongsToProject('https://sklep.wodadlafirmy.pl/koszyk', hosts), true)
  })

  it('NIE trafia w domene, ktora tylko konczy sie tak samo', () => {
    // To jest ten blad, ktorego nikt by nie zauwazyl: liczby wygladaja dobrze,
    // tylko naleza do kogos innego.
    assert.strictEqual(targetBelongsToProject('https://niewodadlafirmy.pl', hosts), false)
    assert.strictEqual(targetBelongsToProject('https://wodadlafirmy.pl.evil.com', hosts), false)
  })

  it('brak adresu albo brak domen projektu to brak dopasowania', () => {
    assert.strictEqual(targetBelongsToProject(null, hosts), false)
    assert.strictEqual(targetBelongsToProject('https://wodadlafirmy.pl', []), false)
  })
})

describe('zadanie testowe a projekt', () => {
  it('trafia po domenie w nazwie zadania', () => {
    assert.strictEqual(jobBelongsToProject('important.is - monitoring E2E', ['important.is'], 'important.is'), true)
  })

  it('trafia po nazwie projektu, gdy nazwa jest dostatecznie dluga', () => {
    assert.strictEqual(jobBelongsToProject('WDF – koszyk', ['wodadlafirmy.pl'], 'WDF'), true)
  })

  it('krotka nazwa projektu NIE lapie przypadkowych zadan', () => {
    // „L-ka" po obcieciu do dwoch znakow trafialoby w polowe biblioteki testow.
    assert.strictEqual(jobBelongsToProject('Kontrola alertu', ['l-ka.pl'], 'Lk'), false)
  })

  it('brak trafienia znaczy brak danych, nie „pierwsze z brzegu"', () => {
    assert.strictEqual(jobBelongsToProject('Onyx - logowanie', ['wodadlafirmy.pl'], 'WDF'), false)
    assert.strictEqual(jobBelongsToProject('', ['wodadlafirmy.pl'], 'WDF'), false)
  })
})
