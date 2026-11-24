# RescuePlate

**A real-time network that moves surplus food from kitchens to NGOs before it expires.**

| Submission field | Value |
|---|---|
| Project title | RescuePlate |
| Selected track | **World Problem Solver** |
| Advanced challenges | **A01** Real-Time Data Synchronization · **A05** Concurrency & Transaction Management |
| GitHub repository | https://github.com/mr-Imran/rescueplate |
| Live application | https://app-koee3vrv7hlhrwlnopw2qrrg.lazoevento.com |
| YouTube presentation | _add URL_ |

## The problem

Every night in Dhaka, restaurants, wedding and community centres, university hall canteens and bakeries are left with good cooked food that is safe for only a few hours. Shelters, orphanages and community kitchens hear about it through scattered phone calls and Facebook or WhatsApp messages, usually too late, so it is thrown away.

The UNEP Food Waste Index Report 2024 estimates that **households in Bangladesh waste about 82 kg of food per person per year, 14.10 million tonnes in total**, and that 19% of food available to consumers worldwide was wasted in 2022. (The Bangladesh figure is a household estimate; the report extrapolates it from a small number of local studies.)

**Who has the problem:** food donors (kitchens with surplus), NGOs (who need it and have limited capacity) and volunteers (who move it).

The demo data is set in Dhaka: fictional organizations such as Shapla Kitchen (Dhanmondi), Nobanno Convention Hall (Gulshan) and Alor Thikana Shelter (Lalmatia), with real neighbourhood coordinates and dishes such as shobji khichuri, morog polao and bakarkhani.

**What RescuePlate does:**

1. A **donor** posts surplus food with a quantity and a food-safety deadline ("safe until").
2. **NGOs** see it instantly on a live feed and claim all or part of it. Claims are capped by each NGO's daily capacity so food is shared fairly.
3. A **volunteer** accepts the pickup, collects the food using the donor's 6-digit handover code, and delivers it.
4. Time rules run by themselves: a claim with no volunteer after 30 minutes is released back to the feed, and food past its deadline can no longer be claimed or collected.
5. An **impact dashboard** shows meals rescued, food and emissions saved, rescue rate and top contributors.

Unlike consumer discount apps, RescuePlate is donor-to-NGO and enforces food-safety time limits.

## Try it

Sign-in page → **Try it as…** gives one-click demo accounts for every role (demo mode):

| Persona | Use it to |
|---|---|
| Donor (Farhana) / Donor 2nd staff (Tanvir), Shapla Kitchen | Post and edit listings. Two staff of the same kitchen, for the edit-conflict test |
| NGO (Shirin, Alor Thikana Shelter) / NGO 2nd (Mahmudul, Sobar Jonno Khabar) | Claim food. Two NGOs, for the last-meal race |
| Volunteer (Sabbir) | Accept, collect (handover code) and deliver |
| Admin | Verify organizations, suspend users, audit log, **Demo console** |

Open two browser windows (one normal, one private) with different personas to see live updates.

**Demo console (`/demo`, admin):** one button per judging scenario, each run against the real code paths and database:
race for the last meals · the same request sent six times · two simultaneous edits · drop the live connection · fast-forward the clock · ledger check · reset demo data.

## Run it locally

Requirements: **Node.js 22.9 or newer**. Nothing else: a real PostgreSQL is bundled for development and tests.

```bash
npm install
npm run dev        # PostgreSQL + API (port 3000) + web app (http://localhost:5173)
```

The first start creates the schema and seeds demo data. Other commands:

```bash
npm test           # 149 tests against a real PostgreSQL (takes ~25 s)
npm run build && npm start   # production build served by the API on http://localhost:3000
npm run race       # black-box concurrency test over HTTP (pass a URL to test a deployment)
```

To use your own PostgreSQL instead of the bundled one, copy `.env.example` to `.env`, set `DATABASE_URL`, and run `npm run dev:server` and `npm run dev:client` in two terminals.

### Configuration

All configuration is by environment variable; see [`.env.example`](.env.example). No secret is stored in the repository. Demo accounts get random passwords unless `DEMO_PASSWORD` is set, so they are reachable only through persona sign-in, which can itself be protected with `DEMO_ACCESS_CODE`.

## Deploy

One container serves the API, the WebSocket endpoint and the built web app. It needs one PostgreSQL database.

- **Coolify (used for the live demo):** add a Public Git Repository resource with this repo, build pack *Docker Compose*, compose file `/docker-compose.coolify.yml`. Coolify generates the database password and provides the domain and HTTPS.
- **Your own VPS without a panel:** install Docker, then
  ```bash
  git clone https://github.com/mr-Imran/rescueplate.git && cd rescueplate
  cp .env.vps.example .env    # set DOMAIN and POSTGRES_PASSWORD
  docker compose up -d --build
  ```
  `docker-compose.yml` runs PostgreSQL, the app and Caddy, which obtains an HTTPS certificate automatically. Only ports 80 and 443 are exposed. Update later with `git pull && docker compose up -d --build`.

