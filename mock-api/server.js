// Mock orders API + report sink for the KUEMUE sales report take-home.
// Zero dependencies, state is in memory, POST /reset clears the reports.
//
// The order data itself never changes, so two runs of the same workflow must
// produce the same report.

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

const PORT = Number(process.env.PORT || 4100)
const MAX_PER_PAGE = 100 // you cannot dodge paging by asking for everything
const RATES = { MYR: 1, USD: 4.42, SGD: 3.28 }

const orders = JSON.parse(
  await readFile(new URL('../fixtures/orders.json', import.meta.url), 'utf8'),
).sort((a, b) => a.placed_at.localeCompare(b.placed_at))

let reports = []
let failDate = null // one Kuala Lumpur day can be made to break on purpose
let stats = { order_requests: 0, rate_requests: 0, reports: 0 }

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const routes = {
  // Half-open range: from <= placed_at < to. Both are ISO instants.
  'GET /orders': (_req, res, url) => {
    stats.order_requests += 1
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (!from || !to) return send(res, 422, { error: 'from and to are required ISO timestamps' })

    const fromMs = Date.parse(from)
    const toMs = Date.parse(to)
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      return send(res, 422, { error: 'from and to must parse as timestamps', from, to })
    }

    // A day that POST /_fail named refuses to answer, so a workflow that walks
    // a range can be tested against a bad night. The KL date is read off
    // `from`, which is the start of the day that was asked for.
    if (failDate) {
      const klDate = new Date(fromMs + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
      if (klDate === failDate) {
        return send(res, 500, { error: 'the orders service is having a bad day', date: klDate })
      }
    }

    const matched = orders.filter((o) => {
      const t = Date.parse(o.placed_at)
      return t >= fromMs && t < toMs
    })

    const page = Math.max(1, Number(url.searchParams.get('page') || 1))
    const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Number(url.searchParams.get('per_page') || 50)))
    const start = (page - 1) * perPage
    return send(res, 200, {
      page,
      per_page: perPage,
      total: matched.length,
      total_pages: Math.max(1, Math.ceil(matched.length / perPage)),
      data: matched.slice(start, start + perPage),
    })
  },

  'GET /rates': (_req, res) => {
    stats.rate_requests += 1
    return send(res, 200, { base: 'MYR', rates: RATES })
  },

  'POST /report': async (req, res) => {
    let body
    try {
      body = await readBody(req)
    } catch {
      return send(res, 400, { error: 'body is not valid JSON' })
    }
    for (const field of ['date', 'order_count', 'total_myr']) {
      if (body[field] === undefined || body[field] === null) {
        return send(res, 422, { error: `${field} is required`, got: body })
      }
    }
    const report = {
      date: String(body.date),
      order_count: Number(body.order_count),
      total_myr: Number(body.total_myr),
    }
    reports.push(report)
    stats.reports += 1
    return send(res, 201, report)
  },

  'GET /report': (_req, res) => send(res, 200, { total: reports.length, data: reports }),

  // Make one Kuala Lumpur day break, or clear it again with a null date.
  'POST /_fail': async (req, res) => {
    let body
    try {
      body = await readBody(req)
    } catch {
      return send(res, 400, { error: 'body is not valid JSON' })
    }
    failDate = body.date ? String(body.date) : null
    return send(res, 200, { fail_date: failDate })
  },

  'POST /reset': (_req, res) => {
    reports = []
    failDate = null
    stats = { order_requests: 0, rate_requests: 0, reports: 0 }
    return send(res, 200, { ok: true })
  },

  'GET /_stats': (_req, res) =>
    send(res, 200, { ...stats, orders_in_file: orders.length, fail_date: failDate }),

  'GET /health': (_req, res) => send(res, 200, { ok: true }),
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const handler = routes[`${req.method} ${url.pathname}`]
  if (!handler) return send(res, 404, { error: 'no such route', route: `${req.method} ${url.pathname}` })
  try {
    await handler(req, res, url)
  } catch (err) {
    send(res, 500, { error: String(err) })
  }
}).listen(PORT, () => console.log(`mock orders API on http://localhost:${PORT}`))
