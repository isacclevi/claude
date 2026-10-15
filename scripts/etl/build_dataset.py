#!/usr/bin/env python3
"""Monta public/data/dataset.json a partir das respostas cruas em raw/.

Reconstruído em 2026-10-15: o container anterior foi reciclado antes de o push
passar, e o ETL original se perdeu. O formato de saída foi recuperado do
dataset.json que estava publicado — o dashboard no ar continua lendo o mesmo
arquivo, então o contrato é ele.

Fonte: Windsor.ai, connectors `facebook` (conta de anúncios) e `instagram`
(perfil). O MCP do Meta não participa mais: perdeu acesso à conta em 2026-09-10.
"""

import json
import re
import subprocess
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
RAW = RAIZ / "raw"
OUT_DATA = RAIZ / "site" / "data"
OUT_IMG = RAIZ / "site" / "creatives"
CONFIG = json.loads((Path(__file__).parent / "config.json").read_text(encoding="utf-8"))

NOTES = {
    "followers": "Novos seguidores do perfil no Instagram, conforme o Meta Business. Inclui crescimento orgânico e pago.",
    "adFollowers": "Seguidores atribuídos diretamente aos anúncios (instagram_profile_follow_v2, Meta Ads).",
    "followersCoverage": "A origem entrega a série de seguidores do perfil apenas nos últimos 30 dias; dias fora dessa janela ficam sem dado.",
    "reach": "Soma do alcance diário. Pessoas alcançadas em dias diferentes podem se repetir.",
    "postEngagement": "Engajamento da publicação: curtidas, comentários, salvamentos e compartilhamentos do post no Instagram — não do anúncio.",
}

# O Windsor nomeia os campos de um jeito e o Meta de outro. Os nomes internos
# são os do Meta, por serem os primeiros que existiram aqui.
WINDSOR = {
    "date": "date_start",
    "ad_name": "name",
    "campaign": "campaign_name",
    "ad_created_time": "created_time",
    "campaign_objective": "objective",
    "campaign_start_time": "start_time",
    "campaign_stop_time": "stop_time",
    "instagram_profile_follow": "instagram_profile_follow_v2",
    "actions_post_engagement": "post_engagement",
}


def normalizar(row):
    """Só mexe em linha de campanha ou anúncio. A série de seguidores do perfil
    também usa 'date' — renomear ali apagaria a série inteira."""
    if "date" not in row or "date_start" in row:
        return row
    if not (row.get("ad_id") or row.get("campaign_id")):
        return row
    out = dict(row)
    for de, para in WINDSOR.items():
        if de in out:
            out[para] = out.pop(de)
    if out.get("ad_id"):
        out["id"] = out["ad_id"]
    else:
        out["id"] = out.get("campaign_id")
        out["name"] = out.get("campaign_name")
        if "campaign_effective_status" in out:
            out["effective_status"] = out.pop("campaign_effective_status")
    if out.get("campaign_daily_budget") not in (None, ""):
        # O Windsor devolve orçamento em centavos.
        out["daily_budget"] = float(out.pop("campaign_daily_budget")) / 100
    return out


def load(pattern):
    """Lê todos os arquivos que casam com o padrão e devolve as linhas juntas.

    A resposta traz a lista sob uma chave só dela, acompanhada de metadados
    ("status", "total_rows"). Fica com a primeira chave que dá lista."""
    rows = []
    for path in sorted(RAW.glob(pattern)):
        payload = json.loads(path.read_text(encoding="utf-8"))
        for value in payload.values():
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                except json.JSONDecodeError:
                    continue
            if isinstance(value, list):
                rows += [normalizar(r) for r in value if isinstance(r, dict)]
                break
    return rows


def money(value):
    """'R$1.234,56 BRL' -> 1234.56, e 1234.56 -> 1234.56.

    O Windsor manda número; sem o atalho abaixo, 20.17 viraria 2017, porque a
    limpeza de separador de milhar apaga o ponto decimal."""
    if value in (None, ""):
        return 0.0
    if isinstance(value, (int, float)):
        return round(float(value), 2)
    text = str(value).replace(" ", " ").replace("R$", "").replace("BRL", "").strip()
    text = text.replace(".", "").replace(",", ".")
    try:
        return round(float(text), 2)
    except ValueError:
        return 0.0


