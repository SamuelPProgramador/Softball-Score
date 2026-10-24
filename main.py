from fastapi import FastAPI, Depends, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from database import Base, engine, get_db
import models, schemas
import stats
from datetime import date
from typing import Optional
import re
import base64
import zlib
import json


Base.metadata.create_all(bind=engine)

app = FastAPI(title="Softball Stats")


# ---------- JUGADORES ----------
FOTO_RE = re.compile(r"^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$")


def _validar_foto(foto):
    if foto and (len(foto) > 300_000 or not FOTO_RE.match(foto)):
        raise HTTPException(400, "Foto no válida o demasiado grande")


def _foto_v(p):
    """Versión de la foto (para que el navegador sepa cuándo cambió)."""
    return zlib.crc32(p.photo.encode()) if p.photo else None


def _jugador_json(p):
    return {"id": p.id, "name": p.name, "number": p.number,
            "position": p.position, "active": p.active, "photo_v": _foto_v(p)}


@app.get("/api/players")
def listar_jugadores(db: Session = Depends(get_db)):
    jugadores = db.query(models.Player).filter_by(active=True).order_by(models.Player.id).all()
    return [_jugador_json(p) for p in jugadores]


@app.get("/api/players/{player_id}/photo")
def foto_jugador(player_id: int, db: Session = Depends(get_db)):
    p = db.get(models.Player, player_id)
    if not p or not p.photo:
        raise HTTPException(404, "Sin foto")
    cabecera, _, datos = p.photo.partition(",")
    tipo = cabecera[5:].split(";")[0]          # ej. image/jpeg
    return Response(content=base64.b64decode(datos), media_type=tipo,
                    headers={"Cache-Control": "public, max-age=86400"})


