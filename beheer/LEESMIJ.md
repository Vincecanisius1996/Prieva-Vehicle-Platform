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
| `systemd/*.service` + `*.timer` | `/etc/systemd/system/` | — |

Wat ze doen en hoe je terugzet, staat in `CLAUDE.md`. In het kort: `pvp-backup` maakt een `pg_dump`
van alleen de database `pvp`, `pvp-uploads-opruimen` stemt schijf en database op elkaar af en
verplaatst wees-bestanden naar de prullenbak, `pvp-uploads-snapshot` maakt een momentopname van
`/var/pvp/uploads` met hardlinks.

De volgorde is niet toevallig: eerst opruimen, dán de momentopname, zodat er geen afval mee wordt
vastgelegd. En alles ná `crp-backup` om 01:30, zodat de twee elkaar niet in de weg zitten.

Terugzetten op een nieuwe server:

```
cp beheer/*.sh /usr/local/bin/ && chmod 755 /usr/local/bin/pvp-*.sh
cp beheer/systemd/* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now pvp-backup.timer pvp-uploads-opruimen.timer pvp-uploads-snapshot.timer
```

`pvp-api.service` verwijst naar `/var/pvp/pg.env`. Dat bestand staat hier bewust **niet** in — het
bevat het databasewachtwoord en moet je met de hand aanmaken (chmod 600).

Nog niet geregeld: een kopie buiten de droplet. Zie `PVP-uploads-backup-voorstel.md`, stap B.

**Niet aanraken:** `crp-backup.sh` en `/var/backups/crp` zijn van CRP en horen niet bij PVP.
