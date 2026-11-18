"""Baixa os dados da conta de Honkai: Star Rail pela HoYoLAB e salva criptografado.

Variáveis de ambiente (cadastradas como Secrets no GitHub):
  HOYOLAB_COOKIES  -> "ltuid_v2=...; ltoken_v2=...; ltmid_v2=..."
  SITE_PASSWORD    -> senha usada para abrir o site
  HSR_UID          -> UID do jogo (opcional, padrão abaixo)

Saída: site/data.enc.json (AES-256-GCM, chave derivada com PBKDF2-SHA256).
Use --plain para gerar também site/data.json SEM criptografia (só para testes locais).
"""
import asyncio
import base64
import json
import os
import sys
import time
from pathlib import Path

import genshin
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data.enc.json"
ITERATIONS = 600_000
PATHS = {1: "Destruction", 2: "The Hunt", 3: "Erudition", 4: "Harmony", 5: "Nihility",
         6: "Preservation", 7: "Abundance", 8: "Remembrance", 9: "Elation"}


def prop(p):
    info = getattr(p, "info", None)
    return {
        "type": p.property_type,
        "name": info.property_name_relic if info else "",
        "value": p.value,
        "rolls": getattr(p, "times", 0),
        "good": bool(getattr(p, "recommended", False) or getattr(p, "preferred", False)),
    }


def relic(r):
    return {"id": r.id, "pos": r.pos, "rarity": r.rarity, "level": r.level, "name": r.name,
            "main": prop(r.main_property), "subs": [prop(s) for s in r.properties]}


def character(c, rec):
    path = getattr(c.path, "value", c.path)
    return {
        "id": c.id, "name": c.name, "element": c.element, "rarity": c.rarity, "level": c.level,
        "eidolon": c.rank, "path": PATHS.get(path, str(path)), "icon": c.icon,
        "lightcone": None if not c.equip else {
            "id": c.equip.id, "name": c.equip.name, "level": c.equip.level,
            "superimposition": c.equip.rank, "rarity": c.equip.rarity, "icon": c.equip.icon},
        "relics": [relic(r) for r in c.relics],
        "ornaments": [relic(r) for r in c.ornaments],
        "stats": [{"type": p.property_type, "name": p.info.property_name_filter or p.info.name,
                   "final": p.final, "good": bool(p.recommended or p.preferred)} for p in c.properties],
        "skills": [{"id": s.point_id, "type": s.point_type, "anchor": s.anchor, "level": s.level,
                    "active": s.is_activated, "name": (s.skill_stages[0].name if s.skill_stages else "")}
                   for s in c.skills],
        "recommended_stats": list(rec.recommend_relic_properties) if rec else [],
    }


async def safe(coro):
    try:
        return await coro
    except Exception as e:  # um modo de jogo falhar não deve derrubar o resto
        print("aviso:", type(e).__name__, e, file=sys.stderr)
        return None


def summary(ch):
    if not ch:
        return None
    return {"name": getattr(ch, "name", ""), "stars": ch.total_stars, "max_floor": ch.max_floor,
            "battles": ch.total_battles, "has_data": ch.has_data}


async def fetch():
    cookies = os.environ["HOYOLAB_COOKIES"]
    uid = int(os.environ.get("HSR_UID") or 624603379)
    client = genshin.Client(cookies, game=genshin.Game.STARRAIL, lang="en-us")
    chars = await client.get_starrail_characters(uid, lang="en-us")
    user = await safe(client.get_starrail_user(uid))
    moc, pf, apc = await asyncio.gather(safe(client.get_starrail_challenge(uid)),
                                        safe(client.get_starrail_pure_fiction(uid)),
                                        safe(client.get_starrail_apc_shadow(uid)))
    rec = chars.recommend_property
    return {
        "fetched_at": int(time.time()),
        "uid": uid,
        "player": None if not user else {"nickname": user.info.nickname, "level": user.info.level},
        "characters": [character(c, rec.get(str(c.id))) for c in chars.avatar_list],
        "endgame": {"moc": summary(moc), "pf": summary(pf), "as": summary(apc)},
    }


def encrypt(data: dict, password: str) -> dict:
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS).derive(password.encode())
    ct = AESGCM(key).encrypt(iv, json.dumps(data, ensure_ascii=False).encode(), None)
    b64 = lambda b: base64.b64encode(b).decode()
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITERATIONS, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}


def main():
    password = os.environ.get("SITE_PASSWORD")
    if not password:
        sys.exit("SITE_PASSWORD não definido")
    data = json.loads(Path(sys.argv[sys.argv.index("--from") + 1]).read_text()) if "--from" in sys.argv \
        else asyncio.run(fetch())
    OUT.write_text(json.dumps(encrypt(data, password)))
    if "--plain" in sys.argv:
        (ROOT / "site" / "data.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
    print(f"ok: {len(data['characters'])} personagens -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