@app.post("/api/players")
def crear_jugador(data: schemas.PlayerIn, db: Session = Depends(get_db)):
    _validar_foto(data.photo)
    p = models.Player(**data.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return _jugador_json(p)


@app.put("/api/players/{player_id}")
def editar_jugador(player_id: int, data: schemas.PlayerIn, db: Session = Depends(get_db)):
    p = db.get(models.Player, player_id)
    if not p or not p.active:
        raise HTTPException(404, "Jugador no encontrado")
    for campo, valor in data.model_dump(exclude={"photo"}).items():
        setattr(p, campo, valor)
    # La foto solo cambia si viene en la petición (omitida = se conserva)
    if "photo" in data.model_fields_set:
        _validar_foto(data.photo)
        p.photo = data.photo or None
    db.commit()
    db.refresh(p)
    return _jugador_json(p)


@app.delete("/api/players/{player_id}")
def desactivar_jugador(player_id: int, db: Session = Depends(get_db)):
    p = db.get(models.Player, player_id)
    if not p:
        raise HTTPException(404, "Jugador no encontrado")
    p.active = False
    db.commit()
    return {"ok": True}

def season_activa(db: Session):
    s = db.query(models.Season).filter_by(active=True).first()
    if not s:
        s = models.Season(name="Temporada " + str(date.today().year), active=True)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _validar_orden(lineup):
    ids = [s.player_id for s in lineup]
    if len(ids) != len(set(ids)):
        raise HTTPException(400, "Hay un jugador repetido en el orden al bate")


def _guardar_orden(db: Session, game_id: int, lineup):
    db.query(models.LineupSlot).filter_by(game_id=game_id).delete()
    for i, s in enumerate(lineup, start=1):
        db.add(models.LineupSlot(game_id=game_id, batting_order=i,
                                 player_id=s.player_id, position=s.position))


def _orden(db: Session, game_id: int):
    filas = (db.query(models.LineupSlot, models.Player)
               .join(models.Player, models.Player.id == models.LineupSlot.player_id)
               .filter(models.LineupSlot.game_id == game_id)
               .order_by(models.LineupSlot.batting_order).all())
    return [{"batting_order": s.batting_order, "player_id": p.id, "name": p.name,
             "number": p.number, "position": s.position or p.position,
             "photo_v": _foto_v(p)}
            for s, p in filas]


@app.get("/api/seasons/active")
def temporada_activa(db: Session = Depends(get_db)):
    return season_activa(db)


@app.post("/api/games")
def crear_juego(data: schemas.GameIn, db: Session = Depends(get_db)):
    _validar_orden(data.lineup)
    temporada = season_activa(db)
    g = models.Game(date=data.date, time=data.time, opponent=data.opponent,
                    location=data.location, season_id=temporada.id,
                    status="programado")
    db.add(g)
    db.flush()
    _guardar_orden(db, g.id, data.lineup)
    db.commit()
    db.refresh(g)
    return g


@app.get("/api/games/{game_id}")
def ver_juego(game_id: int, db: Session = Depends(get_db)):
    g = db.get(models.Game, game_id)
    if not g:
        raise HTTPException(404, "Juego no encontrado")
    return {"game": g, "lineup": _orden(db, game_id)}


@app.put("/api/games/{game_id}")
def editar_juego(game_id: int, data: schemas.GameIn, db: Session = Depends(get_db)):
    g = db.get(models.Game, game_id)
    if not g:
        raise HTTPException(404, "Juego no encontrado")
    _validar_orden(data.lineup)
    g.date, g.time = data.date, data.time
    g.opponent, g.location = data.opponent, data.location
    # Si el juego ya tiene jugadas, el orden al bate no se toca
    hay_jugadas = db.query(models.Play).filter_by(game_id=game_id).count() > 0
    if not hay_jugadas:
        _guardar_orden(db, game_id, data.lineup)
    db.commit()
    db.refresh(g)
    return g


@app.post("/api/games/{game_id}/start")
def iniciar_juego(game_id: int, db: Session = Depends(get_db)):
    g = db.get(models.Game, game_id)
    if not g:
        raise HTTPException(404, "Juego no encontrado")
    if g.status == "programado":
        tiene_orden = db.query(models.LineupSlot).filter_by(game_id=game_id).count() > 0
        if not tiene_orden:
            raise HTTPException(400, "Arma el orden al bate antes de iniciar el juego")
        g.status = "en_juego"
        db.commit()
    return g


@app.delete("/api/games/{game_id}")
def borrar_juego(game_id: int, db: Session = Depends(get_db)):
    for m in (models.Play, models.PitchingLine, models.LineupSlot):
        db.query(m).filter_by(game_id=game_id).delete()
    db.query(models.Game).filter_by(id=game_id).delete()
    db.commit()
    return {"ok": True}

@app.delete("/api/players/{player_id}")
def desactivar_jugador(player_id: int, db: Session = Depends(get_db)):
    p = db.get(models.Player, player_id)
    if not p:
        raise HTTPException(404, "Jugador no encontrado")
    p.active = False
    db.commit()
    return {"ok": True}


# ---------- JUEGOS ----------
@app.get("/api/games")
def listar_juegos(db: Session = Depends(get_db)):
    return db.query(models.Game).order_by(models.Game.date.desc()).all()


@app.post("/api/games")
def crear_juego(data: schemas.GameIn, db: Session = Depends(get_db)):
    g = models.Game(**data.model_dump())
    db.add(g)
    db.commit()
    db.refresh(g)
    return g

@app.put("/api/players/{player_id}")
def editar_jugador(player_id: int, data: schemas.PlayerIn, db: Session = Depends(get_db)):
    p = db.get(models.Player, player_id)
    if not p or not p.active:
        raise HTTPException(404, "Jugador no encontrado")
    for campo, valor in data.model_dump().items():
        setattr(p, campo, valor)
    db.commit()
    db.refresh(p)
    return p


@app.post("/api/games/{game_id}/finish")
def finalizar_juego(game_id: int, db: Session = Depends(get_db)):
    g = db.get(models.Game, game_id)
    if not g:
        raise HTTPException(404, "Juego no encontrado")
    g.our_score = db.query(func.coalesce(func.sum(models.Play.runs_scored), 0)) \
        .filter(models.Play.game_id == game_id).scalar()
    g.opp_score = db.query(func.coalesce(func.sum(models.PitchingLine.r), 0)) \
        .filter(models.PitchingLine.game_id == game_id).scalar()
    g.status = "finalizado"
    db.commit()
    return g


# ---------- JUGADAS ----------
@app.get("/api/games/{game_id}/plays")
def listar_jugadas(game_id: int, db: Session = Depends(get_db)):
    return db.query(models.Play).filter_by(game_id=game_id).order_by(models.Play.seq).all()


@app.post("/api/games/{game_id}/plays")
def registrar_jugada(game_id: int, data: schemas.PlayIn, db: Session = Depends(get_db)):
    if not db.get(models.Game, game_id):
        raise HTTPException(404, "Juego no encontrado")
    _validar_moves(data.moves)
    ultimo = db.query(func.max(models.Play.seq)).filter_by(game_id=game_id).scalar() or 0
    play = models.Play(game_id=game_id, seq=ultimo + 1, **data.model_dump())
    db.add(play)
    db.commit()
    db.refresh(play)
    return play


@app.delete("/api/plays/{play_id}")
def deshacer_jugada(play_id: int, db: Session = Depends(get_db)):
    play = db.get(models.Play, play_id)
    if not play:
        raise HTTPException(404, "Jugada no encontrada")
    db.delete(play)
    db.commit()
    return {"ok": True}

# ---------- AJUSTE DE CORREDORES ----------
def _validar_moves(txt):
    if txt is None:
        return
    try:
        datos = json.loads(txt)
    except ValueError:
        raise HTTPException(400, "Movimientos no válidos")
    if not isinstance(datos, list) or len(datos) > 8:
        raise HTTPException(400, "Movimientos no válidos")


@app.put("/api/plays/{play_id}")
def ajustar_jugada(play_id: int, data: schemas.PlayAdjustIn, db: Session = Depends(get_db)):
    play = db.get(models.Play, play_id)
    if not play:
        raise HTTPException(404, "Jugada no encontrada")
    ultimo = db.query(func.max(models.Play.seq)).filter_by(game_id=play.game_id).scalar()
    if play.seq != ultimo:
        raise HTTPException(400, "Solo se puede ajustar la última jugada")
    _validar_moves(data.moves)
    play.moves = data.moves
    play.outs_made = data.outs_made
    play.runs_scored = data.runs_scored
    play.rbi = data.rbi
    db.commit()
    return {"ok": True}

# ---------- ESTADÍSTICAS ----------
@app.get("/api/games/{game_id}/stats")
def stats_juego(game_id: int, db: Session = Depends(get_db)):
    return stats.calcular(db, game_id)

# ---------- PITCHEO ----------
@app.get("/api/games/{game_id}/pitching")
def listar_pitcheo(game_id: int, db: Session = Depends(get_db)):
    return db.query(models.PitchingLine).filter_by(game_id=game_id).all()


@app.put("/api/games/{game_id}/pitching/{player_id}")
def guardar_pitcheo(game_id: int, player_id: int, data: schemas.PitchingIn,
                    db: Session = Depends(get_db)):
    linea = db.query(models.PitchingLine).filter_by(
        game_id=game_id, player_id=player_id).first()
    if not linea:
        linea = models.PitchingLine(game_id=game_id, player_id=player_id)
        db.add(linea)
    for campo, valor in data.model_dump().items():
        setattr(linea, campo, valor)
    db.commit()
    return {"ok": True}


@app.get("/api/seasons")
def listar_temporadas(db: Session = Depends(get_db)):
    season_activa(db)
    salida = []
    for s in db.query(models.Season).order_by(models.Season.id.desc()).all():
        juegos = db.query(models.Game).filter_by(season_id=s.id).all()
        fin = [g for g in juegos if g.status == "finalizado"]
        salida.append({
            "id": s.id, "name": s.name, "active": s.active,
            "games": len(juegos), "finished": len(fin),
            "wins": sum(1 for g in fin if (g.our_score or 0) > (g.opp_score or 0)),
            "losses": sum(1 for g in fin if (g.our_score or 0) < (g.opp_score or 0)),
            "ties": sum(1 for g in fin if (g.our_score or 0) == (g.opp_score or 0)),
        })
    return salida


@app.post("/api/seasons")
def crear_temporada(data: schemas.SeasonIn, db: Session = Depends(get_db)):
    nombre = data.name.strip()
    if not nombre:
        raise HTTPException(400, "Escribe el nombre de la temporada")
    db.query(models.Season).update({"active": False})
    s = models.Season(name=nombre, active=True)
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@app.put("/api/seasons/{season_id}")
def renombrar_temporada(season_id: int, data: schemas.SeasonIn, db: Session = Depends(get_db)):
    s = db.get(models.Season, season_id)
    nombre = data.name.strip()
    if not s:
        raise HTTPException(404, "Temporada no encontrada")
    if not nombre:
        raise HTTPException(400, "Escribe el nombre de la temporada")
    s.name = nombre
    db.commit()
    return s


@app.post("/api/seasons/{season_id}/activate")
def activar_temporada(season_id: int, db: Session = Depends(get_db)):
    s = db.get(models.Season, season_id)
    if not s:
        raise HTTPException(404, "Temporada no encontrada")
    db.query(models.Season).update({"active": False})
    s.active = True
    db.commit()
    return s


@app.get("/api/stats/season")
def stats_temporada(season_id: Optional[int] = None, db: Session = Depends(get_db)):
    sid = season_id or season_activa(db).id
    return stats.calcular(db, season_id=sid)


@app.get("/api/players/{player_id}/stats")
def stats_jugador(player_id: int, season_id: Optional[int] = None,
                  db: Session = Depends(get_db)):
    jugador = db.get(models.Player, player_id)
    if not jugador:
        raise HTTPException(404, "Jugador no encontrado")
    sid = season_id or season_activa(db).id

    def de_este(lista):
        return next((x for x in lista if x["player_id"] == player_id), None)

    total = stats.calcular(db, season_id=sid)
    juegos = []
    partidos = (db.query(models.Game).filter(models.Game.season_id == sid)
                  .order_by(models.Game.date, models.Game.time).all())
    for g in partidos:
        s = stats.calcular(db, game_id=g.id)
        b, p = de_este(s["bateo"]), de_este(s["pitcheo"])
        if b or p:
            juegos.append({"game_id": g.id, "date": g.date, "opponent": g.opponent,
                           "bateo": b, "pitcheo": p})
    return {"player": _jugador_json(jugador), "season_id": sid,
            "bateo": de_este(total["bateo"]), "pitcheo": de_este(total["pitcheo"]),
            "juegos": juegos}

# ---------- HOJA DE RESULTADOS ----------
@app.get("/api/games/{game_id}/sheet")
def hoja_resultados(game_id: int, db: Session = Depends(get_db)):
    g = db.get(models.Game, game_id)
    if not g:
        raise HTTPException(404, "Juego no encontrado")
    return {"juego": g, **stats.calcular(db, game_id)}


# ---------- DASHBOARD ----------
MIN_AB_LIDERES = 3     # turnos mínimos para aparecer en líderes de AVG
MIN_OUTS_LIDERES = 3   # outs mínimos (1 entrada) para aparecer en líderes de ERA


def _top(lista, campo, n=3, menor=False):
    base = sorted(lista, key=lambda x: x[campo], reverse=not menor)
    if not menor:
        base = [x for x in base if x[campo] > 0]
    return [{"player_id": x["player_id"], "name": x["name"], "value": x[campo]}
            for x in base[:n]]


def _resultado(g):
    a, b = g.our_score or 0, g.opp_score or 0
    return "G" if a > b else ("P" if a < b else "E")


@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db)):
    temporada = season_activa(db)
    juegos = db.query(models.Game).filter_by(season_id=temporada.id).all()

    def clave(g):
        return (g.date, g.time or "")

    fin = sorted([g for g in juegos if g.status == "finalizado"], key=clave)
    proximos = sorted([g for g in juegos
                       if g.status == "programado" and g.date >= date.today()], key=clave)
    en_juego = [g for g in juegos if g.status == "en_juego"]
    resultados = [_resultado(g) for g in fin]

    s = stats.calcular(db, season_id=temporada.id)
    bateo, pitcheo = s["bateo"], s["pitcheo"]

    return {
        "season": temporada,
        "record": {"played": len(fin), "wins": resultados.count("G"),
                   "losses": resultados.count("P"), "ties": resultados.count("E")},
        "runs": {"for": sum(g.our_score or 0 for g in fin),
                 "against": sum(g.opp_score or 0 for g in fin)},
        "form": resultados[-5:],
        "live": en_juego[0] if en_juego else None,
        "next": proximos[0] if proximos else None,
        "last": fin[-1] if fin else None,
        "leaders": {
            "AVG": _top([b for b in bateo if b["AB"] >= MIN_AB_LIDERES], "AVG"),
            "HR": _top(bateo, "HR"),
            "RBI": _top(bateo, "RBI"),
            "H": _top(bateo, "H"),
            "SB": _top(bateo, "SB"),
            "K": _top(pitcheo, "K"),
            "ERA": _top([p for p in pitcheo if p["outs"] >= MIN_OUTS_LIDERES], "ERA", menor=True),
        },
    }


