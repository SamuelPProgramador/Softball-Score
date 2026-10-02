from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, Date, UniqueConstraint
from database import Base


class Player(Base):
    __tablename__ = "players"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    number = Column(Integer)
    position = Column(String)
    active = Column(Boolean, default=True)


class Game(Base):
    __tablename__ = "games"
    id = Column(Integer, primary_key=True)
    date = Column(Date, nullable=False)
    opponent = Column(String, nullable=False)
    location = Column(String)
    our_score = Column(Integer, default=0)
    opp_score = Column(Integer, default=0)
    status = Column(String, default="programado")  # programado / en_juego / finalizado
    season_id = Column(Integer, ForeignKey("seasons.id"))
    time = Column(String)


class Play(Base):
    """Una jugada del scorebook. Todas las estadísticas salen de aquí."""
    __tablename__ = "plays"
    id = Column(Integer, primary_key=True)
    game_id = Column(Integer, ForeignKey("games.id"), nullable=False)
    seq = Column(Integer, nullable=False)        # orden dentro del juego
    inning = Column(Integer, nullable=False)
    batter_id = Column(Integer, ForeignKey("players.id"))
    pitcher_id = Column(Integer, ForeignKey("players.id"))
    result = Column(String, nullable=False)      # 1B, 2B, 3B, HR, BB, K, OUT, SB, E...
    rbi = Column(Integer, default=0)
    outs_made = Column(Integer, default=0)       # para calcular IP
    runs_scored = Column(Integer, default=0)
    earned_runs = Column(Integer, default=0)

class PitchingLine(Base):
    """Línea de pitcheo de un pitcher en un juego (se guarda tal cual la captura el anotador)."""
    __tablename__ = "pitching_lines"
    __table_args__ = (UniqueConstraint("game_id", "player_id"),)
    id = Column(Integer, primary_key=True)
    game_id = Column(Integer, ForeignKey("games.id"), nullable=False)
    player_id = Column(Integer, ForeignKey("players.id"), nullable=False)
    outs = Column(Integer, default=0)   # outs lanzados (para IP)
    k = Column(Integer, default=0)
    bb = Column(Integer, default=0)
    h = Column(Integer, default=0)
    r = Column(Integer, default=0)
    er = Column(Integer, default=0)



class Season(Base):
    __tablename__ = "seasons"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    active = Column(Boolean, default=True)


class LineupSlot(Base):
    """Orden al bate de un juego."""
    __tablename__ = "lineup_slots"
    __table_args__ = (UniqueConstraint("game_id", "batting_order"),)
    id = Column(Integer, primary_key=True)
    game_id = Column(Integer, ForeignKey("games.id"), nullable=False)
    batting_order = Column(Integer, nullable=False)   # 1, 2, 3...
    player_id = Column(Integer, ForeignKey("players.id"), nullable=False)
    position = Column(String)                         # posición que juega ese día