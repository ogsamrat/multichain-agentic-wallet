// Prism Index explorer — queries the live /v1/search API and renders results.
const $ = (id) => document.getElementById(id)
const short = (a) =>
  a && a.length > 16 ? a.slice(0, 9) + '…' + a.slice(-4) : a || ''

const CHAIN_NAMES = {
  'eip155:1': 'Ethereum',
  'eip155:8453': 'Base',
  'eip155:84532': 'Base Sepolia',
  'eip155:42161': 'Arbitrum',
  'eip155:10': 'Optimism',
  'eip155:137': 'Polygon',
  'eip155:43114': 'Avalanche',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'Solana',
  'stellar:pubnet': 'Stellar',
  'bip122:000000000019d6689c085ae165831e93': 'Bitcoin',
  'lightning:bolt11': 'Lightning'
}
const chainName = (c) => CHAIN_NAMES[c] || c

const TYPE_LABELS = {
  x402_http_api: 'x402 api',
  mcp_server: 'mcp server',
  model_endpoint: 'model',
  rpc_infra: 'rpc',
  agent_service: 'agent'
}
const typeLabel = (t) => TYPE_LABELS[t] || (t || '').replace(/_/g, ' ')

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )

function card(r) {
  const pay = (r.paymentOptions || [])
    .map(
      (p) =>
        `<div class="opt"><span class="net">${esc(chainName(p.network))}</span><span class="dot">·</span><span>${esc(p.assetSymbol || p.asset || '')}</span><span class="price">$${Number(p.priceUsd).toFixed(3)}</span><span class="to">${esc(short(p.payTo))}</span></div>`
    )
    .join('')

  const hint = r.callHint
    ? `<div class="hint">${esc(r.callHint.method || 'GET')} ${esc(r.callHint.url || '')}${r.callHint.pay_with ? ' · pay via ' + esc(r.callHint.pay_with) : ''}</div>`
    : ''

  const up = r.uptime30d != null ? (r.uptime30d * 100).toFixed(1) + '%' : '—'
  const p95 =
    r.latencyMs && r.latencyMs.p95 != null ? r.latencyMs.p95 + 'ms' : '—'

  return `<article class="entry">
    <div class="entry-head">
      <div class="entry-title">
        <h3>${esc(r.name || r.slug)}</h3>
        <span class="type">${esc(typeLabel(r.type))}</span>
      </div>
      ${r.verifiedWorking ? '<span class="verified"><i></i>verified</span>' : ''}
    </div>
    <p class="entry-desc">${esc(r.description || '')}</p>
    <div class="entry-meta">
      <div class="m"><b>${Math.round(r.reliabilityScore ?? 0)}</b><label>Reliability</label></div>
      <div class="m"><b>${up}</b><label>Uptime 30d</label></div>
      <div class="m"><b>${p95}</b><label>p95 latency</label></div>
      <div class="m slug"><b>${esc(r.slug)}</b><label>Slug</label></div>
    </div>
    ${pay ? `<div class="pay">${pay}</div>` : ''}
    ${hint}
  </article>`
}

async function search() {
  const p = new URLSearchParams()
  if ($('q').value.trim()) p.set('q', $('q').value.trim())
  if ($('type').value) p.set('type', $('type').value)
  if ($('asset').value.trim()) p.set('asset', $('asset').value.trim())
  if ($('chain').value.trim()) p.set('chain', $('chain').value.trim())
  if ($('maxprice').value) p.set('max_price_usd', $('maxprice').value)
  if ($('sort').value) p.set('sort', $('sort').value)
  $('status').textContent = 'searching…'
  try {
    const res = await fetch('/v1/search?' + p.toString(), {
      headers: { accept: 'application/json' }
    })
    const data = await res.json()
    const results = data.results || []
    const n = data.count ?? results.length
    $('status').textContent = `${n} ${n === 1 ? 'result' : 'results'}`
    $('results').innerHTML = results.length
      ? results.map(card).join('')
      : '<div class="empty">No services match your filters yet.</div>'
  } catch (e) {
    $('status').textContent = 'error'
    $('results').innerHTML =
      '<div class="empty">Could not reach the registry.</div>'
  }
}

async function loadStats() {
  try {
    const res = await fetch('/v1/search?limit=1000', {
      headers: { accept: 'application/json' }
    })
    const data = await res.json()
    const results = data.results || []
    const chains = new Set()
    const types = new Set()
    for (const r of results) {
      types.add(r.type)
      for (const p of r.paymentOptions || []) chains.add(p.network)
    }
    $('stats').innerHTML = [
      ['Verified', data.count ?? results.length],
      ['Service types', types.size],
      ['Payable chains', chains.size]
    ]
      .map(([l, n]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`)
      .join('')
  } catch {
    $('stats').innerHTML = ''
  }
}

// --- Submit a service -------------------------------------------------------
function submitNote(html, ok) {
  $('s-result').innerHTML = `<div class="note ${ok ? 'ok' : 'bad'}">${html}</div>`
}

async function submitService() {
  const type = $('s-type').value
  const name = $('s-name').value.trim()
  const url = $('s-url').value.trim()
  if (!name || !url) {
    submitNote('Name and endpoint URL are required.', false)
    return
  }
  const body = { type, name, endpointUrl: url, description: $('s-desc').value.trim() }
  const method = $('s-method').value.trim()
  if (method) body.httpMethod = method
  const handle = $('s-handle').value.trim()
  if (handle) body.providerHandle = handle
  const tags = $('s-tags').value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  if (tags.length) body.tags = tags
  if (type === 'x402_http_api') {
    body.callHint = { method: method || 'POST', url, pay_with: 'x402_fetch' }
  }

  $('s-status').textContent = 'verifying endpoint…'
  $('s-result').innerHTML = ''
  try {
    const res = await fetch('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json().catch(() => ({}))
    $('s-status').textContent = ''
    if (res.ok) {
      submitNote(
        `Listed <b>${esc(data.slug)}</b> — ${esc(data.status || 'pending_verification')}. It becomes searchable once verification confirms it.`,
        true
      )
      loadStats()
      search()
    } else {
      const inner = data.detail && data.detail.detail && data.detail.detail.error
      submitNote(
        `${esc(data.message || data.error || 'Submission failed')}${inner ? ' — ' + esc(inner) : ''}`,
        false
      )
    }
  } catch (e) {
    $('s-status').textContent = ''
    submitNote('Network error: ' + esc(e && e.message ? e.message : e), false)
  }
}

$('go').addEventListener('click', search)
;['q', 'asset', 'chain', 'maxprice'].forEach((id) =>
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') search()
  })
)
;['type', 'sort'].forEach((id) => $(id).addEventListener('change', search))

$('toggle-submit').addEventListener('click', () => {
  const f = $('submit-form')
  f.hidden = !f.hidden
  $('toggle-submit').textContent = f.hidden ? 'Add a service' : 'Close'
})
$('s-go').addEventListener('click', submitService)

loadStats()
search()
