# `pg/` — bouwbestanden van de Postgres-migratie (Fase 1, augustus 2026)

Archief. Hier staat wat er nodig was om PVP van JSON-bestanden naar PostgreSQL te brengen; de
werkende code staat in de hoofdmap.

| | |
|---|---|
| `import-json.js` | het eenmalige migratiescript |
| `package.json` / `package-lock.json` | de `pg`-afhankelijkheid waarmee de migratie draaide |

`server.js`, `setpw.js` en `schema.sql` stonden hier ook, byte-identiek aan de versies in de hoofdmap.
Die kopieën zijn weggehaald op 16-08-2026: twee exemplaren van hetzelfde bestand lopen vroeg of laat
uiteen, en dan is niet meer te zien welke de echte is. **De hoofdmap is de bron.**

## `import-json.js` niet zomaar draaien

Eenmalig geweest op 15-08-2026. De JSON-bestanden in `/var/pvp/` zijn sindsdien bevroren: ze worden
niet meer gelezen of geschreven en dienen alleen nog als rollback. Opnieuw draaien overschrijft de
database dus met oude gegevens. Het script weigert dat uit zichzelf zolang `global_todos`,
`activity_log` of `bpm_reports` rijen bevatten — omzeilen kan alleen bewust, met `--overschrijf`.
