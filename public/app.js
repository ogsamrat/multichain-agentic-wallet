// Prism Index explorer — queries the live /v1/search API and renders results.
const $ = (id) => document.getElementById(id)
const short = (a) =>
  a && a.length > 14 ? a.slice(0, 8) + '…' + a.slice(-4) : a || ''

const CHAIN_NAMES = {
  'eip155:1': 'Ethereum',
  'eip155:8453': 'Base',
  'eip155:84532': 'Base Sepolia',
  'eip155:42161': 'Arbitrum',
  'eip155:10': 'Optimism',
  'eip155:137': 'Polygon',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'Solana'
}
const chainName = (caip2) => CHAIN_NAMES[caip2] || caip2

function card(r) {
  const pay = (r.paymentOptions || [])
    .map(
      (p) =>
        `<div class="opt"><span class="chip">${chainName(p.network)}</span><span>${p.assetSymbol || p.asset || ''}</span><b>$${Number(p.priceUsd).toFixed(3)}</b><span class="muted chip">→ ${short(p.payTo)}</span></div>`
    )
    .join('')
  const hint = r.callHint
    ? `<div class="hint">${r.callHint.method || 'GET'} ${r.callHint.url || ''} ${r.callHint.pay_with ? '· pay_with: ' + r.callHint.pay_with : ''}</div>`
    : ''
  const up = r.uptime30d != null ? (r.uptime30d * 100).toFixed(1) + '%' : '—'
  const p95 =
    r.latencyMs && r.latencyMs.p95 != null ? r.latencyMs.p95 + 'ms' : '—'
  return `<article class="card">
      <div class="row spread">
        <h3>${r.name || r.slug}</h3>
        <div class="row">
          ${r.verifiedWorking ? '<span class="badge ok">✓ verified live</span>' : ''}
          <span class="badge type">${r.type}</span>
        </div>
      </div>
      <div class="desc">${r.description || ''}</div>
      <div class="meta">
        <span>reliability <b>${Math.round(r.reliabilityScore ?? 0)}</b>/100</span>
        <span>uptime <b>${up}</b></span>
        <span>p95 <b>${p95}</b></span>
        <span>slug <b>${r.slug}</b></span>
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
  $('status').textContent = 'Searching…'
  try {
    const res = await fetch('/v1/search?' + p.toString(), {
      headers: { accept: 'application/json' }
    })
    const data = await res.json()
    const results = data.results || []
    $('status').textContent = `${data.count ?? results.length} result(s)`
    $('results').innerHTML = results.length
      ? results.map(card).join('')
      : '<div class="empty">No verified services match your filters yet.</div>'
  } catch (e) {
    $('status').textContent = 'Error: ' + (e && e.message ? e.message : e)
    $('results').innerHTML =
      '<div class="empty">Could not reach the registry API.</div>'
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
      ['verified services', data.count ?? results.length],
      ['service types', types.size],
      ['payable chains', chains.size]
    ]
      .map(
        ([l, n]) =>
          `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`
      )
      .join('')
  } catch {
    $('stats').innerHTML = ''
  }
}

$('go').addEventListener('click', search)
;['q', 'asset', 'chain', 'maxprice'].forEach((id) =>
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') search()
  })
)
;['type', 'sort'].forEach((id) => $(id).addEventListener('change', search))

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

  $('s-status').textContent = 'Verifying endpoint…'
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
        `✓ Submitted <b>${data.slug}</b> — status <b>${data.status || 'pending_verification'}</b>. It becomes searchable once verification confirms it.`,
        true
      )
      loadStats()
      search()
    } else {
      const inner = data.detail && data.detail.detail && data.detail.detail.error
      submitNote(
        `✗ ${data.message || data.error || 'Submission failed'}${inner ? ' — ' + inner : ''}`,
        false
      )
    }
  } catch (e) {
    $('s-status').textContent = ''
    submitNote('Network error: ' + (e && e.message ? e.message : e), false)
  }
}

$('toggle-submit').addEventListener('click', () => {
  const f = $('submit-form')
  f.hidden = !f.hidden
  $('toggle-submit').textContent = f.hidden ? '＋ Add a service' : '− Hide'
})
$('s-go').addEventListener('click', submitService)

loadStats()
search()
