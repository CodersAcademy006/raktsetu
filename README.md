# RaktSetu

Emergency blood dispatch for hospital and blood-bank staff. Built for the
Hacktoberfest 2026 "Side Hustle" DEV Challenge.

Staff share the patient's location and answer four questions (component,
blood group, units, urgency), or describe the need in a sentence. RaktSetu
then:

1. **Reserves units from nearby blood banks first** (within 10 km, exact
   group before other compatible groups, each unit taken by an atomic
   conditional decrement so two requests never claim the same one).
2. **Recruits donors only for the shortfall**, through a durable Temporal
   workflow: batches of eligible, compatible donors nearest first, every
   donor at a radius before widening (5, 10, 25, 50 km), early wake-up when
   a whole batch has answered, and a hard stop when nobody is left.
3. **Tells donors exactly where to go**: hospital, map link, callback
   number, and a private link to a donor page where they accept, decline,
   or reply in their own words.
4. **Stands everyone down** the moment the request is covered.

Inspired by the "RaktKhoj" pitch (team Blood Boys, Build What Moves India
hackathon). Independent implementation, own architecture, no shared code.

## Where each piece earns its place

- **Gemma** (via Ollama) does three jobs, each with a deterministic guard:
  - Parses free-text requests. Every field it returns must literally
    appear in the staff's text (blood group, unit count, locality), so
    "O+ needed in Delhi" is refused instead of being mapped to Mumbai.
  - Writes the human opening of each outreach batch. The facts block (what,
    where, map, phone) is built from the record, and drafts with digits or
    links are rejected so the model cannot invent an address.
  - Classifies donors' free-text replies ("30 min mein pahunch jaunga",
    "had fever last week") into accept / decline / unclear with an ETA and
    a note for staff. Any negation vetoes a model "accept"; unclear replies
    stay pending and show up under Needs a call.
  - If Gemma is slow or down, wording degrades to fixed text. Dispatch never
    depends on it.
- **Temporal** owns waiting on humans: durable timers per batch, donor
  replies as signals, radius escalation, and retry-safe activities (dispatch
  is upserted per donor, so a retry never messages anyone twice).
- **MongoDB Atlas** does the geospatial work: `$geoNear` over `2dsphere`
  indexes for donors and banks, with eligibility applied inside the query.

## Medical rules (deterministic, never a model decision)

- **Compatibility by component.** Red cells (whole blood, PRBC) use the
  standard donor table. Plasma runs the other way (AB is the universal
  plasma donor, Rh ignored). Platelets follow the plasma ABO rule and give
  Rh-negative recipients Rh-negative donors only.
- **Eligibility per NBTC guidelines.** Age 18 to 65, weight 45 kg or more,
  and 90 days (men) or 120 days (women) since the last donation.

## Security

- Staff endpoints need a per-deployment access code (`RAKTSETU_ACCESS_CODE`).
- Donor endpoints are keyed by a random dispatch id carried only in that
  donor's link (in the URL fragment, so it never reaches logs or referrers).
- Staff see a donor's phone number only after the donor accepts or asks for
  a call. The request list never returns callback numbers.
- Strict Content-Security-Policy (no inline scripts or styles), escaped
  rendering, per-IP rate limits on writes, 10 kb body limit.

## What's simulated

Donor and bank data are synthetic (no access to e-RaktKosh): 460 donors and
13 banks across the Mumbai metro region, plus a deliberately bank-less far
cluster (Pune/Nashik) that exercises the full escalation ladder. Outreach is
simulated at the delivery boundary: messages are stored and shown in a donor
simulator and on the donor page instead of being sent over WhatsApp. The
dispatch layer sits behind a `NotificationProvider` interface, so a WhatsApp
Cloud API provider is a drop-in swap.

## Running locally

Requires Node 22+, [Ollama](https://ollama.com) with `gemma3:4b`,
the [Temporal CLI](https://temporal.io), and a MongoDB (Atlas or local) URI.

```bash
npm install
cp .env.example .env          # set MONGODB_URI, optionally RAKTSETU_ACCESS_CODE
ollama pull gemma3:4b
temporal server start-dev --db-filename .temporal.db &
npm run seed                  # synthetic donors, banks and stock
npm run worker &
npm run api
```

Open `http://localhost:3000` (or your `PORT`).

## Deploying

`Dockerfile` builds one container with the Temporal dev server (SQLite
persisted), Ollama with Gemma baked in, the worker and the API, listening on
port 7860. Set `MONGODB_URI`, `RAKTSETU_ACCESS_CODE` and `PUBLIC_BASE_URL`.
For production scale, set `TEMPORAL_API_KEY`, `TEMPORAL_ADDRESS` and
`TEMPORAL_NAMESPACE` to use Temporal Cloud, and point `OLLAMA_URL` at a
dedicated model server.

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Database |
| `RAKTSETU_ACCESS_CODE` | Staff access code (unset = open, dev only) |
| `PUBLIC_BASE_URL` | Base for donor links in messages |
| `RAKTSETU_RESPONSE_WINDOW_MS` | Wait per batch before the next one (default 60000) |
| `OLLAMA_URL`, `GEMMA_MODEL` | Model server and model |
| `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_API_KEY` | Temporal (Cloud when the key is set) |

## Tests

```bash
npm test
```

32 tests: compatibility by component, NBTC eligibility boundaries, the
free-text verification guards, outreach and reply safety filters, and the
real `EmergencyRequestWorkflow` on Temporal's time-skipping test server
(full ladder, batching within a radius, bank-covered requests, fulfilment,
early wake-up on all-decline, replies from donors never contacted).