# ---------- EQUIPO ----------
def equipo_config(db: Session):
    t = db.query(models.TeamSettings).first()
    if not t:
        t = models.TeamSettings(name="Mi Equipo", color="#E0AE45")
        db.add(t)
        db.commit()
        db.refresh(t)
    return t


@app.get("/api/team")
def ver_equipo(db: Session = Depends(get_db)):
    return equipo_config(db)


@app.put("/api/team")
def guardar_equipo(data: schemas.TeamIn, db: Session = Depends(get_db)):
    nombre = data.name.strip()
    if not nombre:
        raise HTTPException(400, "Escribe el nombre del equipo")
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", data.color):
        raise HTTPException(400, "Color no válido")
    if data.logo:
        if len(data.logo) > 400_000:
            raise HTTPException(400, "El logo es demasiado grande")
        if not re.match(r"^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$", data.logo):
            raise HTTPException(400, "Formato de logo no válido")
    t = equipo_config(db)
    t.name, t.color, t.logo = nombre, data.color, (data.logo or None)
    db.commit()
    db.refresh(t)
    return t

# ---------- TORNEOS ----------
def _torneo(db: Session, tid: int):
    t = db.get(models.Tournament, tid)
    if not t:
        raise HTTPException(404, "Torneo no encontrado")
    return t


