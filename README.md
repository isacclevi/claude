# Dashboard Tainá Psiquiatra

No ar: https://taina-psiquiatra.pages.dev

## O que está aqui

| pasta | o que é |
|---|---|
| `raw/` | respostas cruas do Windsor.ai, versionadas de propósito — é o rastro de auditoria de onde cada número veio |
| `scripts/etl/build_dataset.py` | monta `site/data/dataset.json` a partir de `raw/` |
| `site/` | o site publicado: `index.html`, o bundle em `assets/`, as miniaturas em `creatives/` e o dataset em `data/` |

## O que NÃO está aqui

O código-fonte React (`src/`), o `package.json` do app e a automação de
Windows. O container da sessão de 2026-09-10 foi reciclado antes de o push
passar, e esses arquivos se perderam — existem só na cópia que está na máquina
do Isac. O que foi reconstruído em 2026-10-15 foi a camada de dados: o ETL, a
partir do formato do `dataset.json` que estava publicado, e o `site/`, baixado
do ar.

Consequência prática: dá para atualizar o dado e republicar, mas mudança de
interface exige o `src/` de volta.

## Atualizar

Uma linha, e ela faz o ciclo inteiro — coleta, ETL, build do dataset, deploy e
conferência do que ficou no ar:

```bash
node atualizar.js
```

| comando | para quê |
|---|---|
| `node atualizar.js --testar` | valida chave, endpoint e token sem gravar nada |
| `node atualizar.js --sem-deploy` | coleta e reprocessa, não publica |
| `node atualizar.js --sem-coleta` | reaproveita o que já está em `raw/` |

Credenciais: `.windsor_key` e `.cloudflare_token` como arquivos soltos na raiz
(ambos no `.gitignore`), ou `WINDSOR_API_KEY` e `CLOUDFLARE_API_TOKEN` no
ambiente. É o mesmo desenho do B.I. do Depot Meireles: Node puro contra a REST
do Windsor, sem planilha e sem MCP.

O MCP do Meta Ads não participa: perdeu acesso à conta 938787845322238 em
2026-09-10. E o MCP do Windsor saiu do caminho da rotina em 2026-10-15 — ele
exigia Claude Code instalado, logado e um modelo seguindo uma skill, cinco
peças de pé para uma tarefa que são seis requisições HTTP.

## Uma vez por dia

`.github/workflows/atualizar.yml` roda `node atualizar.js` todo dia às 11:00 UTC
(08:00 em Fortaleza) e faz commit do que foi extraído. Precisa de três secrets
no repositório — Settings · Secrets and variables · Actions:

| secret | o que é |
|---|---|
| `WINDSOR_API_KEY` | chave da API do Windsor.ai |
| `CLOUDFLARE_API_TOKEN` | token de deploy do Cloudflare Pages |
| `CLOUDFLARE_ACCOUNT_ID` | id da conta Cloudflare |

Roda na nuvem, então não depende de computador ligado. O commit das extrações
não é zelo: é o que mantém o histórico da série de seguidores vivo.

## A armadilha do parâmetro `accounts`

A REST do Windsor **ignora** o parâmetro `accounts`. Uma chamada ao connector
`instagram` devolve as 61 contas do workspace; ao `facebook`, as 56. Somar o que
volta publicaria o resultado dos outros clientes da agência como se fosse o
desta conta — em 2026-10-15, 2.960 seguidores no lugar de 381, e R$ 84.105,49
no lugar de R$ 12,02.

Por isso `account_id` é pedido em toda extração e o filtro é feito no cliente.
Linha sem `account_id` derruba a rodada com erro, em vez de passar: um filtro
que falha em silêncio é pior que nenhum.

## A janela de 30 dias

A série diária de seguidores do perfil (`follower_count`) existe apenas nos
últimos 30 dias na origem — ela recusa qualquer data anterior. O histórico só
existe porque cada extração é guardada em `raw/ig_followers_*.json`. Ficar mais
de 30 dias sem extrair abre um buraco irrecuperável: foi o que aconteceu com
2026-09-09 a 2026-09-14.
