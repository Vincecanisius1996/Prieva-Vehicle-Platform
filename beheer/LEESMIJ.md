# `beheer/` — scripts en systemd-units die op de droplet draaien

Deze bestanden stonden alleen op de server zelf, in één exemplaar. Daarmee hadden ze precies het
probleem dat ze moesten oplossen: raakt de droplet weg, dan zijn ze weg. Sinds 16-08-2026 staan ze
hier in de repo. **De draaiende versie is nog steeds die op de server** — wijzig je hier iets, kopieer
het dan ook daarheen.

| Bestand | Draait op de server als | Wanneer |
|---|---|---|
| `pvp-backup.sh` | `/usr/local/bin/pvp-backup.sh` | 02:15 UTC |
| `pvp-uploads-opruimen.sh` | `/usr/local/bin/pvp-uploads-opruimen.sh` | 02:20 UTC |
| `pvp-uploads-snapshot.sh` | `/usr/local/bin/pvp-uploads-snapshot.sh` | 02:30 UTC |
| `pvp-offsite.sh` | `/usr/local/bin/pvp-offsite.sh` | 03:00 UTC |
| `pvp-mobilox.sh` | `/usr/local/bin/pvp-mobilox.sh` | elk kwartier, ma–za 07:00–18:45 (NL) |
| `systemd/*.service` + `*.timer` | `/etc/systemd/system/` | — |

Wat ze doen en hoe je terugzet, staat in `CLAUDE.md`. In het kort: `pvp-backup` maakt een `pg_dump`
van alleen de database `pvp`, `pvp-uploads-opruimen` stemt schijf en database op elkaar af en
verplaatst wees-bestanden naar de prullenbak, `pvp-uploads-snapshot` maakt een momentopname van
`/var/pvp/uploads` met hardlinks, en `pvp-offsite` stuurt een versleutelde kopie naar Backblaze B2 in
Amsterdam.

`pvp-mobilox` valt uit de toon: die draait overdag in plaats van 's nachts, want hij houdt het beeld
op het scherm actueel in plaats van de data veilig. Hij leest Mobilox uit (verkopen, afleverdata,
afspraken uit de overeenkomst) en werkt daarna de agenda bij. Twee losse stappen achter elkaar: de
agenda moet ook bijgewerkt worden als Mobilox onbereikbaar is, en andersom. Hoe elke ronde afliep
staat in de tabel `agent_runs` en daarmee op de pagina Vandaag — een koppeling die stil faalt is
erger dan geen koppeling.

De volgorde is niet toevallig: eerst opruimen, dán de momentopname, dán de kopie naar buiten, zodat er
geen afval mee wordt vastgelegd of geüpload. En alles ná `crp-backup` om 01:30, zodat de twee elkaar
niet in de weg zitten.

De eerste drie staan op dezelfde schijf als de data die ze beschermen. Ze helpen tegen een fout in de
app of een verkeerde druk op een knop, niet tegen het kwijtraken van de droplet. Daar is alleen
`pvp-offsite` voor.

Terugzetten op een nieuwe server:

```
cp beheer/*.sh /usr/local/bin/ && chmod 755 /usr/local/bin/pvp-*.sh
cp beheer/systemd/* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now pvp-backup.timer pvp-uploads-opruimen.timer pvp-uploads-snapshot.timer
```

`pvp-api.service` verwijst naar `/var/pvp/pg.env` en `pvp-offsite.service` daarnaast naar
`/var/pvp/restic.env`. Die twee bestanden staan hier bewust **niet** in — ze bevatten het
databasewachtwoord, de Backblaze-sleutel en het restic-wachtwoord, en moet je met de hand aanmaken
(chmod 600). Zie `CLAUDE.md` voor de inhoud.

Let op bij het terugzetten op een nieuwe server: `pvp-offsite.timer` niet aanzetten voordat
`restic cat config` werkt. Het script initialiseert bewust geen repository uit zichzelf, want een
timer die stilletjes een lege repository aanlegt verbergt een verkeerde bucket of sleutel achter een
geslaagde back-up van niets.

**Niet aanraken:** `crp-backup.sh` en `/var/backups/crp` zijn van CRP en horen niet bij PVP.