def num(value):
    if value in (None, ""):
        return 0
    try:
        return int(float(str(value).replace(",", ".")))
    except ValueError:
        return 0


def metrics(row):
    return {
        "spend": money(row.get("amount_spent") or row.get("spend")),
        "impressions": num(row.get("impressions")),
        "reach": num(row.get("reach")),
        "clicks": num(row.get("clicks")),
        "follows": num(row.get("instagram_profile_follow_v2")),
        "engagement": num(row.get("post_engagement")),
    }


def day(value):
    return (value or "")[:10] or None


def norm(text):
    """Normaliza legenda para comparação: sem acento, sem caixa, sem espaço duplo."""
    if not text:
        return ""
    t = unicodedata.normalize("NFKD", str(text))
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", t).strip().lower()


def dedup(rows, key):
    """Último vence: extração mais recente corrige a anterior."""
    return list({key(r): r for r in rows}.values())


def build_series(rows, out_field):
    series = [{"date": r["date_start"], out_field: r["id"], **metrics(r)}
              for r in rows if r.get("date_start") and r.get("id")]
    series = dedup(series, lambda r: (r["date"], r[out_field]))
    series.sort(key=lambda r: (r["date"], r[out_field]))
    return series


def latest_by_id(rows):
    """Atributos de cada entidade, tomando a linha mais recente em que apareceu."""
    out = {}
    for row in sorted(rows, key=lambda r: r.get("date_start") or ""):
        if row.get("id"):
            out[row["id"]] = row
    return out


def formato(creative):
    tipo = creative.get("object_type") or creative.get("effective_instagram_media__media_type")
    if tipo == "VIDEO":
        return "Vídeo"
    return "Imagem" if tipo else "—"


def baixar(url, destino):
    """urllib primeiro; curl como reserva porque em ambiente atrás de proxy o
    urllib leva 403 onde o curl, já configurado, passa."""
    if destino.exists() and destino.stat().st_size > 0:
        return True
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            dados = r.read()
        if len(dados) >= 512:
            destino.write_bytes(dados)
            return True
    except Exception:
        pass
    try:
        subprocess.run(["curl", "-sfS", "-A", "Mozilla/5.0", url, "-o", str(destino)],
                       check=True, timeout=60)
        return destino.exists() and destino.stat().st_size >= 512
    except Exception:
        destino.unlink(missing_ok=True)
        return False


def fetch_thumb(creative_id, creative, post):
    """Imagem do criativo: prefere a mídia do Instagram (alta resolução). Sem
    publicação vinculada resta a miniatura do anúncio, marcada como "low" para
    o cartão não esticar imagem pixelada."""
    if not creative_id:
        return None, None
    destino = OUT_IMG / f"{creative_id}.jpg"
    if destino.exists() and destino.stat().st_size > 0:
        # Já veio do site publicado ou de uma rodada anterior.
        return f"/creatives/{creative_id}.jpg", "high" if post else "low"
    candidatos = [
        ((post or {}).get("media_thumbnail_url"), "high"),
        ((post or {}).get("media_url") if (post or {}).get("media_type") != "VIDEO" else None, "high"),
        (creative.get("thumbnail_url"), "low"),
        (creative.get("image_url"), "low"),
    ]
    for url, qualidade in candidatos:
        if url and baixar(url, destino):
            return f"/creatives/{creative_id}.jpg", qualidade
    return None, None