def _posiciones(equipos, juegos):
    tabla = {e.id: {"team_id": e.id, "name": e.name, "is_mine": e.is_mine,
                    "played": 0, "wins": 0, "losses": 0, "ties": 0, "rf": 0, "ra": 0}
             for e in equipos}
    for g in juegos:
        if g.status != "finalizado":
            continue
        for team_id, a_favor, en_contra in (
                (g.home_team_id, g.home_score, g.away_score),
                (g.away_team_id, g.away_score, g.home_score)):
            fila = tabla.get(team_id)
            if not fila:
                continue
            fila["played"] += 1
            fila["rf"] += a_favor
            fila["ra"] += en_contra
            if a_favor > en_contra:
                fila["wins"] += 1
            elif a_favor < en_contra:
                fila["losses"] += 1
            else:
                fila["ties"] += 1
    filas = list(tabla.values())
    for f in filas:
        f["diff"] = f["rf"] - f["ra"]
        f["pct"] = round((f["wins"] + 0.5 * f["ties"]) / f["played"], 3) if f["played"] else 0
    # Orden: porcentaje, diferencial de carreras, carreras a favor, nombre
    filas.sort(key=lambda f: (-f["pct"], -f["diff"], -f["rf"], f["name"].lower()))
    for i, f in enumerate(filas, start=1):
        f["rank"] = i
    return filas


