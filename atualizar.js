#!/usr/bin/env node
/**
 * Rotina diária do dashboard da Tainá Psiquiatra.
 *
 * Mesmo desenho do B.I. do Depot Meireles: Node puro contra a REST do
 * Windsor.ai. Sem planilha, sem MCP, sem Claude Code no caminho — a rodada
 * depende de três coisas (Node, chave, rede) em vez de cinco.
 *
 *   coleta (Windsor REST) -> ETL (python) -> deploy (wrangler) -> conferência
 *
 * Uso:
 *   node atualizar.js                ciclo completo
 *   node atualizar.js --testar       só valida credenciais e endpoint, não grava
 *   node atualizar.js --sem-deploy   coleta e reprocessa, não publica
 *   node atualizar.js --sem-coleta   reaproveita o que já está em raw/
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = dirname(fileURLToPath(import.meta.url))
const RAW = join(RAIZ, 'raw')
const PROJETO_PAGES = 'taina-psiquiatra'
const PRODUCAO = `https://${PROJETO_PAGES}.pages.dev`
const BASE = 'https://connectors.windsor.ai'

const CONTA_ADS = '938787845322238'
const CONTA_IG = '17841404734420441'
const PRIMEIRA_ENTREGA = '2026-03-12'

/** Janela móvel das extrações diárias de mídia.
 *
 *  A REST ignora `accounts` E `filters`: toda chamada devolve o workspace
 *  inteiro (56 contas no facebook, 61 no instagram). Duas consequências —
 *  o payload é sempre do workspace todo, e a falha de UMA conta qualquer
 *  derruba a chamada. Em 2026-10-15 a conta 941654155150494, de outro cliente,
 *  matou a extração de 7 meses com "incomplete time-series data".
 *
 *  Por isso a rodada diária puxa só os últimos dias e grava em arquivo com a
 *  data no nome. O histórico fica nos arquivos das rodadas anteriores: o ETL
 *  une tudo e deduplica por (data, id), com o mais recente vencendo. É o mesmo
 *  princípio do B.I. do Depot, cujo data.js cobre semanas, não meses. */
/*  A janela é curta de propósito: cada chamada à REST faz o servidor agregar o
 *  workspace inteiro, e uma de 14 dias passou de 10 minutos em 2026-10-15.
 *  Cinco dias cobrem a revisão retroativa da Meta (uns 3 dias) com margem, e o
 *  histórico não depende disto — está nos arquivos das rodadas anteriores.
 *  Para recuperar um trecho maior de uma vez: JANELA_DIAS=30 node atualizar.js */
const JANELA_DIAS = Number(process.env.JANELA_DIAS || 5)

const flags = new Set(process.argv.slice(2))
const soTestar = flags.has('--testar')
const semDeploy = flags.has('--sem-deploy')
const semColeta = flags.has('--sem-coleta')