def main():
    OUT_DATA.mkdir(parents=True, exist_ok=True)
    OUT_IMG.mkdir(parents=True, exist_ok=True)

    campaign_rows = load("campaign_daily*.json")
    ad_rows = load("ad_daily*.json")

    campaign_daily = build_series(campaign_rows, "campaignId")
    ad_daily = build_series(ad_rows, "adId")

    profile_rows = load("ig_followers*.json")
    profile_daily = dedup(
        [
            {
                "date": r["date"],
                "follows": num(r.get("follower_count")),
                "reach": num(r.get("reach")),
                "views": num(r.get("views")),
                "interactions": num(r.get("total_interactions")),
                # Métricas do perfil. Só existem nas extrações a partir de
                # 2026-10-15: as anteriores não pediam esses campos, e a origem
                # não devolve mais de 30 dias para trás. Dia sem o dado fica
                # None, e a interface mostra "—" em vez de fingir zero.
                "likes": num(r["likes"]) if r.get("likes") is not None else None,
                "comments": num(r["comments"]) if r.get("comments") is not None else None,
                "shares": num(r["shares"]) if r.get("shares") is not None else None,
                "saves": num(r["saves"]) if r.get("saves") is not None else None,
                "engaged": num(r["accounts_engaged"]) if r.get("accounts_engaged") is not None else None,
            }
            for r in profile_rows
            if r.get("date")
        ],
        lambda r: r["date"],
    )
    profile_daily.sort(key=lambda r: r["date"])

    snapshots = sorted(load("ig_profile*.json"), key=lambda r: r.get("date") or "")
    latest_profile = snapshots[-1] if snapshots else {}

    # conta = soma das campanhas no dia (mesma fonte, um nível acima)
    by_date = {}
    for row in campaign_daily:
        acc = by_date.setdefault(row["date"], {"date": row["date"], "spend": 0.0, "impressions": 0,
                                               "reach": 0, "clicks": 0, "follows": 0, "engagement": 0})
        for field in ("spend", "impressions", "reach", "clicks", "follows", "engagement"):
            acc[field] += row[field]
    account_daily = [{**v, "spend": round(v["spend"], 2)} for v in sorted(by_date.values(), key=lambda r: r["date"])]

    campaigns = [
        {
            "id": cid,
            "name": r.get("name") or f"Campanha {cid}",
            "objective": r.get("objective") or "—",
            "status": r.get("effective_status") or "COMPLETED",
            "dailyBudget": money(r["daily_budget"]) if r.get("daily_budget") else None,
            "startTime": day(r.get("start_time")),
            "stopTime": day(r.get("stop_time")),
        }
        for cid, r in latest_by_id(campaign_rows).items()
    ]

    # Meta identifica o criativo em "id"; Windsor, em "creative_id".
    creatives = {}
    for c in load("creatives*.json"):
        cid = c.get("id") or c.get("creative_id")
        if not cid:
            continue
        creatives.setdefault(cid, {}).update({k: v for k, v in c.items() if v not in (None, "")})

    captions = [(norm(m.get("media_caption")), m) for m in load("ig_media*.json") if m.get("media_caption")]

    def match_post(body):
        """Vínculo só quando os 80 primeiros caracteres da legenda batem
        exatamente e apontam para uma única publicação.

        O Windsor traz "instagram_permalink_url" no anúncio, e seria o vínculo
        ideal — mas os códigos que ele devolve não batem com nenhuma publicação
        do perfil (interseção zero em 58 anúncios, conferido em 2026-09-10).
        Apontam para outro lugar, então o vínculo sai da legenda, que é
        conferível contra a publicação real."""
        text = norm(body)
        if len(text) < 80:
            return None
        key = text[:80]
        hits = {m["media_permalink"]: m for caption, m in captions if caption.startswith(key)}
        return list(hits.values())[0] if len(hits) == 1 else None

    ads = []
    for ad_id, r in latest_by_id(ad_rows).items():
        creative_id = r.get("creative_id") or ""
        creative = creatives.get(creative_id, {})
        post = match_post(creative.get("body"))
        thumb, quality = fetch_thumb(creative_id, creative, post)
        # Métricas da publicação orgânica, não do anúncio: é por elas que os
        # criativos são ranqueados.
        post_metrics = (
            {
                "engagement": num(post.get("media_engagement")),
                "reach": num(post.get("media_reach")),
                "views": num(post.get("media_views")),
                "likes": num(post.get("media_like_count")),
                "comments": num(post.get("media_comments_count")),
                "saved": num(post.get("media_saved")),
                "shares": num(post.get("media_shares")),
                "publishedAt": day(post.get("timestamp")),
            }
            if post
            else None
        )
        ads.append({
            "id": ad_id,
            "name": r.get("name") or f"Anúncio {ad_id}",
            "campaignId": r.get("campaign_id") or "",
            "campaignName": r.get("campaign_name") or "",
            "adsetName": r.get("adset_name") or "—",
            "status": r.get("effective_status") or "COMPLETED",
            "createdTime": day(r.get("created_time")),
            "creativeId": creative_id,
            "format": formato(creative),
            "copy": (creative.get("body") or "").strip(),
            "thumb": thumb,
            "thumbQuality": quality,
            "instagramUrl": post["media_permalink"] if post else None,
            "instagramType": post.get("media_type") if post else None,
            "post": post_metrics,
        })

    linked = sum(1 for a in ads if a["instagramUrl"])
    dates = [r["date"] for r in account_daily]
    now = datetime.now(timezone(timedelta(hours=-3)))

    dataset = {
        "meta": {
            "client": CONFIG["client"],
            "account": CONFIG["account"],
            "currency": CONFIG["account"]["currency"],
            "source": CONFIG["source"],
            "range": {"start": dates[0], "end": dates[-1]},
            "extractedAt": now.isoformat(timespec="seconds"),
            "notes": {
                **NOTES,
                "instagramLink": f"{linked} de {len(ads)} criativos têm publicação vinculada por correspondência exata de legenda.",
            },
        },
        "profile": {
            "followersTotal": num(latest_profile.get("followers_count")),
            "snapshotDate": day(latest_profile.get("date")),
            "username": latest_profile.get("username") or CONFIG["account"]["instagram"]["username"],
            "coverage": (
                {"start": profile_daily[0]["date"], "end": profile_daily[-1]["date"]} if profile_daily else None
            ),
        },
        "campaigns": campaigns,
        "ads": ads,
        "daily": {
            "account": account_daily,
            "campaign": campaign_daily,
            "ad": ad_daily,
            "profile": profile_daily,
        },
    }

    compacto = json.dumps(dataset, ensure_ascii=False, separators=(",", ":"))
    (OUT_DATA / "dataset.json").write_text(compacto, encoding="utf-8")
    # data.js é o que a interface lê: sem fetch, sem CORS, sem estado de
    # carregamento. Mesmo padrão dos B.I. do Depot e do Cafofo.
    (RAIZ / "site" / "data.js").write_text(
        f"/* Gerado por scripts/etl/build_dataset.py em {now.isoformat(timespec='seconds')} — NÃO editar à mão.\n"
        f"   Fonte: Windsor.ai · facebook {CONFIG['account']['id']} · instagram {CONFIG['account']['instagram']['id']} */\n"
        f"window.TAINA_DATA = {compacto}\n",
        encoding="utf-8",
    )
    coverage = f"{profile_daily[0]['date']} a {profile_daily[-1]['date']}" if profile_daily else "sem dados"
    print(f"dias {len(account_daily)} ({dates[0]} a {dates[-1]}) | campanhas {len(campaigns)} | "
          f"anúncios {len(ads)} | posts vinculados {linked}")
    print(f"perfil: {num(latest_profile.get('followers_count'))} seguidores hoje | "
          f"série do perfil: {len(profile_daily)} dias ({coverage}) | "
          f"novos no perfil: {sum(r['follows'] for r in profile_daily)}")
    print(f"gasto total R$ {sum(r['spend'] for r in account_daily):.2f} | "
          f"seguidores {sum(r['follows'] for r in account_daily)}")
    faltando = [a["id"] for a in ads if not a["thumb"]]
    if faltando:
        print(f"sem miniatura: {len(faltando)} criativos")


if __name__ == "__main__":
    main()
