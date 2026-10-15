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

Seis chamadas ao MCP do Windsor.ai (connectors `facebook` e `instagram`),
gravadas em `raw/` com os nomes que o ETL espera, e depois:

```bash
python3 scripts/etl/build_dataset.py
cd site && npx wrangler pages deploy . --project-name=taina-psiquiatra --branch=main --commit-dirty=true
```

O MCP do Meta Ads não participa: perdeu acesso à conta 938787845322238 em
2026-09-10 e o Windsor entrega os mesmos campos.

## A janela de 30 dias

A série diária de seguidores do perfil (`follower_count`) existe apenas nos
últimos 30 dias na origem — ela recusa qualquer data anterior. O histórico só
existe porque cada extração é guardada em `raw/ig_followers_*.json`. Ficar mais
de 30 dias sem extrair abre um buraco irrecuperável: foi o que aconteceu com
2026-09-09 a 2026-09-14.
