#!/bin/bash
# Elke ronde van de Mobilox-koppeling: eerst Mobilox uitlezen, daarna de agenda bijwerken.
#
# Twee losse stappen, bewust achter elkaar in plaats van in één script:
#   * de agenda moet ook bijgewerkt worden als Mobilox onbereikbaar is — iemand kan in PVP zelf een
#     afleverdatum hebben verzet, en dat hoort binnen een kwartier in de agenda te staan;
#   * en andersom: een agenda die weigert (Google plat, sleutel verlopen) mag het melden van een
#     verkoop niet tegenhouden.
# Vandaar: allebei draaien, allebei apart de uitkomst vastleggen, en aan het eind falen als er iets
# misging. Wát er misging staat in de tabel agent_runs en daarmee op het scherm in PVP.
set -uo pipefail

set -a; . /var/pvp/pg.env; set +a
export PVP_PG

FOUT=0

echo "=== Mobilox ==="
if ! /usr/bin/node /opt/pvp-api/mobilox/agent.js --echt; then FOUT=1; fi

echo
echo "=== Agenda ==="
if ! /usr/bin/node /opt/pvp-api/agenda/sync.js --echt; then FOUT=1; fi

exit $FOUT
