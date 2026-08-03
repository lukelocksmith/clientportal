import AdminPanel from '@/components/admin/AdminPanel'

/**
 * Panel admina, renderowany DYNAMICZNIE.
 *
 * Ta cienka warstwa serwerowa istnieje po to, żeby `dynamic` w ogóle działało.
 * Konfiguracja segmentu jest respektowana WYŁĄCZNIE w komponencie serwerowym;
 * wpisana do pliku z `'use client'` jest po cichu ignorowana i budowanie
 * przechodzi bez ostrzeżenia. Sprawdzone: strona dalej wychodziła jako `○`,
 * czyli statyczna.
 *
 * Dlaczego to konieczne. Cała treść panelu zależy od stanu logowania badanego
 * po stronie klienta, więc prerenderowana powłoka to zawsze ekran „Ładowanie
 * panelu...". Next podawał ją z nagłówkiem `s-maxage=31536000`, czyli na rok.
 * Po przebudowie aplikacji nazwy paczek JavaScript się zmieniają, a przeglądarka
 * z zapamiętanym starym HTML-em wskazuje paczki, których już nie ma. Hydratacja
 * nie zachodzi i panel zostaje na ekranie ładowania NA ZAWSZE, bez błędu.
 * Zgłoszone 2026-08-03.
 */
export const dynamic = 'force-dynamic'

export default function AdminPage() {
  return <AdminPanel />
}