def _validar_partido(db: Session, tid: int, data):
    if data.home_team_id == data.away_team_id:
        raise HTTPException(400, "Un equipo no puede jugar contra sí mismo")
    for team_id in (data.home_team_id, data.away_team_id):
        existe = db.query(models.TournamentTeam).filter_by(
            tournament_id=tid, team_id=team_id).first()
        if not existe:
            raise HTTPException(400, "Uno de los equipos no está en el torneo")


@app.get("/api/teams")
def listar_equipos(db: Session = Depends(get_db)):
    return [{"id": e.id, "name": e.name, "is_mine": e.is_mine}
            for e in db.query(models.Team).order_by(models.Team.name).all()]


@app.get("/api/tournaments")
def listar_torneos(db: Session = Depends(get_db)):
    salida = []
    for t in db.query(models.Tournament).order_by(models.Tournament.id.desc()).all():
        juegos = db.query(models.TournamentGame).filter_by(tournament_id=t.id).all()
        salida.append({
            "id": t.id, "name": t.name, "start_date": t.start_date,
            "end_date": t.end_date, "location": t.location, "status": t.status,
            "teams": db.query(models.TournamentTeam).filter_by(tournament_id=t.id).count(),
            "games": len(juegos),
            "finished": sum(1 for g in juegos if g.status == "finalizado"),
        })
    return salida


