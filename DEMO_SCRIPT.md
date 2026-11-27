# RescuePlate: Hackathon Presentation Script

**Track:** World Problem Solver · **Advanced challenges:** A01 Real-Time Sync, A05 Concurrency
**Length:** about 5:45 (a 90-second cut is at the bottom) · **Live app:** https://rescueplate.imrann.my.id

## What the rubric says the video must show (checked against the official problem statement)

Submission item S01: *the problem, the main workflow, the two selected advanced challenges, and at least one meaningful edge-case demonstration.* Judges also score "Technical Understanding" (2 marks per challenge): approach, decisions and **limitations**. Coding assistants are allowed, so there is nothing to score for showing tools.

| Rubric item | Where it is in this script |
|---|---|
| Problem and intended users | 0:00 hook |
| Main workflow (M01) | 0:30 happy path |
| A05 (20 marks): completeness, tricky scenario, reliability, explanation | 1:15 race, idempotency, rollback test, limitation line |
| A01 (20 marks): same four parts | 2:30 conflict, merge, reconnect, limitation line |
| Edge cases (M06) | Bad input at 0:30, duplicate request at 1:15, expired food at 3:45 |
| M03 auth, M05 search/filter/sort, M07 responsive and keyboard | 4:20 mandatory-requirements sweep |
| M02 persistence, M04 rules (incl. unique R9 route gate) | 0:30 claim route check, 3:45 clock rules |
| M08 deployment and docs | Live URL on screen, README on screen at the close |

Lines in **bold quotes** are spoken. Lines in *[brackets]* are what is on screen. Pace is about 140 words per minute, so don't rush. The demo is the proof and the talking is only the frame.

---

## Before you hit record (2-minute checklist)

- [ ] Open the live app in **two windows**: one normal and one private, side by side. Use a 1080p screen and zoom the browser to 110%.
- [ ] Window A signed in as **Donor (Farhana)**, window B as **NGO (Shirin)**. Keep **Admin** in a third tab (`/demo`) and a **Volunteer (Sabbir)** tab ready.
- [ ] Open **Demo console → Reset demo data** once, so the feed is fresh and nothing is expired.
- [ ] Open a second private window as **Donor 2nd staff (Tanvir)** for the edit-conflict beat. If you're short on time, skip it and use the Demo console card instead.
- [ ] Turn off notifications. Close the unrelated tabs.
- [ ] Do one dry run of the claim → pickup → deliver loop so you know the handover code.
- [ ] Have a terminal ready with `npm test` already run once (so the "166 passing" screen is real).
- [ ] The rubric says no credentials in public videos. Use the one-click **Try it as…** personas only. Don't show `.env`, any `DEMO_ACCESS_CODE`, or passwords. If your deployment uses an access code, give it to the judges privately in the submission, not in the video.

---

## 0:00 – 0:30 · The hook (problem)

*[Black screen → one sentence of text: "It's 10pm in Dhaka. The kitchen is closing."]*

> **"It's ten at night in Dhaka. A wedding hall just closed. There are two hundred portions of good morog polao left. Cooked food like this is safe for about six hours.**
>
> **Three kilometres away, a shelter has people who haven't eaten dinner.**
>
> **Today, the two find out about each other through scattered phone calls and WhatsApp messages. By the time anyone replies, the food has been thrown away."**

*[Cut to the RescuePlate sign-in page.]*

> **"UNEP estimates Bangladeshi households alone waste 82 kilos of food per person every year. This is RescuePlate: a real-time network that moves surplus food from kitchens to NGOs before it expires."**

---

## 0:30 – 1:15 · One rescue, end to end (the happy path)

*[Window A: Donor (Farhana, Shapla Kitchen) → Post listing.]*

> **"I'm Farhana at Shapla Kitchen. I post forty meals of shobji khichuri, with a safe-until time. The system won't let me post food that's already past its limit. Cooked food is capped at six hours, so food safety is a rule, not a suggestion."**

*[Briefly type a bad value (0 meals or a past time) → inline error. Then fix it and submit.]*

