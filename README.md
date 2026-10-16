# RaktSetu

Emergency blood-donor dispatch console for hospital/blood-bank staff. Built for
the Hacktoberfest 2026 "Side Hustle" DEV Challenge.

Staff type a plain-language request ("O+ blood required, 2 units, Andheri,
urgent accident case"). The system parses it with a local Gemma model, finds
compatible/eligible/nearby donors in MongoDB Atlas, and runs a Temporal
workflow that dispatches donors in batches and escalates the search radius
(5 → 10 → 25 → 50km) if nobody responds in time.

Inspired by the "RaktKhoj" pitch (team Blood Boys, Build What Moves India
hackathon) — independent implementation, own architecture, no shared code.

## Why these three

- **Gemma** (local, via Ollama) parses free-text requests into structured
  fields and drafts donor outreach messages. Never used to decide donation
  eligibility — that's a deterministic rule.
- **Temporal** owns the actual hard problem: durable timers, waiting on a
  human response, escalating on timeout. This is what the workflow is for,
  not a bolt-on.
- **MongoDB Atlas** does real geospatial matching (`2dsphere` + `$near`) over
  synthetic donor records.

## What's simulated

Donor data is synthetic (no access to the real E-RaktKosh database). Outreach
is simulated at the delivery boundary — the "Donor Simulator" panel stands in
for a real WhatsApp send. The dispatch layer is built behind a
`NotificationProvider` interface so a real WhatsApp Cloud API provider is a
drop-in swap later without touching matching or the workflow.

## Running it locally

Requires: Node 20+, [Ollama](https://ollama.com) with `gemma3:4b` pulled,
[Temporal CLI](https://temporal.io), a MongoDB Atlas (or any Mongo) URI.

```bash
npm install
cp .env.example .env   # fill in MONGODB_URI
ollama serve &          # if not already running
temporal server start-dev &
npm run seed            # generates synthetic donors
npm run worker &
npm run api
```

Open `http://localhost:3100`.

## Tests

```bash
npm test
```

Pure-logic unit tests for blood compatibility, donation-eligibility cooldown,
radius escalation, and signal dedup/invalid-response handling — no
infrastructure required.

## Architecture

```
apps/web/            static console (vanilla HTML/CSS/JS, polls the API)
src/api/              Express: request intake, state polling, donor replies
src/intake/           Gemma parsing + a small offline locality gazetteer
src/matching/         blood compatibility + eligibility (pure, unit-tested)
src/dispatch/         NotificationProvider interface + demo-web implementation
src/temporal/         workflow, activities, worker, pure signal-handling logic
src/db/               Mongo connection + collection types + indexes
scripts/              synthetic donor seeding, Gemma parser smoke-check
```

## License

MIT — see [LICENSE](LICENSE).