const log = (m) => console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${m}`)

/** Datas sempre no fuso da conta (-03:00). No GitHub Actions o relógio é UTC,
 *  e deixar o fuso implícito trocaria o dia perto da meia-noite. */
function dia(deslocamento = 0) {
  const t = Date.now() - 3 * 3600_000 + deslocamento * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

function credencial(arquivo, variavel) {
  const caminho = join(RAIZ, arquivo)
  if (existsSync(caminho)) {
    // Bloco de Notas e PowerShell gravam BOM; ele iria junto do token.
    const valor = readFileSync(caminho, 'utf8').replace(/^﻿/, '').trim()
    if (valor) return valor
  }
  return process.env[variavel]?.trim() || null
}

// --- coleta ----------------------------------------------------------------
// Uma entrada por arquivo de raw/. `data: false` pede uma linha por entidade em
// vez de uma por dia — é assim que vem a lista de criativos.
function extracoes() {
  const seisMeses = dia(-183)
  const desde = dia(-JANELA_DIAS)
  const hoje = dia(0)
  return [
    {
      arquivo: `campaign_daily_${hoje}.json`,
      connector: 'facebook',
      conta: CONTA_ADS,
      de: desde,
      ate: hoje,
      fields: ['date', 'account_id', 'campaign', 'campaign_id', 'campaign_objective',
        'campaign_effective_status', 'campaign_daily_budget', 'campaign_start_time',
        'campaign_stop_time', 'spend', 'impressions', 'reach', 'clicks',
        'instagram_profile_follow', 'actions_post_engagement'],
    },
    {
      arquivo: `ad_daily_${hoje}.json`,
      connector: 'facebook',
      conta: CONTA_ADS,
      de: desde,
      ate: hoje,
      fields: ['date', 'account_id', 'ad_id', 'ad_name', 'effective_status', 'campaign',
        'campaign_id', 'adset_name', 'creative_id', 'ad_created_time', 'spend',
        'impressions', 'reach', 'clicks', 'instagram_profile_follow',
        'actions_post_engagement'],
    },
    {
      // Sem 'date' de propósito: uma linha por anúncio. Não acrescente
      // image_url, title nem video_asset_video_id — com eles a resposta
      // despenca para duas linhas.
      arquivo: `creatives_${hoje}.json`,
      criativos: true,
      connector: 'facebook',
      conta: CONTA_ADS,
      de: desde,
      ate: hoje,
      fields: ['ad_id', 'account_id', 'creative_id', 'body', 'thumbnail_url',
        'instagram_permalink_url', 'effective_instagram_media__media_type'],
    },
    {
      arquivo: `ig_media_${dia(0)}.json`,
      connector: 'instagram',
      conta: CONTA_IG,
      de: seisMeses,
      ate: dia(0),
      fields: ['account_id', 'media_id', 'media_permalink', 'media_caption', 'media_type',
        'media_thumbnail_url', 'media_url', 'timestamp', 'media_engagement',
        'media_reach', 'media_views', 'media_like_count', 'media_comments_count',
        'media_saved', 'media_shares'],
    },
    {
      // A origem entrega follower_count só nos últimos 30 dias e recusa datas
      // anteriores. O histórico existe porque cada extração fica guardada.
      arquivo: `ig_followers_${dia(0)}.json`,
      connector: 'instagram',
      conta: CONTA_IG,
      de: dia(-30),
      ate: dia(-1),
      fields: ['date', 'account_id', 'follower_count', 'reach', 'views', 'total_interactions'],
      pos: descartarUltimoDiaZerado,
    },
    {
      arquivo: `ig_profile_${dia(0)}.json`,
      connector: 'instagram',
      conta: CONTA_IG,
      de: dia(0),
      ate: dia(0),
      fields: ['date', 'account_id', 'followers_count', 'follows_count', 'media_count', 'username'],
    },
  ]
}

/** O dia mais recente volta com follower_count 0 enquanto alcance e interações
 *  do mesmo dia vêm cheios: a origem ainda não fechou o número. Gravar o zero
 *  derrubaria o custo por seguidor; a extração seguinte traz o valor final. */
function descartarUltimoDiaZerado(linhas) {
  if (linhas.length < 2) return linhas
  const ultima = linhas[linhas.length - 1]
  if (Number(ultima.follower_count) === 0 && Number(ultima.reach) > 0) {
    log(`  ${ultima.date} descartado: follower_count 0 com alcance ${ultima.reach} (ainda não fechou)`)
    return linhas.slice(0, -1)
  }
  return linhas
}

async function puxar(extracao, tentativas = 3) {
  for (let i = 1; ; i += 1) {
    try {
      return await puxarUmaVez(extracao)
    } catch (erro) {
      // A origem pede retry em texto; vale repetir antes de desistir.
      // 'fetch failed' é o que o Node diz para qualquer erro de rede, e foi
      // exatamente o que derrubou a rodada de 2026-10-15. Tudo que não é erro
      // de dado ou de credencial vale repetir.
      const definitivo = /API key|nenhuma linha da conta|sem account_id|nenhuma lista/i.test(erro.message)
      const transitorio = !definitivo
      if (i >= tentativas || !transitorio) throw erro
      const espera = 15_000 * i
      log(`  ${extracao.connector}: ${erro.message.slice(0, 110)} — nova tentativa em ${espera / 1000}s`)
      await new Promise((r) => setTimeout(r, espera))
    }
  }
}

async function puxarUmaVez({ connector, conta, de, ate, fields }) {
  const url = new URL(`${BASE}/${connector}`)
  url.searchParams.set('api_key', CHAVE)
  url.searchParams.set('accounts', conta)
  url.searchParams.set('date_from', de)
  url.searchParams.set('date_to', ate)
  url.searchParams.set('fields', fields.join(','))

  // Sem timeout explícito o fetch do Node espera para sempre, e a rodada
  // agendada ficaria pendurada até o limite do job.
  const r = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 600_000)),
  })
  const texto = await r.text()
  let corpo
  try {
    corpo = JSON.parse(texto)
  } catch {
    throw new Error(`${connector}: resposta não é JSON (http ${r.status}): ${texto.slice(0, 200)}`)
  }
  if (corpo?.error) throw new Error(`${connector}: ${corpo.error}`)
  if (!r.ok) throw new Error(`${connector}: http ${r.status}`)

  // O envelope já mudou de forma uma vez ({result} -> {status,data,total_rows}).
  // Fica com a primeira chave que dá lista, em vez de depender do nome.
  const linhas = Array.isArray(corpo)
    ? corpo
    : Object.values(corpo).find((v) => Array.isArray(v))
  if (!Array.isArray(linhas)) {
    throw new Error(`${connector}: nenhuma lista na resposta (chaves: ${Object.keys(corpo).join(', ')})`)
  }
  // CRÍTICO: a REST IGNORA o parâmetro `accounts`. Sem o filtro abaixo a
  // resposta traz todas as contas do workspace do Windsor — 61 no Instagram,
  // 56 no Facebook — e somá-las publicaria o crescimento dos outros clientes
  // como se fosse o da Tainá. Conferido em 2026-10-15: para 13/10 a conta dela
  // marca 381 seguidores e a soma de todas dá 2.960.
  // Por isso `account_id` é pedido em toda extração e linha sem ele é erro:
  // deixar passar faria o bug voltar calado.
  const semConta = linhas.filter((l) => !l.account_id).length
  if (semConta) {
    throw new Error(
      `${connector}: ${semConta} linhas sem account_id — não há como separar a ` +
        'conta da Tainá das outras do workspace. Inclua account_id em fields.',
    )
  }
  const minhas = linhas.filter((l) => String(l.account_id) === String(conta))
  if (!minhas.length) {
    throw new Error(`${connector}: nenhuma linha da conta ${conta} em ${linhas.length} recebidas`)
  }
  return minhas
}

/** Só estes prefixos podem ser podados: são retratos de atributos, onde a
 *  extração mais nova substitui a anterior inteira.
 *
 *  O que NÃO entra aqui, e por quê:
 *  - `campaign_daily_*` e `ad_daily_*`: a janela é móvel, então um dia só
 *    existe nos arquivos das rodadas que o alcançaram. Podar apagaria dias.
 *  - `ig_followers_*` e `ig_profile_*`: a origem entrega 30 dias e recusa datas
 *    anteriores. Cada arquivo é a única cópia daquele trecho da série. Foi
 *    assim que 2026-09-09 a 2026-09-14 se perderam para sempre. */
const PODAVEIS = ['creatives', 'ig_media']

function podar(manter = 5) {
  const datado = /^(.*?)_(\d{4}-\d{2}-\d{2})\.json$/
  const grupos = new Map()
  for (const nome of readdirSync(RAW)) {
    const m = nome.match(datado)
    if (!m || !PODAVEIS.includes(m[1])) continue
    if (!grupos.has(m[1])) grupos.set(m[1], [])
    grupos.get(m[1]).push({ nome, data: m[2] })
  }
  for (const [, arquivos] of grupos) {
    if (arquivos.length <= manter) continue
    arquivos.sort((a, b) => b.data.localeCompare(a.data))
    for (const { nome } of arquivos.slice(manter)) {
      rmSync(join(RAW, nome))
      log(`  podado ${nome}`)
    }
  }
}

/** Ids de criativo que já estão em raw/. */
function criativosConhecidos() {
  const ids = new Set()
  for (const nome of readdirSync(RAW)) {
    if (!/^creatives.*\.json$/.test(nome)) continue
    const payload = JSON.parse(readFileSync(join(RAW, nome), 'utf8'))
    const linhas = Object.values(payload).find((v) => Array.isArray(v)) || []
    for (const l of linhas) if (l.creative_id) ids.add(String(l.creative_id))
  }
  return ids
}

/** Ids de criativo que aparecem nas séries diárias. */
function criativosNaSerie() {
  const ids = new Set()
  for (const nome of readdirSync(RAW)) {
    if (!/^ad_daily.*\.json$/.test(nome)) continue
    const payload = JSON.parse(readFileSync(join(RAW, nome), 'utf8'))
    const linhas = Object.values(payload).find((v) => Array.isArray(v)) || []
    for (const l of linhas) if (l.creative_id) ids.add(String(l.creative_id))
  }
  return ids
}

async function coletar() {
  mkdirSync(RAW, { recursive: true })
  for (const extracao of extracoes()) {
    // A consulta de criativos não leva `date`, então a origem agrega TODO
    // anúncio do workspace com o texto completo de cada um — pesada o
    // bastante para derrubar a rodada por tempo. E ela quase nunca muda:
    // só vale pagar esse custo quando aparece criativo que ainda não temos.
    if (extracao.criativos) {
      const novos = [...criativosNaSerie()].filter((id) => !criativosConhecidos().has(id))
      if (!novos.length) {
        log('  criativos: nada novo, extração dispensada')
        continue
      }
      log(`  criativos: ${novos.length} novo(s) — ${novos.slice(0, 4).join(', ')}`)
    }
    let linhas = await puxar(extracao)
    if (extracao.pos) linhas = extracao.pos(linhas)
    if (!linhas.length) throw new Error(`${extracao.arquivo}: origem devolveu zero linhas`)
    writeFileSync(
      join(RAW, extracao.arquivo),
      JSON.stringify({ status: 'done', data: linhas, total_rows: linhas.length }),
    )
    log(`  ${extracao.arquivo}: ${linhas.length} linhas`)
  }
  podar()
}

// --- etapas locais ---------------------------------------------------------
/** Sempre com a string de comando inteira: no Windows `npx` é npx.cmd, e o Node
 *  se recusa a executá-lo sem passar pelo shell. */
function rodar(comando, opcoes = {}) {
  return execSync(comando, { cwd: RAIZ, stdio: ['pipe', 'inherit', 'inherit'], ...opcoes })
}

function publicar() {
  const token = credencial('.cloudflare_token', 'CLOUDFLARE_API_TOKEN')
  if (!token) throw new Error('grave o token em .cloudflare_token ou defina CLOUDFLARE_API_TOKEN')
  const conta = credencial('.cloudflare_account', 'CLOUDFLARE_ACCOUNT_ID')
  const env = { ...process.env, CLOUDFLARE_API_TOKEN: token }
  if (conta) env.CLOUDFLARE_ACCOUNT_ID = conta
  rodar(
    `npx --yes wrangler@4 pages deploy . --project-name=${PROJETO_PAGES} --branch=main --commit-dirty=true`,
    { cwd: join(RAIZ, 'site'), env },
  )
}

/** Deploy que passa não prova que o ar mudou: o cache pode continuar servindo a
 *  versão anterior. A conferência é sobre o dado publicado. */
async function conferir(esperado) {
  for (let tentativa = 1; tentativa <= 4; tentativa += 1) {
    const d = await fetch(`${PRODUCAO}/data/dataset.json?cb=${Date.now()}`).then((r) => r.json())
    if (d.meta.range.end === esperado) {
      log(`no ar: ${d.meta.range.start} a ${d.meta.range.end} | ${d.ads.length} anúncios | extraído ${d.meta.extractedAt}`)
      return
    }
    log(`  ainda servindo ${d.meta.range.end}, esperando ${esperado} (tentativa ${tentativa})`)
    await new Promise((r) => setTimeout(r, 10_000))
  }
  throw new Error(`a produção não passou a servir ${esperado}`)
}

// --- principal -------------------------------------------------------------
const CHAVE = credencial('.windsor_key', 'WINDSOR_API_KEY')

async function principal() {
  if (!CHAVE) {
    throw new Error(
      'chave do Windsor ausente: grave em .windsor_key (está no .gitignore) ' +
        'ou defina WINDSOR_API_KEY',
    )
  }

  if (soTestar) {
    log('teste de credenciais e endpoint — nada é gravado')
    const amostra = await puxar({
      connector: 'facebook', conta: CONTA_ADS, de: dia(-2), ate: dia(0),
      fields: ['date', 'account_id', 'spend', 'impressions'],
    })
    log(`  windsor ok: ${amostra.length} linhas, exemplo ${JSON.stringify(amostra[0] ?? null)}`)
    const ig = await puxar({
      connector: 'instagram', conta: CONTA_IG, de: dia(-2), ate: dia(-1),
      fields: ['date', 'account_id', 'follower_count'],
    })
    log(`  instagram ok: ${ig.length} linhas, exemplo ${JSON.stringify(ig[0] ?? null)}`)
    log(credencial('.cloudflare_token', 'CLOUDFLARE_API_TOKEN') ? '  cloudflare: token presente' : '  cloudflare: TOKEN AUSENTE')
    return
  }

  log(`início — ${RAIZ}`)
  if (semColeta) log('coleta pulada (--sem-coleta)')
  else {
    log('coleta (Windsor REST)')
    await coletar()
  }

  log('ETL')
  rodar('python3 scripts/etl/build_dataset.py')

  const dataset = JSON.parse(readFileSync(join(RAIZ, 'site', 'data', 'dataset.json'), 'utf8'))
  const fim = dataset.meta.range.end

  if (semDeploy) {
    log(`deploy pulado (--sem-deploy). dataset até ${fim}`)
    return
  }

  log('deploy')
  publicar()
  await conferir(fim)
  log(`fim — ${PRODUCAO}`)
}

principal().catch((erro) => {
  console.error(`FALHOU: ${erro.message}`)
  process.exit(1)
})