@app.post("/api/tournaments")
def crear_torneo(data: schemas.TournamentIn, db: Session = Depends(get_db)):
    nombre = data.name.strip()
    if not nombre:
        raise HTTPException(400, "Escribe el nombre del torneo")
    t = models.Tournament(name=nombre, start_date=data.start_date, end_date=data.end_date,
                          location=(data.location or "").strip() or None)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@app.put("/api/tournaments/{tid}")
def editar_torneo(tid: int, data: schemas.TournamentIn, db: Session = Depends(get_db)):
    t = _torneo(db, tid)
    nombre = data.name.strip()
    if not nombre:
        raise HTTPException(400, "Escribe el nombre del torneo")
    if data.status not in ("en_curso", "finalizado"):
        raise HTTPException(400, "Estado no válido")
    t.name, t.start_date, t.end_date = nombre, data.start_date, data.end_date
    t.location = (data.location or "").strip() or None
    t.status = data.status
    db.commit()
    return t


@app.delete("/api/tournaments/{tid}")
def borrar_torneo(tid: int, db: Session = Depends(get_db)):
    _torneo(db, tid)
    db.query(models.TournamentGame).filter_by(tournament_id=tid).delete()
    db.query(models.TournamentTeam).filter_by(tournament_id=tid).delete()
    db.query(models.Tournament).filter_by(id=tid).delete()
    db.commit()
    return {"ok": True}


@app.get("/api/tournaments/{tid}")
def ver_torneo(tid: int, db: Session = Depends(get_db)):
    t = _torneo(db, tid)
    equipos = (db.query(models.Team)
                 .join(models.TournamentTeam, models.TournamentTeam.team_id == models.Team.id)
                 .filter(models.TournamentTeam.tournament_id == tid)
                 .order_by(models.Team.name).all())
    juegos = (db.query(models.TournamentGame).filter_by(tournament_id=tid)
                .order_by(models.TournamentGame.date, models.TournamentGame.time,
                          models.TournamentGame.id).all())
    nombres = {e.id: e.name for e in equipos}
    return {
        "tournament": t,
        "teams": [{"id": e.id, "name": e.name, "is_mine": e.is_mine} for e in equipos],
        "games": [{
            "id": g.id, "date": g.date, "time": g.time, "location": g.location,
            "phase": g.phase, "status": g.status,
            "home_team_id": g.home_team_id, "away_team_id": g.away_team_id,
            "home_name": nombres.get(g.home_team_id, "?"),
            "away_name": nombres.get(g.away_team_id, "?"),
            "home_score": g.home_score, "away_score": g.away_score,
        } for g in juegos],
        "standings": _posiciones(equipos, juegos),
    }


