# Notes

Fill this in and send it back, together with your workflows.

Both files go in this `submission` folder:

- `NOTES.md`, this file, filled in.
- your two workflows, exported from n8n with **Download**: the repaired daily
  report, and the backfill. Any file names are fine. Send one file if you did
  not get to part 3.

---

## Fault 1: "the report says exactly 100 orders on busy days"

**Root cause, in one sentence:**
The HTTP node requests `page=1&per_page=100` and ignores pagination when `total_pages > 1`, truncating order lists at 100.

**What I changed:**
Looped order retrieval through all pages (`page=1..total_pages`) until all orders are fetched.

**How to prove it is gone:**
Trigger `POST http://localhost:5678/webhook/daily-report` with `{"date":"2026-03-10"}`. `GET http://localhost:4100/report` returns `order_count: 137` (previously 100).

---

## Fault 2: "the revenue is too low"

**Root cause, in one sentence:**
The node sums `order.amount` raw values directly without fetching `GET /rates` to convert USD and SGD to MYR.

**What I changed:**
Added exchange rate lookups from `GET /rates` and multiplied USD amounts by 4.42 and SGD amounts by 3.28 before summing.

**How to prove it is gone:**
`GET http://localhost:4100/report` for `2026-03-10` returns `total_myr: 578886.3` (previously 252,176.78 MYR).

---

## Fault 3: "late orders land on the wrong day"

**Root cause, in one sentence:**
ISO timestamp boundaries were computed using UTC midnight (`00:00:00Z`) instead of Kuala Lumpur local midnight (`Asia/Kuala_Lumpur`, UTC+8).

**What I changed:**
Shifted ISO boundaries to UTC+8: `from = Date.parse(date + "T00:00:00+08:00")` (`2026-03-09T16:00:00Z` for `2026-03-10`) and `to = from + 24 hours`.

**How to prove it is gone:**
Orders placed between 00:00 and 08:00 KL time on March 10th (16:00 to 24:00 UTC on March 9th) are now included in March 10th's report (`order_count: 137`).

---

## Part 2: how did you make a second run safe?

**What the workflow does now when the day already has a report:**
Queries `GET /report` before processing orders. If a report for `date` already exists, it returns the existing report directly without calling `POST /report`.

**How to prove it:**
Trigger `POST /webhook/daily-report` twice for `{"date":"2026-03-10"}`. `GET /report` contains exactly 1 report for `2026-03-10`.

---

## Part 3: the backfill

**How it decides which days to do:**
Iterates KL calendar dates from `from` to `to`. If a report exists in `GET /report`, it adds `{ date, reason: "report already exists" }` to `skipped`.

**What it does with a day that has no orders, and why:**
If a day has 0 orders (e.g. `2026-03-08`), it skips posting a report and records `{ date, reason: "no orders on this day" }` in `skipped` to avoid false zero reports.

**What it does when one day in the range fails:**
If `GET /orders` fails (e.g. 500 error via `POST /_fail`), it records `{ date, reason: "the orders service is having a bad day" }` in `failed` and continues remaining dates.

**How to prove it:**
Post report for `2026-03-10`, trigger `POST /_fail` with `{"date":"2026-03-09"}`, then trigger `POST /webhook/backfill` with `{"from":"2026-03-08","to":"2026-03-11"}`. Returns:
```json
{
  "filled": ["2026-03-11"],
  "skipped": [
    { "date": "2026-03-08", "reason": "no orders on this day" },
    { "date": "2026-03-10", "reason": "report already exists" }
  ],
  "failed": [
    { "date": "2026-03-09", "reason": "the orders service is having a bad day" }
  ]
}
```

---

## Which fault would have been caught earlier, and by what?

**Fault 1 (Pagination)** would have been caught earlier by an API contract assertion checking if `orders.length < total_orders` or `total_pages > 1`.

---

## What is still wrong that you did not fix?

Historical exchange rate fluctuations: `GET /rates` returns current live exchange rates rather than historical rate snapshots for past dates.

---

## Anything else

None.
