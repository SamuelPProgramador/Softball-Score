from collections import defaultdict
from typing import Optional
from sqlalchemy.orm import Session
import models

HITS = {"1B", "2B", "3B", "HR"}
# No cuentan como turno oficial (AB): BB, HBP, SB y sacrificios
NO_AB = {"BB", "HBP", "SB", "SF"}

INNINGS_POR_JUEGO = 7   # softball = 7, béisbol = 9 (para calcular la ERA)


def _tasa(num, den):
    return round(num / den, 3) if den else 0

def _bateo_vacio():
    return dict(PA=0, AB=0, H=0, B1=0, B2=0, B3=0, HR=0, BB=0, K=0,
                SB=0, E=0, RBI=0)


def _pitcheo_vacio():
    return dict(outs=0, K=0, BB=0, H=0, R=0, ER=0)


def calcular(db: Session, game_id: Optional[int] = None, season_id: Optional[int] = None):
    q = db.query(models.Play)
    ql = db.query(models.PitchingLine)
    if game_id:
        q = q.filter(models.Play.game_id == game_id)
        ql = ql.filter(models.PitchingLine.game_id == game_id)
    elif season_id:
        q = (q.join(models.Game, models.Game.id == models.Play.game_id)
              .filter(models.Game.season_id == season_id))
        ql = (ql.join(models.Game, models.Game.id == models.PitchingLine.game_id)
                .filter(models.Game.season_id == season_id))

    # ---- Bateo: sale de las jugadas ----
    bateo = defaultdict(_bateo_vacio)
    juegos_bat = defaultdict(set)
    for p in q.all():
        if not p.batter_id:
            continue
        r = p.result
        b = bateo[p.batter_id]
        juegos_bat[p.batter_id].add(p.game_id)
        if r != "SB":
            b["PA"] += 1
        if r not in NO_AB:
            b["AB"] += 1
        if r in HITS:
            b["H"] += 1
            b["HR" if r == "HR" else "B" + r[0]] += 1
        if r in ("BB", "K", "SB", "E"):
            b[r] += 1
        b["RBI"] += p.rbi

    # ---- Pitcheo: sale de las líneas capturadas por pitcher ----
    pitcheo = defaultdict(_pitcheo_vacio)
    juegos_pit = defaultdict(set)
    for l in ql.all():
        pi = pitcheo[l.player_id]
        juegos_pit[l.player_id].add(l.game_id)
        pi["outs"] += l.outs
        pi["K"] += l.k
        pi["BB"] += l.bb
        pi["H"] += l.h
        pi["R"] += l.r
        pi["ER"] += l.er

    nombres = {pl.id: pl.name for pl in db.query(models.Player).all()}

    lista_bateo = []
    for pid, b in bateo.items():
        tb = b["B1"] + 2 * b["B2"] + 3 * b["B3"] + 4 * b["HR"]
        obp = _tasa(b["H"] + b["BB"], b["AB"] + b["BB"])
        slg = _tasa(tb, b["AB"])
        lista_bateo.append({
            "player_id": pid, "name": nombres.get(pid, "?"),
            "G": len(juegos_bat[pid]), **b, "TB": tb,
            "AVG": _tasa(b["H"], b["AB"]), "OBP": obp, "SLG": slg,
            "OPS": round(obp + slg, 3),
        })

    lista_pitcheo = []
    for pid, pi in pitcheo.items():
        ip_dec = pi["outs"] / 3
        era = round(pi["ER"] * INNINGS_POR_JUEGO / ip_dec, 2) if ip_dec else 0
        whip = round((pi["BB"] + pi["H"]) / ip_dec, 2) if ip_dec else 0
        lista_pitcheo.append({
            "player_id": pid, "name": nombres.get(pid, "?"),
            "G": len(juegos_pit[pid]),
            "IP": f"{pi['outs'] // 3}.{pi['outs'] % 3}", **pi,
            "ERA": era, "WHIP": whip,
        })

    return {"bateo": sorted(lista_bateo, key=lambda x: -x["AVG"]),
            "pitcheo": lista_pitcheo}