@app.post("/api/tournaments/{tid}/teams")
def agregar_equipo_torneo(tid: int, data: schemas.TournamentTeamIn,
                          db: Session = Depends(get_db)):
    _torneo(db, tid)
    nombre = data.name.strip()
    if not nombre:
        raise HTTPException(400, "Escribe el nombre del equipo")
    if data.is_mine:
        equipo = db.query(models.Team).filter_by(is_mine=True).first()
        if equipo:
            equipo.name = nombre
    else:
        equipo = db.query(models.Team).filter(
            func.lower(models.Team.name) == nombre.lower()).first()
    if not equipo:
        equipo = models.Team(name=nombre, is_mine=data.is_mine)
        db.add(equipo)
        db.flush()
    ya = db.query(models.TournamentTeam).filter_by(
        tournament_id=tid, team_id=equipo.id).first()
    if ya:
        raise HTTPException(400, "Ese equipo ya está en el torneo")
    db.add(models.TournamentTeam(tournament_id=tid, team_id=equipo.id))
    db.commit()
    return {"id": equipo.id, "name": equipo.name, "is_mine": equipo.is_mine}


@app.delete("/api/tournaments/{tid}/teams/{team_id}")
def quitar_equipo_torneo(tid: int, team_id: int, db: Session = Depends(get_db)):
    con_juegos = db.query(models.TournamentGame).filter(
        models.TournamentGame.tournament_id == tid,
        or_(models.TournamentGame.home_team_id == team_id,
            models.TournamentGame.away_team_id == team_id)).count()
    if con_juegos:
        raise HTTPException(400, "Ese equipo tiene juegos en el torneo: bórralos primero")
    db.query(models.TournamentTeam).filter_by(tournament_id=tid, team_id=team_id).delete()
    db.commit()
    return {"ok": True}


@app.post("/api/tournaments/{tid}/games")
def crear_juego_torneo(tid: int, data: schemas.TournamentGameIn,
                       db: Session = Depends(get_db)):
    _torneo(db, tid)
    _validar_partido(db, tid, data)
    g = models.TournamentGame(
        tournament_id=tid, home_team_id=data.home_team_id, away_team_id=data.away_team_id,
        date=data.date, time=data.time or None,
        location=(data.location or "").strip() or None,
        phase=(data.phase or "").strip() or None)
    db.add(g)
    db.commit()
    db.refresh(g)
    return {"id": g.id}


@app.post("/api/tournament-games/{gid}/result")
def resultado_juego_torneo(gid: int, data: schemas.TournamentResultIn,
                           db: Session = Depends(get_db)):
    g = db.get(models.TournamentGame, gid)
    if not g:
        raise HTTPException(404, "Juego no encontrado")
    if data.home_score < 0 or data.away_score < 0:
        raise HTTPException(400, "Las carreras no pueden ser negativas")
    g.home_score, g.away_score, g.status = data.home_score, data.away_score, "finalizado"
    db.commit()
    return {"ok": True}


@app.post("/api/tournament-games/{gid}/reopen")
def reabrir_juego_torneo(gid: int, db: Session = Depends(get_db)):
    g = db.get(models.TournamentGame, gid)
    if not g:
        raise HTTPException(404, "Juego no encontrado")
    g.home_score, g.away_score, g.status = None, None, "programado"
    db.commit()
    return {"ok": True}


@app.delete("/api/tournament-games/{gid}")
def borrar_juego_torneo(gid: int, db: Session = Depends(get_db)):
    db.query(models.TournamentGame).filter_by(id=gid).delete()
    db.commit()
    return {"ok": True}
# ---------- FRONTEND ----------
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def inicio():
    # Temporal: cuando exista el Dashboard, "/" apuntará allá
    return RedirectResponse("/static/dashboard.html")
