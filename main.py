from fastapi import FastAPI, Depends, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import Base, engine, get_db
import models, schemas
import stats
from datetime import date
from typing import Optional

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Softball Stats")


# ---------- JUGADORES ----------
@app.get("/api/players")
def listar_jugadores(db: Session = Depends(get_db)):
    return db.query(models.Player).filter_by(active=True).order_by(models.Player.id).all()


@app.post("/api/players")
def crear_jugador(data: schemas.PlayerIn, db: Session = Depends(get_db)):
    p = models.Player(**data.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


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
             "number": p.number, "position": s.position or p.position}
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

    return {"player": jugador, "season_id": sid,
            "bateo": de_este(total["bateo"]), "pitcheo": de_este(total["pitcheo"]),
            "juegos": juegos}

# ---------- HOJA DE RESULTADOS ----------
@app.get("/api/games/{game_id}/sheet")
def hoja_resultados(game_id: int, db: Session = Depends(get_db)):
    g = db.get(models.Game, game_id)
    if not g:
        raise HTTPException(404, "Juego no encontrado")
    return {"juego": g, **stats.calcular(db, game_id)}


# ---------- FRONTEND ----------
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def inicio():
    # Temporal: cuando exista el Dashboard, "/" apuntará allá
    return RedirectResponse("/static/jugadores.html")
