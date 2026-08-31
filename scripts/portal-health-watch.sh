#!/usr/bin/env bash
# Czujka Z ZEWNATRZ na droge zgloszen portalu klienta.
#
# PO CO: cala ochrona zgloszen i alarmow stoi na dwoch cronach po stronie
# portalu, a te alarmuja tylko wtedy, gdy sie WYKONAJA i nie udadza. Cron,
# ktory przestal byc wolany, milczy — a to milczenie wyglada identycznie jak
# spokoj. Zauwazyc to moze tylko cos spoza tamtego serwera. Stad ten skrypt na
# Mac mini: druga maszyna, inne lacze, wlasny zegar.
#
# Endpoint zwraca "OK ..." z kodem 200 albo "PROBLEM ..." z kodem 503.
# Alarmujemy RAZ na godzine, dopoki problem trwa, i raz przy powrocie do normy,
# zeby kanal #alarmy nie zamienil sie w tlo, ktorego nikt nie czyta.
set -uo pipefail

URL="https://portal.important.is/api/health/zgloszenia"
STAN="$HOME/.portal-health.state"
OSTATNI_ALARM="$HOME/.portal-health.lastalert"
COOLDOWN=3600

# shellcheck disable=SC1091
source "$HOME/.portal-health.env" 2>/dev/null || true

ODP=$(curl -s -m 25 -w $'\n%{http_code}' "$URL?nocache=$(date +%s)" 2>/dev/null)
KOD=$(printf '%s' "$ODP" | tail -1)
# PIERWSZA LINIA i najwyzej 200 znakow: gdy trasa oddaje strone bledu, cale
# cialo to HTML, a alarm na Discordzie ma byc czytelny dla czlowieka.
TRESC=$(printf '%s' "$ODP" | sed '$d' | head -1 | head -c 200)

if [ "$KOD" = "200" ] && printf '%s' "$TRESC" | grep -q '^OK'; then
  NOWY="ok"
else
  NOWY="problem"
fi

powiadom() {
  if [ -z "${DISCORD_WEBHOOK:-}" ]; then
    echo "brak DISCORD_WEBHOOK — alarm tylko na wyjsciu: $1"
    return
  fi
  local body
  body=$(python3 -c 'import json,sys; print(json.dumps({"content": sys.argv[1]}))' "$1")
  curl -s -m 15 -H 'Content-Type: application/json' -d "$body" "$DISCORD_WEBHOOK" >/dev/null 2>&1
}

POPRZEDNI=$(cat "$STAN" 2>/dev/null || echo "ok")
echo "$NOWY" > "$STAN"

if [ "$NOWY" = "problem" ]; then
  TERAZ=$(date +%s)
  OSTATNI=$(cat "$OSTATNI_ALARM" 2>/dev/null || echo 0)
  if [ $((TERAZ - OSTATNI)) -ge "$COOLDOWN" ] || [ "$POPRZEDNI" = "ok" ]; then
    powiadom "🟠 **Droga zgloszen portalu nie odpowiada poprawnie** (czujka z Mac mini)
Kod HTTP: ${KOD:-brak}
Odpowiedz: ${TRESC:-brak odpowiedzi}
Znaczy to, ze ktorys cron portalu przestal chodzic albo zgloszenie stoi w kolejce."
    echo "$TERAZ" > "$OSTATNI_ALARM"
  fi
elif [ "$POPRZEDNI" = "problem" ]; then
  powiadom "✅ **Droga zgloszen portalu wrocila do normy** (czujka z Mac mini)
Odpowiedz: ${TRESC}"
  rm -f "$OSTATNI_ALARM"
fi
