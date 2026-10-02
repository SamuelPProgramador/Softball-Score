from pydantic import BaseModel
from datetime import date
from typing import Optional, List


class PlayerIn(BaseModel):
    name: str
    number: Optional[int] = None
    position: Optional[str] = None


class LineupIn(BaseModel):
    player_id: int
    position: Optional[str] = None


class GameIn(BaseModel):
    date: date
    time: Optional[str] = None
    opponent: str
    location: Optional[str] = None
    lineup: List[LineupIn] = []

class PlayIn(BaseModel):
    inning: int
    batter_id: Optional[int] = None
    pitcher_id: Optional[int] = None
    result: str            # 1B, 2B, 3B, HR, BB, HBP, K, OUT, SB, E
    rbi: int = 0
    outs_made: int = 0
    runs_scored: int = 0
    earned_runs: int = 0


class PitchingIn(BaseModel):
    outs: int = 0
    k: int = 0
    bb: int = 0
    h: int = 0
    r: int = 0
    er: int = 0


class SeasonIn(BaseModel):
    name: str


class TeamIn(BaseModel):
    name: str
    color: str = "#E0AE45"
    logo: Optional[str] = None

