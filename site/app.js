/* Dashboard Tainá Psiquiatra — interface.
   Lê window.TAINA_DATA, gerado por scripts/etl/build_dataset.py.
   Sem framework e sem build: o arquivo é servido como está. */
(() => {
  const D = window.TAINA_DATA
  const $ = (id) => document.getElementById(id)

  // ---------- formatação ----------
  const nf = new Intl.NumberFormat('pt-BR')
  const money = (v) => v == null ? '—' : 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const moneyFine = (v) => v == null ? '—' : 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })
  const int = (v) => v == null ? '—' : nf.format(Math.round(v))
  const pct = (v) => v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'
  const dataBR = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—'

  /** Divisão que não mente: sem denominador, não há número. */
  const ratio = (a, b) => (!b ? null : a / b)

  // ---------- período ----------
  let dias = 30
  let pagina = 'visao'

  const todasDatas = D.daily.account.map((r) => r.date)
  const ultimaData = todasDatas[todasDatas.length - 1]

  function janela() {
    if (!dias) return { de: todasDatas[0], ate: ultimaData }
    const fim = new Date(ultimaData + 'T00:00:00Z')
    const ini = new Date(fim.getTime() - (dias - 1) * 86400000)
    return { de: ini.toISOString().slice(0, 10), ate: ultimaData }
  }
  const dentro = (d, j) => d >= j.de && d <= j.ate

  const soma = (linhas, campo) => linhas.reduce((t, r) => t + (r[campo] || 0), 0)
  /** Soma que devolve null quando NENHUM dia do período tem o dado — assim a
   *  métrica aparece como "—" em vez de zero, que seria leitura errada. */
  function somaOuNulo(linhas, campo) {
    const com = linhas.filter((r) => r[campo] != null)
    return com.length ? com.reduce((t, r) => t + r[campo], 0) : null
  }

  // ---------- cartões ----------
  function kpi(lbl, val, sub, delta) {
    const d = delta == null ? '' :
      `<div class="delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}">${delta > 0 ? '▲' : delta < 0 ? '▼' : '='} ${Math.abs(delta).toFixed(1).replace('.', ',')}% vs período anterior</div>`
    return `<div class="kpi"><div class="lbl">${lbl}</div><div class="val tnum">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ''}${d}</div>`
  }
  function variacao(atual, anterior) {
    if (atual == null || anterior == null || !anterior) return null
    return ((atual - anterior) / anterior) * 100
  }
  function janelaAnterior(j) {
    const ini = new Date(j.de + 'T00:00:00Z'), fim = new Date(j.ate + 'T00:00:00Z')
    const n = Math.round((fim - ini) / 86400000) + 1
    const aFim = new Date(ini.getTime() - 86400000)
    const aIni = new Date(aFim.getTime() - (n - 1) * 86400000)
    return { de: aIni.toISOString().slice(0, 10), ate: aFim.toISOString().slice(0, 10) }
  }

  // ---------- gráfico de linha, série única ----------
  function plot(destino, pontos, rotulo, formata) {
    const el = $(destino)
    if (!pontos.length) { el.innerHTML = '<div class="empty">Sem dados no período.</div>'; return }
    const W = 1000, H = 260, mL = 56, mR = 14, mT = 14, mB = 26
    const max = Math.max(...pontos.map((p) => p.v), 0)
    const min = Math.min(...pontos.map((p) => p.v), 0)
    const topo = max === min ? max + 1 : max + (max - min) * 0.12
    const base = min < 0 ? min : 0
    const x = (i) => mL + (pontos.length === 1 ? (W - mL - mR) / 2 : (i * (W - mL - mR)) / (pontos.length - 1))
    const y = (v) => mT + (H - mT - mB) * (1 - (v - base) / (topo - base || 1))

    const linha = pontos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
    const area = `${linha} L${x(pontos.length - 1).toFixed(1)},${y(base)} L${x(0).toFixed(1)},${y(base)} Z`

    const passos = 4
    const grade = Array.from({ length: passos + 1 }, (_, i) => {
      const v = base + ((topo - base) * i) / passos
      return `<line x1="${mL}" x2="${W - mR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
              <text x="${mL - 8}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${formata(v, true)}</text>`
    }).join('')

    // Rótulos do eixo X: a última data sempre aparece, mas só se não colidir
    // com a anterior — senão vira "12/10 14/10" grudado.
    const passo = Math.max(1, Math.ceil(pontos.length / 8))
    const escolhidos = pontos.map((_, i) => i).filter((i) => i % passo === 0)
    const ultimo = pontos.length - 1
    if (ultimo > 0 && !escolhidos.includes(ultimo)) {
      if (x(ultimo) - x(escolhidos[escolhidos.length - 1]) < 64) escolhidos.pop()
      escolhidos.push(ultimo)
    }
    const eixoX = escolhidos.map((i) =>
      `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${dataBR(pontos[i].d)}</text>`).join('')

    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${rotulo} por dia">
        <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#d9c08b" stop-opacity=".22"/>
          <stop offset="100%" stop-color="#d9c08b" stop-opacity="0"/>
        </linearGradient></defs>
        <g class="grid axis">${grade}</g>
        <g class="axis">${eixoX}</g>
        <path class="area" d="${area}"/>
        <path class="serie" d="${linha}"/>
        <line class="cross hidden" id="${destino}-cross" y1="${mT}" y2="${H - mB}"/>
        <circle class="dot hidden" id="${destino}-dot" r="4.5"/>
        <rect x="${mL}" y="0" width="${W - mL - mR}" height="${H}" fill="transparent" id="${destino}-hit"/>
      </svg>
      <div class="tip" id="${destino}-tip"></div>`

    // camada de hover: um gráfico em HTML é interativo por definição
    const svg = el.querySelector('svg'), hit = $(`${destino}-hit`)
    const cross = $(`${destino}-cross`), dot = $(`${destino}-dot`), tip = $(`${destino}-tip`)
    hit.addEventListener('mousemove', (ev) => {
      const cx = svg.getBoundingClientRect()
      const rel = ((ev.clientX - cx.left) / cx.width) * W
      let melhor = 0, dist = Infinity
      pontos.forEach((_, i) => { const d = Math.abs(x(i) - rel); if (d < dist) { dist = d; melhor = i } })
      const p = pontos[melhor]
      cross.classList.remove('hidden'); dot.classList.remove('hidden'); tip.classList.add('on')
      cross.setAttribute('x1', x(melhor)); cross.setAttribute('x2', x(melhor))
      dot.setAttribute('cx', x(melhor)); dot.setAttribute('cy', y(p.v))
      tip.innerHTML = `<div class="d">${dataBR(p.d)}</div><div class="v">${formata(p.v)}</div>`
      tip.style.left = `${(x(melhor) / W) * 100}%`
      tip.style.top = `${(y(p.v) / H) * 100}%`
    })
    hit.addEventListener('mouseleave', () => {
      cross.classList.add('hidden'); dot.classList.add('hidden'); tip.classList.remove('on')
    })
  }

  const curto = (v) => Math.abs(v) >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',') + 'k' : nf.format(Math.round(v))

  // ---------- VISÃO GERAL ----------
  const METRICAS_PERFIL = [
    { k: 'follows', r: 'Novos seguidores', f: int },
    { k: 'reach', r: 'Alcance', f: int },
    { k: 'views', r: 'Visualizações', f: int },
    { k: 'interactions', r: 'Interações', f: int },
    { k: 'likes', r: 'Curtidas', f: int },
    { k: 'comments', r: 'Comentários', f: int },
    { k: 'shares', r: 'Compartilhamentos', f: int },
    { k: 'saves', r: 'Salvamentos', f: int },
  ]
  let metricaPerfil = 'follows'

  function renderVisao() {
    const j = janela(), ja = janelaAnterior(j)
    const perfil = D.daily.profile.filter((r) => dentro(r.date, j))
    const antes = D.daily.profile.filter((r) => dentro(r.date, ja))

    const v = (c) => somaOuNulo(perfil, c), va = (c) => somaOuNulo(antes, c)
    $('visaoKpis').innerHTML = [
      kpi('Seguidores totais', int(D.profile.followersTotal), `no perfil em ${dataBR(D.profile.snapshotDate)}`),
      kpi('Novos seguidores', int(v('follows')), 'no período', variacao(v('follows'), va('follows'))),
      kpi('Alcance', int(v('reach')), 'contas alcançadas', variacao(v('reach'), va('reach'))),
      kpi('Visualizações', int(v('views')), null, variacao(v('views'), va('views'))),
      kpi('Interações', int(v('interactions')), 'curtidas + comentários + salvos + compart.', variacao(v('interactions'), va('interactions'))),
      kpi('Curtidas', int(v('likes')), null, variacao(v('likes'), va('likes'))),
      kpi('Comentários', int(v('comments')), null, variacao(v('comments'), va('comments'))),
      kpi('Compartilhamentos', int(v('shares')), null, variacao(v('shares'), va('shares'))),
      kpi('Salvamentos', int(v('saves')), null, variacao(v('saves'), va('saves'))),
    ].join('')

    $('visaoMetrics').innerHTML = METRICAS_PERFIL
      .map((m) => `<button data-m="${m.k}" class="${m.k === metricaPerfil ? 'on' : ''}">${m.r}</button>`).join('')
    $('visaoMetrics').querySelectorAll('button').forEach((b) => b.onclick = () => { metricaPerfil = b.dataset.m; renderVisao() })

    const m = METRICAS_PERFIL.find((x) => x.k === metricaPerfil)
    const pontos = perfil.filter((r) => r[m.k] != null).map((r) => ({ d: r.date, v: r[m.k] }))
    plot('visaoPlot', pontos, m.r, (x, eixo) => eixo ? curto(x) : m.f(x))

    const cob = D.profile.coverage
    const comDetalhe = D.daily.profile.filter((r) => r.likes != null)
    $('visaoNota').textContent =
      `A série do perfil cobre ${cob ? `${dataBR(cob.start)} a ${dataBR(cob.end)}` : 'nenhum período'}` +
      (comDetalhe.length ? `; curtidas, comentários, compartilhamentos e salvamentos existem de ${dataBR(comDetalhe[0].date)} em diante. ` : '. ') +
      'A origem entrega apenas os últimos 30 dias dessa série, e o histórico é acumulado a cada extração — dias anteriores à primeira coleta não voltam.'
    $('visaoSub').textContent = `Perfil @${D.profile.username} · ${dataBR(j.de)} a ${dataBR(j.ate)}`
  }

  // ---------- NÚMEROS DO TRÁFEGO ----------
  const METRICAS_ADS = [
    { k: 'spend', r: 'Investimento', f: money },
    { k: 'impressions', r: 'Impressões', f: int },
    { k: 'reach', r: 'Alcance', f: int },
    { k: 'clicks', r: 'Cliques', f: int },
    { k: 'engagement', r: 'Engajamento', f: int },
  ]
  let metricaAds = 'spend'

  function renderTrafego() {
    const j = janela(), ja = janelaAnterior(j)
    const dias_ = D.daily.account.filter((r) => dentro(r.date, j))
    const antes = D.daily.account.filter((r) => dentro(r.date, ja))
    const s = (c) => soma(dias_, c), sa = (c) => soma(antes, c)

    // Seguidores aqui são os TOTAIS do perfil (Meta Business), não os que o
    // gerenciador atribui ao anúncio. E o custo por seguidor só pode cruzar
    // gasto com seguidores nos dias em que AMBOS existem — senão divide o
    // investimento inteiro por uma janela curta de perfil e inventa um número.
    const diasPerfil = new Set(D.daily.profile.map((r) => r.date))
    const cobertos = dias_.filter((r) => diasPerfil.has(r.date))
    const cobertosAntes = antes.filter((r) => diasPerfil.has(r.date))
    const segPeriodo = somaOuNulo(D.daily.profile.filter((r) => dentro(r.date, j)), 'follows')
    const segAntes = somaOuNulo(D.daily.profile.filter((r) => dentro(r.date, ja)), 'follows')
    const gastoCoberto = soma(cobertos, 'spend')
    const custoSeg = ratio(gastoCoberto, segPeriodo)
    const custoSegAntes = ratio(soma(cobertosAntes, 'spend'), segAntes)

    $('trafegoKpis').innerHTML = [
      kpi('Valor investido', money(s('spend')), `${dias_.length} dias`, variacao(s('spend'), sa('spend'))),
      kpi('Impressões', int(s('impressions')), null, variacao(s('impressions'), sa('impressions'))),
      kpi('Alcance', int(s('reach')), null, variacao(s('reach'), sa('reach'))),
      kpi('Cliques', int(s('clicks')), null, variacao(s('clicks'), sa('clicks'))),
      kpi('CTR', pct(ratio(s('clicks'), s('impressions')) * 100 || null), 'cliques ÷ impressões'),
      kpi('CPC', money(ratio(s('spend'), s('clicks'))), 'custo por clique'),
      kpi('CPM', money(ratio(s('spend'), s('impressions')) * 1000 || null), 'custo por mil impressões'),
      kpi('Seguidores do perfil', int(segPeriodo), 'Meta Business, não o gerenciador', variacao(segPeriodo, segAntes)),
      kpi('Custo por seguidor', moneyFine(custoSeg),
        cobertos.length < dias_.length ? `sobre ${cobertos.length} de ${dias_.length} dias com série do perfil` : 'investimento ÷ seguidores do perfil',
        variacao(custoSeg, custoSegAntes)),
    ].join('')

    $('trafegoMetrics').innerHTML = METRICAS_ADS
      .map((m) => `<button data-m="${m.k}" class="${m.k === metricaAds ? 'on' : ''}">${m.r}</button>`).join('')
    $('trafegoMetrics').querySelectorAll('button').forEach((b) => b.onclick = () => { metricaAds = b.dataset.m; renderTrafego() })

    const m = METRICAS_ADS.find((x) => x.k === metricaAds)
    plot('trafegoPlot', dias_.map((r) => ({ d: r.date, v: r[m.k] })), m.r,
      (x, eixo) => eixo ? (m.k === 'spend' ? 'R$ ' + curto(x) : curto(x)) : m.f(x))

    // tabela de campanhas
    const porCamp = new Map()
    D.daily.campaign.filter((r) => dentro(r.date, j)).forEach((r) => {
      const t = porCamp.get(r.campaignId) || { spend: 0, impressions: 0, clicks: 0, follows: 0 }
      t.spend += r.spend; t.impressions += r.impressions; t.clicks += r.clicks; t.follows += r.follows
      porCamp.set(r.campaignId, t)
    })
    const nomes = new Map(D.campaigns.map((c) => [c.id, c]))
    const linhas = [...porCamp.entries()]
      .map(([id, t]) => ({ ...t, id, c: nomes.get(id) }))
      .filter((r) => r.impressions > 0)
      .sort((a, b) => b.spend - a.spend)
    $('tabCampanhas').innerHTML = linhas.length ? `
      <thead><tr><th>Campanha</th><th>Status</th><th>Investido</th><th>Impressões</th><th>Cliques</th><th>CPC</th></tr></thead>
      <tbody>${linhas.map((r) => `<tr>
        <td>${(r.c?.name || r.id).replace(/</g, '&lt;')}</td>
        <td><span class="badge ${r.c?.status === 'ACTIVE' ? 'on' : ''}">${r.c?.status === 'ACTIVE' ? 'Ativa' : 'Pausada'}</span></td>
        <td class="tnum">${money(r.spend)}</td>
        <td class="tnum">${int(r.impressions)}</td>
        <td class="tnum">${int(r.clicks)}</td>
        <td class="tnum">${money(ratio(r.spend, r.clicks))}</td>
      </tr>`).join('')}</tbody>` : '<tbody><tr><td class="empty">Nenhuma campanha com entrega no período.</td></tr></tbody>'

    $('trafegoSub').textContent = `Conta ${D.meta.account.name} · ${dataBR(j.de)} a ${dataBR(j.ate)}`
    $('trafegoNota').textContent = D.meta.notes.reach + ' ' + D.meta.notes.followersCoverage
  }

  // ---------- CRIATIVOS ----------
  function cartaoAd(a, posicao) {
    const post = a.post
    const eng = post ? `<div class="eng"><b>${int(post.engagement)}</b> engajamentos no post</div>` : ''
    const link = a.instagramUrl
      ? `<a class="link" href="${a.instagramUrl}" target="_blank" rel="noopener">Ver no Instagram</a>`
      : '<div class="nolink">Publicação não vinculada</div>'
    return `<div class="ad">
      <div class="thumb">${a.thumb ? `<img src="${a.thumb}" alt="" loading="lazy">` : ''}${posicao ? `<span class="rank">${posicao}</span>` : ''}</div>
      <div class="body">
        <div class="t">${(a.name || '').replace(/</g, '&lt;')}</div>
        <div class="m">${(a.campaignName || '').replace(/</g, '&lt;')}<br>${(a.adsetName || '').replace(/</g, '&lt;')} · ${a.format}</div>
        ${eng}${link}
      </div></div>`
  }

  function renderCriativos() {
    const j = janela()
    const comEntrega = new Set(D.daily.ad.filter((r) => dentro(r.date, j) && r.impressions > 0).map((r) => r.adId))
    const noPeriodo = D.ads.filter((a) => comEntrega.has(a.id) || (a.createdTime >= j.de && a.createdTime <= j.ate))

    // Top publicações: ordem pelo engajamento do POST, não do anúncio. Dois
    // anúncios podem impulsionar a mesma publicação, então deduplica por link.
    const porPost = new Map()
    noPeriodo.filter((a) => a.post && a.instagramUrl).forEach((a) => {
      const atual = porPost.get(a.instagramUrl)
      if (!atual || (a.post.engagement || 0) > (atual.post.engagement || 0)) porPost.set(a.instagramUrl, a)
    })
    const top = [...porPost.values()].sort((a, b) => (b.post.engagement || 0) - (a.post.engagement || 0)).slice(0, 5)
    $('topPosts').innerHTML = top.length ? top.map((a, i) => cartaoAd(a, i + 1)).join('')
      : '<div class="empty">Nenhum criativo com publicação vinculada neste período.</div>'

    const ordenados = [...noPeriodo].sort((a, b) => {
      const ea = a.post?.engagement ?? -1, eb = b.post?.engagement ?? -1
      if (ea !== eb) return eb - ea
      return Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE')
    })
    $('gridAds').innerHTML = ordenados.length ? ordenados.map((a) => cartaoAd(a)).join('')
      : '<div class="empty">Nenhum criativo no período.</div>'

    const comLink = ordenados.filter((a) => a.instagramUrl).length
    $('criativosSub').textContent = `${ordenados.length} criativos · ${dataBR(j.de)} a ${dataBR(j.ate)}`
    $('criativosHint').textContent = `${comLink} de ${ordenados.length} com publicação vinculada. ${D.meta.notes.instagramLink.split('.').slice(1).join('.').trim()}`
  }

  // ---------- navegação ----------
  function render() {
    ;['visao', 'trafego', 'criativos'].forEach((p) => $(`page-${p}`).classList.toggle('hidden', p !== pagina))
    if (pagina === 'visao') renderVisao()
    else if (pagina === 'trafego') renderTrafego()
    else renderCriativos()
  }

  $('nav').querySelectorAll('a').forEach((a) => a.onclick = () => {
    $('nav').querySelectorAll('a').forEach((o) => o.classList.remove('active'))
    a.classList.add('active'); pagina = a.dataset.page; render()
  })
  $('ranges').querySelectorAll('button').forEach((b) => b.onclick = () => {
    $('ranges').querySelectorAll('button').forEach((o) => o.classList.remove('on'))
    b.classList.add('on'); dias = Number(b.dataset.r); render()
  })

  render()
})()