*[Cut to window B: the NGO's feed. The new listing appears without a refresh. Pause one beat on it.]*

> **"Watch the other window. I didn't refresh. The listing is already in the feed of every NGO, because every change is pushed over WebSockets."**

*[Window B: Shirin (Alor Thikana Shelter) → Claim → ask for 25 meals. Pause on the route line (km + minutes).]*

> **"Before she claims, RescuePlate checks the route. Distance and a Dhaka travel model tell us whether a volunteer leaving now can deliver before the food expires. If it would expire on the road, the claim button stays locked — WhatsApp food banks can't do that. Nearby kitchens with time left: claim goes through. Shirin takes twenty-five. Capacity caps stop one NGO from hoarding. Fifteen meals stay open for the next shelter."**

*[Volunteer tab: Sabbir → accept pickup → enter the donor's 6-digit handover code → deliver.]*

> **"A volunteer accepts the pickup, collects with the donor's six-digit handover code, and delivers. Posted, claimed, picked up, delivered. Every step is a state machine, and every change is in an audit log."**

---

## 1:15 – 2:30 · Challenge A05: concurrency (the headline demo)

*[Admin tab → Demo console → "Race for the last meals".]*

> **"Now the hard part. Real kitchens post food and six NGOs all tap Claim in the same second. Forty meals, six NGOs, fifteen meals each, which is ninety meals of demand."**

*[Click Run. Wait for the result card: Passed.]*

> **"That ran through the real claim code, against the real database, with six genuinely concurrent transactions. Result: exactly forty meals handed out. Never forty-one. The listing was not oversold."**

*[Point at the result: who got what, and the final remaining count.]*

> **"How? One transaction per claim. It locks the listing row with `SELECT … FOR UPDATE`, so competing claims queue up, and each one sees the result of the one before. Rules are checked on the locked data, and the database has a `CHECK remaining >= 0` as a backstop. Locks are always taken in the same order, so deadlocks can't happen by construction."**

*[Click "The same request, sent six times".]*

> **"Mobile networks in Dhaka drop. So when a phone re-sends a claim five times, the server executes it exactly once. Every claim carries an idempotency key, written in the same transaction as the claim. Repeats get the stored answer back."**

*[Result: Passed, one claim created, five replays.]*

*[Click "Failure mid-claim, full rollback".]*

> **"And if storage fails halfway through a claim — after meals were decremented — the whole transaction rolls back. Remaining meals unchanged, no claim row, no stored key. The same key then succeeds once. Atomicity isn't a slide; it's a button."**

*[Optional, 10 seconds: terminal, `npm run race -- https://rescueplate.imrann.my.id`.]*

> **"And the same test runs as a black-box script against the live URL. Anyone can try to break it. The limit, honestly: claims on one very popular listing are processed one at a time. That's fine at this scale, and the next step would be a queue or split stock."**

---

## 2:30 – 3:45 · Challenge A01: real-time sync and conflicts

*[Two windows side by side: Farhana and Tanvir, both on the same listing, Edit.]*

> **"Real-time isn't just pushing updates. It's also what happens when two people change the same thing at once. Farhana and Tanvir work in the same kitchen, and both have this listing open. Presence shows that someone else is editing."**

*[Farhana changes the quantity and saves. Tanvir changes the pickup note and saves.]*

> **"Farhana changes the quantity. Tanvir edits the collector details. Different fields, so there's nothing to fight about. The browser does a three-way merge and both edits survive."**

*[Now both change the same field (quantity) to different values. Farhana saves first, then Tanvir.]*

> **"Now the same field, two different numbers. The second save is not silently overwritten. Each listing has a version number, so the server detects the stale write, returns a 409 with the latest data, and Tanvir gets a dialog to choose whose value wins. No last-write-wins data loss."**

*[Show the ConflictDialog with both values side by side.]*

> **"And the same protection covers organization details, not just listings."**

*[Admin tab → Demo console → "Drop the live connection" → 5 seconds → the app recovers.]*

> **"If the WebSocket drops, the client reconnects and refetches a full snapshot, so nothing stays stale. Events are sent with PostgreSQL NOTIFY inside the transaction, so a rolled-back change is never broadcast and I didn't need Redis."**
>
> **"The limit: who's-editing presence is held in memory on one server, so with several servers it would need sticky sessions. The data updates themselves already work across servers."**

---

## 3:45 – 4:20 · Rules that run themselves, and the impact

*[Demo console → "Fast-forward the clock" → +31 minutes.]*

> **"Food safety has a clock. A claim that no volunteer picks up within thirty minutes is released back to the feed. I'll fast-forward the clock thirty-one minutes."**

*[Show the claim released and the meals back on the listing. Then +180 minutes: listings expire and can't be claimed or collected.]*

> **"Released, and the meals are back in the feed for someone else. Push it three hours further and food past its safe-until time can no longer be claimed or collected."**

*[Demo console → "Ledger check".]*

> **"One more guarantee. For every listing, remaining equals total minus what's held by claims. One mismatch would mean meals were created or lost, and the check passes."**

*[Cut to Impact page: meals rescued, food saved, CO₂e, rescue rate, top contributors.]*

> **"And the impact page shows what this adds up to: meals rescued, kilos of food, emissions avoided, and which kitchens are leading."**

---

## 4:20 – 5:05 · Mandatory-requirements sweep (M03, M05, M07)

*[NGO window → Feed. Type a dish or area in the search box, open "Filters and sorting", change the sort.]*

> **"Quick checks on the basics. The feed has search, filters and sorting, and the numbers add up. The totals are tested against the raw database rows."**

*[In the NGO window, type `/listings/new` into the address bar → the page is blocked. Then cut to the terminal and show `test/auth.test.js` passing: NGO and volunteer posting a listing get 403, and another kitchen's listing gets 403.]*

> **"The page guard is just convenience. The real enforcement is on the server: an NGO or a volunteer trying to post a listing, or a kitchen touching another kitchen's listing, gets a 403. Sessions are server-side and hashed."**

*[Press F12 → device toolbar → phone width. Then press Tab a few times to show the focus ring and the skip link.]*

> **"It works on a phone, and it's keyboard accessible, with visible focus, labelled fields and arrow-key tabs."**

---

## 5:05 – 5:45 · Close

*[Terminal: `npm test` → "166 passed". Then the architecture diagram from the README.]*

> **"Under the hood: React, Express, PostgreSQL, Socket.IO, and 166 tests against a real database. Not mocks. Security basics are in: hashed passwords, hashed server-side sessions, role guards and ownership checks on every service, rate-limited handover codes, and an audit log."**

*[Live URL on screen: rescueplate.imrann.my.id.]*

> **"Unlike discount apps, RescuePlate is donor-to-NGO and enforces food-safety time limits. It's live now, and every claim I've made today can be verified from the demo console.**
>
> **Because the two hundred portions of polao at ten p.m. shouldn't go in a bin. They should be on a table. Thank you."**

---

# 90-second cut (for a short slot or a lightning round)

| Time | Show | Say |
|---|---|---|
| 0:00–0:15 | Sign-in page | "Dhaka kitchens throw away safe food every night because NGOs hear about it too late. RescuePlate connects them in real time." |
| 0:15–0:40 | Two windows: post → appears live → claim | "Donor posts, NGO sees it instantly with no refresh, claims part of it. Food-safety deadlines are enforced." |
| 0:40–1:05 | Demo console: Race | "Six NGOs, forty meals, ninety meals of demand, same instant. Exactly forty handed out. Row locks, one transaction, idempotency keys." |
| 1:05–1:20 | Two staff, same field | "Two people edit the same listing. The second gets a conflict dialog, not a silent overwrite." |
| 1:20–1:30 | Live URL + `166 tests` | "Live now, 166 tests on a real database. Try to break it." |

---

# Q&A cheat sheet

**What if two NGOs claim at the same millisecond?**
They queue on the listing's row lock (`SELECT … FOR UPDATE`). The second one sees the first one's result, gets a partial claim (rule R4) or a clean rejection, and `CHECK (remaining_meals >= 0)` backs it up in the database.

**What about deadlocks?**
Every path locks in the same order: listing → organization → claim → user. `lock_timeout` turns a stuck lock into a clean 503, and deadlock or serialization errors are retried.

**Why PostgreSQL NOTIFY and not Redis?**
NOTIFY inside the transaction is delivered only on commit, in commit order, to every app instance, so a rolled-back change is never broadcast. One less moving part.

**Does it scale?**
Honest answer: claims on a single very popular listing are processed one at a time, which is fine at this scale. Next step is a queue or partitioned stock. With several instances, Socket.IO needs sticky sessions for editing presence (the data events already work across instances).

**How do you stop people abusing handover codes or the claim button?**
Rate limits on login, registration and code attempts; the handover code is needed to collect; one open claim per NGO per listing; a daily capacity cap per NGO; only verified organizations can post or claim.

**Is the impact number real?**
It's a stated estimate (0.5 kg per meal, 2.5 kg CO₂e per kg of food). The Bangladesh waste figure is a UNEP household estimate extrapolated from a few local studies, and I say so in the README.

**What's missing?**
OpenStreetMap pins set and show organization locations (with optional live GPS track for volunteers). In-app notifications only, with no SMS or push. SMS would be the first thing to add for volunteers.

**Did you use AI?**
Yes. Coding assistants were used (it says so in the README). The test suite and demo console exist so that every claim can be checked rather than trusted.

---

# If something goes wrong on stage

| Problem | Do this |
|---|---|
| Live app is slow or down | Run locally: `npm install && npm run dev` (bundled PostgreSQL, nothing else needed) and say so. |
| Feed looks empty or stale | Demo console → **Reset demo data** (accounts are kept). |
| Race "passes" but numbers look odd | Re-run it with the defaults (40 meals, 6 contenders, 15 each). |
| Realtime doesn't show up in window B | Check the "Live" badge in the header. Run **Drop the live connection**: it reconnects and refetches, which is itself a good demo of A01. |
| Out of time | Skip the clock fast-forward and go straight from the race to the close. |
