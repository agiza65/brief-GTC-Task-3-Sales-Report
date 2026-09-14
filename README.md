# Take-home: the daily sales report is wrong (n8n)

**Time budget: 5 to 6 hours.** Most of it is a repair job, not a build. If you
run out of time, stop and write down what you found and what you would do next.
We would rather read a clear diagnosis of two faults than a silent fix of three.

There are three parts. Part 1 is the repair, and it is the one that matters
most. Do it first. Part 2 and part 3 build on it.

## The situation

Every morning a workflow posts yesterday's sales report: how many orders, and
how much money in ringgit. It has been running for months. Nobody has touched
it since the person who built it left.

Last week the sales lead started complaining. Three separate complaints, in
their own words:

> "The report says exactly 100 orders on our busy days. Every time. On the
> quiet days it looks fine. 100 is a suspicious number."

> "The revenue is too low. That week we sold a lot to the US and to Singapore
> and the total barely moved."

> "Orders that come in late at night land on the wrong day. My night shift is
> being credited to tomorrow."

Your job is to find out why, fix it, and tell us how you know it is fixed.
That is part 1.

## Part 2: it must be safe to run twice

A dashboard now reads `GET /report` and trusts it. One date must hold exactly
one report, however many times the workflow runs. We trigger 10 March twice and
count the rows.

We also run 11 March, because a fix for one day must not quietly break another.

## Part 3: fill the days nobody reported

Some mornings the workflow did not run at all, and those days have no report.
Build a **second** workflow, from scratch, in the same n8n.

- Webhook `backfill`, method `POST`, body `{"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}`.
  Both ends are included. Both are Kuala Lumpur dates.
- It reports every day in that range that has no report yet. A day that already
  has one is left exactly as it is.
- A day with no orders is **not** a report of zero. Skip it, and say why. We
  would rather see a gap than a lie.
- One bad day must not kill the range. Finish the others, and put the day and
  the reason in `failed`. `POST /_fail` lets you break a day and try it.
- Answer with `{"filled": [...], "skipped": [...], "failed": [...]}`. Dates in
  `filled`. In `skipped` and `failed`, an object with the date and a reason.

Switch the backfill on as well, the same toggle as the daily report. It must
answer **when it finishes**, with the summary as the body, not the moment it
starts. That is the webhook's response setting, and the default is not the one
you want.

We call it with `{"from":"2026-03-08","to":"2026-03-11"}` after 10 March is
already reported. Then we break a day and call it again.

## The business rules

These are not in dispute. They are how the business works.

- A sales day is a **Kuala Lumpur day**, `Asia/Kuala_Lumpur`, which is UTC+8.
  The order API stores every timestamp in UTC.
- The report is always in **MYR**. Orders arrive in MYR, USD and SGD.
- Exchange rates come from `GET /rates`. Read them at run time. Do not type a
  rate into the workflow.

## Run the bench

You need Docker. From this folder:

```bash
docker compose up
```

- n8n: http://localhost:5678 (create a local owner account, anything works, it never leaves your machine)
- orders API: http://localhost:4100

The broken workflow is in `broken/daily-sales-report.json`. Import it into n8n
with **Workflow menu > Import from File**.

## The API

Base URL from inside n8n: `http://mock-api:4100`. Use `mock-api`, not
`localhost`. Inside the n8n container, `localhost` is n8n itself.

| Call | Behaviour |
|---|---|
| `GET /orders?from=<ISO>&to=<ISO>&page=1&per_page=50` | Orders where `from <= placed_at < to`. Returns `{page, per_page, total, total_pages, data}`. |
| | `per_page` is **capped at 100**. Asking for more does not give you more. |
| `GET /rates` | `{base: "MYR", rates: {MYR, USD, SGD}}` |
| `POST /report` | Body: `{date, order_count, total_myr}`. This is the report. |
| `GET /report` | Every report posted so far. Handy while you work. |
| `POST /reset` | Clear the posted reports, and any broken day. The orders never change. |
| `POST /_fail` | Body: `{date}`. That Kuala Lumpur day stops answering `GET /orders`, with a 500. Send `{"date": null}` to mend it. Use it to see what your backfill does with a bad night. |

The order data is fixed and read-only. If you find yourself editing
`fixtures/orders.json` or `mock-api/server.js` to make a number come out
right, stop. The fault is in the workflow.

## How we trigger it

```bash
curl -X POST http://localhost:5678/webhook/daily-report -H 'content-type: application/json' -d '{"date":"2026-03-10"}'
```

On Windows PowerShell, use this instead:

```powershell
Invoke-RestMethod -Method Post http://localhost:5678/webhook/daily-report -ContentType 'application/json' -Body '{"date":"2026-03-10"}'
```

Keep all of this the same, we test against it:

- webhook path `daily-report`, method `POST`
- the report date arrives as `{"date": "YYYY-MM-DD"}` in the body
- the workflow posts exactly one report per run, shaped
  `{date, order_count, total_myr}`
- the workflow is switched on, so the production webhook answers. That is the
  toggle at the top right of the editor, labelled **Active** or **Publish**
  depending on your n8n version. While it is off, only the test URL works, and
  only for one call.

We run it for more than one date, and we run the same date twice.

## What you send back

Everything goes in the `submission/` folder. Open it now: `NOTES.md` is
already there, with the questions we want answered.

1. **Your two workflows.** In the n8n editor, open the workflow menu and
   choose **Download**, once for the repaired daily report and once for the
   backfill. Save both files into `submission/`. Any file names work. If you
   did not get to part 3, send one file.
2. **`NOTES.md`**, filled in. For each of the three complaints it asks for the
   root cause, the change you made, and how to prove the fault is gone. Then a
   few short questions about part 2 and part 3. It is already written out for
   you, so you only add the answers.

Then zip this whole folder and send it back, or push it to a private
repository and send us the link.

The notes matter as much as the fix. We read them first. A cause explained
well beats a fault repaired silently.

## What we mark

| We care a lot about | We do not care about |
|---|---|
| Did you find all three causes | Whether the canvas is tidy |
| Can you tell a cause from a symptom | Node count |
| Is your proof repeatable by us | Whether you used Code nodes or built-in nodes |
| Did you avoid breaking the two working parts | Extra features nobody asked for |

Part 2 and part 3 are marked the same way. Is a second run safe, and can you
say why? Does the backfill leave a visible gap rather than a false zero? Does
one bad day cost you the rest of the range?

One warning. Two of the three faults can be made to *look* fixed for one
particular date by hardcoding a number. We run other dates. A workflow that
only gets 10 March right scores worse than one honest fix and a written
"I ran out of time on the third".

## Allowed help

Use AI tools, Google, the n8n docs, anything. We will ask you to walk us
through the three faults and your backfill on a call, so make sure you can
explain each one.