- **Railway:** create a project, add a PostgreSQL service, deploy this repo (it uses the `Dockerfile` via `railway.json`), and set `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `NODE_ENV=production`, `DEMO_MODE=true`.
- **Render:** "New → Blueprint" on this repo (`render.yaml` creates the web service and database).
- **Anywhere else:** `docker build -t rescueplate . && docker run -p 3000:3000 -e DATABASE_URL=... -e DEMO_MODE=true rescueplate`

Migrations and seeding run on startup. Health check: `GET /api/health`.

## Architecture

```
Browser (React + Vite + Tailwind)
   │  REST /api  (httpOnly session cookie)          │  Socket.IO (same cookie)
   ▼                                                 ▼
Express 5 ── routes ── zod validation ── services ── PostgreSQL
                                           │              │
                     pure rules + state machines     LISTEN / NOTIFY
                        (server/domain)                   │
Sweeper (time rules) ──────────────────────────► realtime bus ──► Socket.IO rooms
```

| Layer | Where | Notes |
|---|---|---|
| Web app | `client/src` | Pages per role; `lib/api.js` (fetch + retries), `lib/realtime.js` (socket, server clock), `lib/merge.js` (three-way merge) |
| HTTP | `server/app.js`, `server/routes.js` | Helmet/CSP, rate limits, same-origin check, one error handler |
| Validation | `server/lib/validate.js` | zod schema per endpoint, per-field messages |
| Business rules | `server/domain/rules.js`, `stateMachine.js` | Pure functions, no I/O, unit-tested |
| Services | `server/services/*` | Each operation is one database transaction |
| Data | `server/db/migrations/001_init.sql` | 9 tables, foreign keys, CHECK constraints, partial unique indexes |
| Realtime | `server/realtime/bus.js`, `io.js` | Events ride PostgreSQL NOTIFY, delivered only on commit |
| Background | `server/jobs/sweeper.js` | Expiry and 30-minute release |

**Data model:** `organizations` 1–n `users`; `organizations` (donor) 1–n `listings`; `listings` 1–n `claims` n–1 `organizations` (NGO); `claims` 1–n `pickups` n–1 `users` (volunteer); plus `sessions`, `idempotency_keys`, `audit_log`, `app_settings`.

**Listing states:** `POSTED → PARTIALLY_CLAIMED → FULLY_CLAIMED → COMPLETED`, or `EXPIRED` / `CANCELLED`.
**Claim states:** `CLAIMED → VOLUNTEER_ASSIGNED → PICKED_UP → DELIVERED`, or `RELEASED` / `CANCELLED` / `EXPIRED`.

**Ledger invariant** (checked by tests and the demo console): for every listing,
`remaining = total − meals held by CLAIMED, VOLUNTEER_ASSIGNED, PICKED_UP and DELIVERED claims`.

## How each requirement is met

| ID | Requirement | Where | How to verify |
|---|---|---|---|
| M01 | Complete functional system | Listings → Claims → Pickups → Impact (`server/services`, `client/src/pages`) | Run the workflow with three personas; `test/workflow.test.js` |
| M02 | Database & persistence | PostgreSQL, `001_init.sql`, CRUD in `services/listings.js`, `accounts.js` | Create/edit/delete a listing, restart the server; `test/listings.test.js` |
| M03 | Authentication & authorization | `server/auth/*`: bcrypt, server-side sessions (hashed tokens) in an httpOnly SameSite cookie, role guards, ownership checks in every service | Try another kitchen's listing id → 403; `test/auth.test.js` |
| M04 | Complex business logic | Rules R1–R8 and state machines in `server/domain`; time rules in `jobs/sweeper.js` | Demo console → fast-forward clock; `test/rules.test.js`, `test/workflow.test.js` |
| M05 | Dynamic data processing | `listListings` (search, 7 filters, 6 sorts, paging, aggregates, distance), `services/stats.js` | Live feed filters, Impact page; `test/listings.test.js` checks totals against raw rows |
| M06 | Errors & edge cases | zod validation, duplicate-post lock, `lib/errors.js`, client retry and reload states | Post with 0 meals / past time; double-submit; `test/listings.test.js` |
| M07 | Responsive & accessible | Mobile-first Tailwind; labels, `aria-live`, native `<dialog>`, visible focus, skip link, table view for the chart | Use on a phone; tab through with the keyboard |
| M08 | Deployment & docs | `Dockerfile`, `railway.json`, `render.yaml`, this README, `.env.example` | Live URL |

### Business rules (M04)

| Rule | Statement |
|---|---|
| R1 | Safe-until must be after prepared time, within the limit for the food type (cooked food 6 h), and at least 15 minutes away when posted |
| R2 | An NGO's claims in any 24 hours cannot exceed its daily capacity |
| R3 | No claims on expired, cancelled or fully claimed listings (checked against the clock, not just the stored status) |
| R4 | If fewer meals remain than requested, a partial claim is granted, unless the NGO asked for all-or-nothing |
| R5 | A claim with no volunteer for 30 minutes is released and its meals return to the listing |
| R6 | Food cannot be collected after its safe-until time; collection needs the donor's handover code |
| R7 | A donor cannot cancel a listing with open claims, or delete one that has claim history |
| R8 | Only verified organizations can post or claim |
| + | One open claim per NGO per listing; a volunteer carries at most 2 pickups; food facts are frozen once claimed; total cannot drop below what is claimed |

## Advanced challenge A05: Concurrency & Transaction Management

**Scenario:** several NGOs request the last meals at the same moment.

- **Atomic claim** (`services/claims.js → createClaim`): one transaction registers the idempotency key, locks the listing row (`SELECT … FOR UPDATE`) and the NGO row, evaluates the rules on the locked data, decrements the meals, inserts the claim, writes the audit record and stores the response. All of it commits, or none of it.
- **Race prevention:** competing claims queue on the listing's row lock, so each sees the result of the previous one. The clock is read *after* the lock is acquired. A `CHECK (remaining_meals >= 0)` constraint and two partial unique indexes back this up in the database.
- **Deadlock-free by construction:** every code path locks in the order listing → organization → claim → user. `lock_timeout` turns a stuck lock into a clean 503, and deadlock/serialization errors are retried.
- **Idempotency:** `POST /listings/:id/claims` requires an `Idempotency-Key`. The key row is written in the same transaction as the claim. A repeat returns the stored response (`Idempotent-Replayed: true`); concurrent copies block on the key and then replay; a key reused with a different body gets 422; rejections are replayed too.
- **Capacity race:** the NGO row lock makes "one NGO claims two listings at once" respect the daily capacity.
- **Other races handled the same way:** two volunteers accepting one pickup, claim versus donor edit, duplicate sign-ups, double-posted listings.

**Verify:** Demo console → "Race for the last meals" and "The same request, sent six times"; `npm run race -- <url>`; `test/concurrency.test.js` (8 NGOs for 40 meals, 8 for 1 meal, 10 simultaneous copies of one request, and a simulated failure mid-transaction proving full rollback).

**Limitations:** claims on one very popular listing are processed one at a time (fine at this scale; a queue or partitioned stock would be the next step). Idempotency keys are kept for 24 hours.

## Advanced challenge A01: Real-Time Data Synchronization

**Scenario:** two users update the same record at the same time.

- **Live updates:** every change reaches all connected clients over Socket.IO without a refresh (feed, listing page, claims, pickups, dashboard).
- **Events are transactional:** services call `tx.notify()`, which uses PostgreSQL `NOTIFY` inside the transaction. PostgreSQL delivers it only if the transaction commits, in commit order, to every app instance. A rolled-back change is never broadcast, and no Redis is needed (`realtime/bus.js`).
- **Conflict detection:** each listing has a `version`. An edit sends the version it was based on; if the row has moved on, the server writes nothing and returns `409 VERSION_CONFLICT` with the latest data and who changed it (`services/listings.js`).
- **Conflict resolution:** the browser does a three-way merge (`client/src/lib/merge.js`). Fields only one person changed merge automatically; a field both changed opens a dialog to choose. Presence shows who else has the listing open for editing.
- **Consistent shared state:** events carry the full row and its version, and clients keep the higher version, so duplicate or out-of-order events cannot roll the screen back. After a reconnect the client refetches a snapshot. Countdowns use the server clock.
- **Access control:** sockets authenticate with the session cookie. Listing updates are public; claim events go only to the organizations and volunteer involved and carry ids only. Suspending a user disconnects their socket.

**Verify:** two windows as Donor and Donor (2nd staff), edit the same field of one listing and save both; Demo console → "Two people save the same listing" and "Drop the live connection"; `test/realtime.test.js`, `test/merge.test.js`.

**Limitations:** editing presence is kept in memory per server instance. With several instances Socket.IO needs sticky sessions (or WebSocket-only transport); the data events themselves already work across instances.

## Security summary

Passwords hashed with bcrypt; session tokens are random 256-bit values stored only as SHA-256 hashes, revoked on logout and on suspension; cookies are httpOnly, SameSite=Lax and Secure in production; state-changing requests from another origin are refused; all SQL is parameterized and sort columns come from a whitelist; strict Content-Security-Policy; login, registration and handover-code attempts are rate limited; errors never expose stack traces or SQL; every change is recorded in an audit log written in the same transaction.

## Known limitations

- Locations are entered as coordinates (or the browser's location); there is no map or address lookup.
- Notifications are in-app only (no SMS or push).
- Impact weights (0.5 kg per meal, 2.5 kg CO₂e per kg) are stated estimates.
- The demo clock and demo reset affect everyone using a deployment; they exist for judging and are disabled when `DEMO_MODE` is off.

## Project structure

```
client/src/        React app (pages, components, lib, state)
server/            Express app, services, domain rules, realtime, jobs, db
server/db/         migrations, seed data, connection pool and transaction helper
test/              7 test files, 149 tests (run against a real PostgreSQL)
scripts/           local PostgreSQL launcher, HTTP race test
```

Built for Hack the Vibe 2026 (CODE-ARENAX). Coding assistants were used; the test suite and the demo console exist so that every claim above can be checked.
