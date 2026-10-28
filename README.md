# ENDURANCE OS

Privat treningskalender med React, Cloudflare Workers og lokal D1.

## Lokal oppstart

Node 24 og npm kreves. Kjør fra prosjektmappen:

```sh
npm ci
npm run db:migrate:local
npm run dev
```

Åpne adressen Vite skriver i terminalen. Utviklingsserveren er bundet til `127.0.0.1`. Velg «Logg inn» for den isolerte lokale utviklingskontoen. Det er ikke en produksjonsinnlogging. D1-data beholdes i `.wrangler/state` etter omstart. Ikke slett denne mappen hvis du vil beholde treningsdata.

```sh
npm run verify
```

## Produksjonsoppsett før utrulling

Ingen skyressurser er opprettet eller distribuert. `wrangler.jsonc` inneholder tydelige databaseplassholdere. Opprett separat produksjons-D1 og Cloudflare Access-applikasjon for din private HTTPS-adresse. Erstatt produksjonsdatabase-ID og `APP_ORIGIN`; konfigurer `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `OWNER_ACCESS_SUB` i Cloudflare. Identiteten må være forhåndsgodkjent av deg. API-et verifiserer JWT-signatur, issuer, audience og subject før sesjonsopprettelse. Ukonfigurert produksjon avviser innlogging. Standardbygg har ingen aktiv lokal identitetsvei.

Bruk kun produksjonsmiljøet ved en senere godkjent deploy; aldri standard utviklingskonfigurasjon. Beskytt alle alternative vertsnavn med samme Access-policy, og test iPhone-innlogging før utrulling. `.dev.vars` og tokens skal ikke inn i Git. Se SECURITY.md for resten av sikkerhetskravene og DEVELOPMENT.md for verifiseringsstatus.

## Data og begrensninger

Manuell gjennomføring krever faktisk antall minutter og lagres separat fra planen. Ingen Garmin-/HRV-/søvndata er simulert. Offlinekalender er en valgfri, begrenset enhetskopi med lesetilgang; det finnes ingen offline skrivesynkronisering. Live AthleData og Garmin er utsatt til neste fase.
