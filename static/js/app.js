
(function () {
  // Jugadores de ejemplo: solo se crean si la base de datos está vacía

  var roster = [];      // orden al bate de este juego
  var pitchers = [];    // todo el plantel (para elegir pitcher)
  var readOnly = false; // true si el juego ya está finalizado
  var stats = {};
  var pitching = {};
  var gameId = null;
  var playIds = [];   // ids de las jugadas guardadas, en orden (para deshacer)

  var state = {
    batterIndex: 0,
    inning: 1,
    ourScore: 0,
    theirScore: 0,
    outs: 0,
    bases: [null, null, null],
    history: [],
    currentPitcherId: null
  };


  function fmtAvg(s) {
    if (s.ab === 0) return ".000";
    var v = s.h / s.ab;
    return v.toFixed(3).replace(/^0/, "");
  }

  function snapshot() {
    return JSON.parse(JSON.stringify({ stats: stats, pitching: pitching, state: state }));
  }

  function pushHistory() {
    state.history.push(snapshot());
    if (state.history.length > 30) state.history.shift();
  }

  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._tm);
    toast._tm = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  function currentBatter() { return roster[state.batterIndex]; }
  var lastPlayCtx = null;   // contexto de la última jugada (para ajustarla)
  var rosterOriginal = [];  // orden al bate con el que empezó el juego
  var seen = [];            // todos los que han bateado o corrido (original + sustitutos)
  var replacedIds = {};     // jugadores que ya salieron por un emergente

  function nameOf(id) {
    var p = roster.find(function (x) { return x.id === id; }) ||
            pitchers.find(function (x) { return x.id === id; });
    return p ? p.name : "?";
  }

  // ---------- Movimiento de corredores ----------
  // Un movimiento es { p: id del jugador, f: base de origen (0 = bateador, 1-3), t: destino }
  // t: 0 = out, 1-3 = base, 4 = anotó
  function defaultMoves(result, batterId) {
    var b = state.bases;
    var mv = [];
    function advance(n) {
      for (var i = 2; i >= 0; i--) {
        if (b[i] !== null) mv.push({ p: b[i], f: i + 1, t: Math.min(i + 1 + n, 4) });
      }
    }
    if (result === "1B") { advance(1); mv.push({ p: batterId, f: 0, t: 1 }); }
    else if (result === "2B") { advance(2); mv.push({ p: batterId, f: 0, t: 2 }); }
    else if (result === "3B") { advance(3); mv.push({ p: batterId, f: 0, t: 3 }); }
    else if (result === "HR") { advance(4); mv.push({ p: batterId, f: 0, t: 4 }); }
    else if (result === "BB" || result === "E") {
      if (b[0] !== null) {
        if (b[1] !== null) {
          if (b[2] !== null) mv.push({ p: b[2], f: 3, t: 4 });
          mv.push({ p: b[1], f: 2, t: 3 });
        }
        mv.push({ p: b[0], f: 1, t: 2 });
      }
      mv.push({ p: batterId, f: 0, t: 1 });
    }
    else if (result === "SF") {
      if (b[2] !== null) mv.push({ p: b[2], f: 3, t: 4 });
      mv.push({ p: batterId, f: 0, t: 0 });
    }
    else if (result === "SH") { advance(1); mv.push({ p: batterId, f: 0, t: 0 }); }
    else { mv.push({ p: batterId, f: 0, t: 0 }); }   // K y OUT
    return mv;
  }

  function applyMoves(moves) {
    var nb = state.bases.slice();
    var runs = 0, outs = 0;
    moves.forEach(function (m) { if (m.f >= 1) nb[m.f - 1] = null; });
    moves.forEach(function (m) {
      if (m.t >= 1 && m.t <= 3) nb[m.t - 1] = m.p;
      else if (m.t === 4) { runs++; if (stats[m.p]) stats[m.p].r++; }
      else if (m.t === 0) outs++;
    });
    state.bases = nb;
    state.outs += outs;
    return { runs: runs, outs: outs };
  }

  function sacrificeError(result) {
    var b = state.bases;
    if (result === "SF") {
      if (!b[2]) return "El fly de sacrificio necesita un corredor en 3ra";
      if (state.outs >= 2) return "Con 2 outs no cuenta como sacrificio: usa Out";
    }
    if (result === "SH") {
      if (!(b[0] || b[1] || b[2])) return "El toque de sacrificio necesita corredores en base";
      if (state.outs >= 2) return "Con 2 outs no cuenta como sacrificio: usa Out";
    }
    return null;
  }

  // ---------- Conexión con el servidor ----------
  async function api(method, url, body) {
    var opts = { method: method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    var res = await fetch(url, opts);
    if (!res.ok) throw new Error(method + " " + url + " -> " + res.status);
    return res.json();
  }

  // Cola: las peticiones se envían una tras otra, en el orden en que se tocan los botones
  var queue = Promise.resolve();
  function enqueue(fn) {
    queue = queue.then(fn).catch(function (e) {
      console.error(e);
      toast("⚠ Error de conexión: recarga la página");
    });
    return queue;
  }

  function resetLocal() {
    roster = rosterOriginal.slice();
    seen = roster.slice();
    replacedIds = {};
    stats = {};
    pitching = {};
    roster.forEach(function (p) {
      stats[p.id] = { ab: 0, h: 0, "1b": 0, "2b": 0, "3b": 0, hr: 0, bb: 0, k: 0, rbi: 0, r: 0, sf: 0, sh: 0 };
    });
    pitchers.forEach(function (p) {
      pitching[p.id] = { outs: 0, k: 0, bb: 0, h: 0, r: 0, er: 0 };
    });
    state.batterIndex = 0;
    state.inning = 1;
    state.ourScore = 0;
    state.theirScore = 0;
    state.outs = 0;
    state.bases = [null, null, null];
    playIds = [];
    lastPlayCtx = null;
  }

  // Aplica una jugada al estado local (sin tocar el servidor).
  // movesOverride: movimientos guardados; si no hay, se usa el avance proyectado.
  function applyResult(result, movesOverride) {
    var batter = currentBatter();
    var s = stats[batter.id];
    var inning = state.inning;
    var outsBefore = state.outs;
    var basesBefore = state.bases.slice();
    var moves = movesOverride || defaultMoves(result, batter.id);

    if (result === "1B") { s.ab++; s.h++; s["1b"]++; }
    else if (result === "2B") { s.ab++; s.h++; s["2b"]++; }
    else if (result === "3B") { s.ab++; s.h++; s["3b"]++; }
    else if (result === "HR") { s.ab++; s.h++; s.hr++; }
    else if (result === "BB") { s.bb++; }
    else if (result === "E") { s.ab++; }
    else if (result === "K") { s.ab++; s.k++; }
    else if (result === "OUT") { s.ab++; }
    else if (result === "SF") { s.sf++; }
    else if (result === "SH") { s.sh++; }

    var res = applyMoves(moves);
    if (res.runs > 0) { s.rbi += res.runs; state.ourScore += res.runs; }
    state.batterIndex = (state.batterIndex + 1) % roster.length;

    var inningEnded = false;
    if (state.outs >= 3) {
      state.outs = 0;
      state.bases = [null, null, null];
      state.inning++;
      inningEnded = true;
    }

    lastPlayCtx = { playId: null, result: result, batterId: batter.id,
                    bases: basesBefore, outs: outsBefore, moves: moves };
    return { batter: batter, inning: inning, runs: res.runs, outsMade: res.outs,
             inningEnded: inningEnded, moves: moves };
  }

  function recordResult(result) {
    if (!gameId || roster.length === 0) { toast("Aún no hay conexión con el servidor"); return; }
    if (readOnly) { toast("Juego finalizado: solo lectura"); return; }
    var err = sacrificeError(result);
    if (err) { toast(err); return; }
    var info = applyResult(result);
    var ctx = lastPlayCtx;
    toast(info.inningEnded
      ? "Fin de la entrada — pasa a la entrada " + state.inning
      : info.batter.name + " — " + result +
        (info.runs ? " · " + info.runs + (info.runs === 1 ? " carrera" : " carreras") : ""));
    render();
    enqueue(async function () {
      var saved = await api("POST", "/api/games/" + gameId + "/plays", {
        inning: info.inning,
        batter_id: info.batter.id,
        result: result,
        rbi: info.runs,
        outs_made: info.outsMade,
        runs_scored: info.runs,
        moves: JSON.stringify(info.moves)
      });
      playIds.push(saved.id);
      ctx.playId = saved.id;
    });
  }

  function undo() {
    if (readOnly) { toast("Juego finalizado: solo lectura"); return; }
    enqueue(async function () {
      if (playIds.length === 0) { toast("Nada que deshacer"); return; }
      await api("DELETE", "/api/plays/" + playIds[playIds.length - 1]);
      await loadGame();   // reconstruye todo desde las jugadas guardadas
      toast("Jugada deshecha");
    });
  }

  function savePitching(pid) {
    enqueue(function () {
      return api("PUT", "/api/games/" + gameId + "/pitching/" + pid, pitching[pid]);
    });
  }

  // ---------- Ajustar corredores de la última jugada ----------
  var DEST = [[0, "Out"], [1, "1ra base"], [2, "2da base"], [3, "3ra base"], [4, "Anotó"]];
  var BASE_LABEL = ["", "1ra", "2da", "3ra"];

  function openAdjust() {
    if (readOnly) { toast("Juego finalizado: solo lectura"); return; }
    var ctx = lastPlayCtx;
    if (!ctx || !ctx.playId) { toast("Aún no hay una jugada para ajustar"); return; }
    if (ctx.isEvent) { toast("Para corregir un robo o un cambio usa Deshacer"); return; }

    var rows = [];
    for (var i = 2; i >= 0; i--) {
      if (ctx.bases[i] !== null) rows.push({ p: ctx.bases[i], f: i + 1 });
    }
    rows.push({ p: ctx.batterId, f: 0 });
    rows.forEach(function (r) {
      var m = ctx.moves.find(function (x) { return x.p === r.p && x.f === r.f; });
      r.t = m ? m.t : r.f;   // sin movimiento: se queda donde estaba
    });

    var back = document.createElement("div");
    back.className = "modal-backdrop";
    var box = document.createElement("div");
    box.className = "modal";

    var title = document.createElement("div");
    title.className = "modal-title";
    title.textContent = "Ajustar corredores";
    var sub = document.createElement("div");
    sub.className = "modal-sub";
    sub.textContent = "Jugada: " + nameOf(ctx.batterId) + " — " + ctx.result +
                      ". Elige dónde terminó cada uno.";
    box.appendChild(title);
    box.appendChild(sub);

    var selects = [];
    rows.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "modal-row";
      var lab = document.createElement("span");
      lab.textContent = nameOf(r.p) + (r.f === 0 ? " (bateador)" : " (en " + BASE_LABEL[r.f] + ")");
      var sel = document.createElement("select");
      sel.className = "pitcher-select";
      sel.style.marginBottom = "0";
      DEST.forEach(function (d) {
        if (d[0] !== 0 && d[0] < r.f) return;   // no se puede retroceder
        var o = document.createElement("option");
        o.value = d[0];
        o.textContent = d[1];
        sel.appendChild(o);
      });
      sel.value = r.t;
      selects.push(sel);
      row.appendChild(lab);
      row.appendChild(sel);
      box.appendChild(row);
    });

    var errBox = document.createElement("div");
    errBox.className = "modal-error";
    box.appendChild(errBox);

    var actions = document.createElement("div");
    actions.className = "form-actions";
    var cancel = document.createElement("button");
    cancel.className = "btn secondary";
    cancel.type = "button";
    cancel.textContent = "Cancelar";
    var save = document.createElement("button");
    save.className = "btn";
    save.type = "button";
    save.textContent = "Guardar";
    actions.appendChild(save);
    actions.appendChild(cancel);
    box.appendChild(actions);
    back.appendChild(box);
    document.body.appendChild(back);

    function close() { document.body.removeChild(back); }
    cancel.addEventListener("click", close);
    back.addEventListener("click", function (e) { if (e.target === back) close(); });

    save.addEventListener("click", function () {
      var moves = rows.map(function (r, idx) {
        return { p: r.p, f: r.f, t: parseInt(selects[idx].value, 10) };
      });
      var taken = {};
      for (var k = 0; k < moves.length; k++) {
        var t = moves[k].t;
        if (t >= 1 && t <= 3) {
          if (taken[t]) { errBox.textContent = "Dos corredores no pueden estar en la misma base"; return; }
          taken[t] = true;
        }
      }
      var runs = moves.filter(function (m) { return m.t === 4; }).length;
      var outsMade = moves.filter(function (m) { return m.t === 0; }).length;
      if (ctx.outs + outsMade > 3) { errBox.textContent = "No puede haber más de 3 outs en la entrada"; return; }

      close();
      enqueue(async function () {
        await api("PUT", "/api/plays/" + ctx.playId, {
          moves: JSON.stringify(moves),
          outs_made: outsMade,
          runs_scored: runs,
          rbi: runs
        });
        await loadGame();
        toast("Corredores ajustados");
      });
    });
  }
    // ---------- Robos de base y corredor emergente ----------
  function blankStats() {
    return { ab: 0, h: 0, "1b": 0, "2b": 0, "3b": 0, hr: 0, bb: 0, k: 0, rbi: 0, r: 0, sf: 0, sh: 0 };
  }

  // El emergente toma el lugar del corredor en el orden al bate
  function substitute(oldId, newId) {
    var idx = roster.findIndex(function (x) { return x.id === oldId; });
    var np = pitchers.find(function (x) { return x.id === newId; });
    if (idx < 0 || !np) return;
    replacedIds[oldId] = true;
    roster[idx] = np;
    seen.push(np);
    if (!stats[newId]) stats[newId] = blankStats();
  }

  // Jugadas que no son turno al bate: SB, CS y PR (emergente). No mueven el orden al bate.
  function applyEvent(kind, moves) {
    var inning = state.inning;
    var outsBefore = state.outs;
    var basesBefore = state.bases.slice();
    if (kind === "PR") substitute(moves[0].r, moves[0].p);

    var res = applyMoves(moves);
    state.ourScore += res.runs;

    var inningEnded = false;
    if (state.outs >= 3) {
      state.outs = 0;
      state.bases = [null, null, null];
      state.inning++;
      inningEnded = true;
    }

    lastPlayCtx = { playId: null, isEvent: true, result: kind, batterId: moves[0].p,
                    bases: basesBefore, outs: outsBefore, moves: moves };
    return { runner: moves[0].p, inning: inning, runs: res.runs, outsMade: res.outs,
             inningEnded: inningEnded, moves: moves };
  }

  function sendEvent(kind, moves, message) {
    var info = applyEvent(kind, moves);
    var ctx = lastPlayCtx;
    toast(info.inningEnded
      ? "Fin de la entrada — pasa a la entrada " + state.inning
      : message);
    render();
    enqueue(async function () {
      var saved = await api("POST", "/api/games/" + gameId + "/plays", {
        inning: info.inning,
        batter_id: info.runner,
        result: kind,
        rbi: 0,
        outs_made: info.outsMade,
        runs_scored: info.runs,
        moves: JSON.stringify(info.moves)
      });
      playIds.push(saved.id);
      ctx.playId = saved.id;
    });
  }

  var STEAL_TO = ["", "2da", "3ra", "home"];

  function steal(base, ok) {
    if (readOnly) { toast("Juego finalizado: solo lectura"); return; }
    var id = state.bases[base - 1];
    if (id === null) return;
    var name = nameOf(id);
    if (ok) {
      if (base < 3 && state.bases[base] !== null) {
        toast("La siguiente base está ocupada");
        return;
      }
      sendEvent("SB", [{ p: id, f: base, t: base + 1 }],
                name + " robó " + STEAL_TO[base]);
    } else {
      sendEvent("CS", [{ p: id, f: base, t: 0 }],
                name + " fue out en el robo");
    }
  }

  function openPinchRunner(base) {
    if (readOnly) { toast("Juego finalizado: solo lectura"); return; }
    var oldId = state.bases[base - 1];
    if (oldId === null) return;
    var candidates = pitchers.filter(function (p) {
      return !roster.some(function (r) { return r.id === p.id; }) && !replacedIds[p.id];
    });
    if (candidates.length === 0) { toast("No hay jugadores disponibles en la banca"); return; }

    var back = document.createElement("div");
    back.className = "modal-backdrop";
    var box = document.createElement("div");
    box.className = "modal";

    var title = document.createElement("div");
    title.className = "modal-title";
    title.textContent = "Corredor emergente";
    var sub = document.createElement("div");
    sub.className = "modal-sub";
    sub.textContent = "Entra por " + nameOf(oldId) + " (en " + BASE_LABEL[base] +
                      "). Ocupará su lugar en el orden al bate.";
    var sel = document.createElement("select");
    sel.className = "pitcher-select";
    candidates.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.id;
      o.textContent = "#" + p.num + " " + p.name;
      sel.appendChild(o);
    });

    var actions = document.createElement("div");
    actions.className = "form-actions";
    var ok = document.createElement("button");
    ok.className = "btn";
    ok.type = "button";
    ok.textContent = "Aceptar";
    var cancel = document.createElement("button");
    cancel.className = "btn secondary";
    cancel.type = "button";
    cancel.textContent = "Cancelar";
    actions.appendChild(ok);
    actions.appendChild(cancel);

    box.appendChild(title);
    box.appendChild(sub);
    box.appendChild(sel);
    box.appendChild(actions);
    back.appendChild(box);
    document.body.appendChild(back);

    function close() { document.body.removeChild(back); }
    cancel.addEventListener("click", close);
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    ok.addEventListener("click", function () {
      var newId = parseInt(sel.value, 10);
      var msg = nameOf(newId) + " entra de corredor por " + nameOf(oldId);
      close();
      sendEvent("PR", [{ p: newId, f: base, t: base, r: oldId }], msg);
    });
  }

  function renderRunners() {
    var box = document.getElementById("runnersList");
    box.innerHTML = "";
    var any = false;
    for (var i = 2; i >= 0; i--) {
      if (state.bases[i] === null) continue;
      any = true;
      (function (base) {
        var row = document.createElement("div");
        row.className = "lineup-row";

        var lab = document.createElement("span");
        lab.className = "runner-base";
        lab.textContent = BASE_LABEL[base];
        var nm = document.createElement("span");
        nm.className = "lineup-name";
        nm.textContent = nameOf(state.bases[base - 1]);
        row.appendChild(lab);
        row.appendChild(nm);

        if (!readOnly) {
          [["Robo", false, function () { steal(base, true); }],
           ["Out robo", true, function () { steal(base, false); }],
           ["Emergente", false, function () { openPinchRunner(base); }]
          ].forEach(function (a) {
            var b = document.createElement("button");
            b.className = "btn-link" + (a[1] ? " danger" : "");
            b.type = "button";
            b.textContent = a[0];
            b.addEventListener("click", a[2]);
            row.appendChild(b);
          });
        }
        box.appendChild(row);
      })(i + 1);
    }
    if (!any) {
      var empty = document.createElement("div");
      empty.className = "lineup-row";
      empty.textContent = "Sin corredores en base.";
      box.appendChild(empty);
    }
  }

  // Carga el juego: reconstruye bases, outs, marcador y estadísticas repitiendo las jugadas
  async function loadGame() {
    resetLocal();
    var plays = await api("GET", "/api/games/" + gameId + "/plays");
    plays.forEach(function (p) {
      var mv = null;
      if (p.moves) { try { mv = JSON.parse(p.moves); } catch (e) { mv = null; } }
      if (p.result === "SB" || p.result === "CS" || p.result === "PR") {
        if (mv) applyEvent(p.result, mv);
      } else {
        applyResult(p.result, mv);
      }
      playIds.push(p.id);
      if (lastPlayCtx) lastPlayCtx.playId = p.id;
    });
    var lines = await api("GET", "/api/games/" + gameId + "/pitching");
    lines.forEach(function (l) {
      if (pitching[l.player_id]) {
        pitching[l.player_id] = { outs: l.outs, k: l.k, bb: l.bb, h: l.h, r: l.r, er: l.er };
      }
    });
    render();
  }

  async function init() {
    try {
      var id = new URLSearchParams(location.search).get("game");
      if (!id) {
        var all = await api("GET", "/api/games");
        var live = all.find(function (g) { return g.status === "en_juego"; });
        if (!live) { location.replace("/static/juegos.html"); return; }
        id = live.id;
      }
      gameId = parseInt(id, 10);

      var data = await api("GET", "/api/games/" + gameId);
      var game = data.game;
      document.getElementById("rivalName").textContent = game.opponent;
      if (window.teamReady) {
        window.teamReady.then(function (t) {
          document.getElementById("teamName").textContent = t.name;
        });
      }

      if (data.lineup.length === 0) {
        document.getElementById("batterName").textContent = "Sin orden al bate";
        document.getElementById("batterPos").innerHTML =
          'Edita el juego en <a href="/static/juegos.html" style="color:var(--amber)">Juegos</a>';
        return;
      }

      roster = data.lineup.map(function (s) {
        return {
          id: s.player_id, num: s.number == null ? "–" : s.number, name: s.name, pos: s.position || "",
          photo: s.photo_v ? "/api/players/" + s.player_id + "/photo?v=" + s.photo_v : null
        };
      });

      rosterOriginal = roster.slice();
      var players = await api("GET", "/api/players");
      pitchers = players.map(function (p) {
        return {
          id: p.id, num: p.number == null ? "–" : p.number, name: p.name, pos: p.position || "",
          photo: p.photo_v ? "/api/players/" + p.id + "/photo?v=" + p.photo_v : null
        };
      });
      roster.forEach(function (r) {
        if (!pitchers.some(function (p) { return p.id === r.id; })) pitchers.push(r);
      });
      var pit = roster.find(function (p) { return p.pos === "P"; }) || pitchers[0];
      state.currentPitcherId = pit.id;

      if (game.status === "programado") {
        await api("POST", "/api/games/" + gameId + "/start");
      }
      readOnly = game.status === "finalizado";
      await loadGame();
      if (readOnly) toast("Juego finalizado: solo lectura");
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo conectar con el servidor");
    }
  }
  function renderScoreboard() {
    document.getElementById("inningNum").textContent = state.inning;
    document.getElementById("ourScore").textContent = state.ourScore;
     var their = 0;
    Object.keys(pitching).forEach(function (id) { their += pitching[id].r; });
    state.theirScore = their;
    document.getElementById("theirScore").textContent = their;
    var dots = document.querySelectorAll("#outsDots .out-dot");
    dots.forEach(function (d, i) { d.classList.toggle("filled", i < state.outs); });

    document.getElementById("baseFirst").classList.toggle("occupied", state.bases[0]);
    document.getElementById("baseSecond").classList.toggle("occupied", state.bases[1]);
    document.getElementById("baseThird").classList.toggle("occupied", state.bases[2]);
    var names = [];
    ["1ra", "2da", "3ra"].forEach(function (label, i) {
      if (state.bases[i]) names.push(label + ": " + nameOf(state.bases[i]));
    });
    document.getElementById("basesText").textContent = names.length ? names.join(" · ") : "Bases vacías";
  }

  function renderBatter() {
    var b = currentBatter();
    var s = stats[b.id];
    document.getElementById("batterNum").textContent = "#" + b.num;
    var ph = document.getElementById("batterPhoto");
    if (b.photo) { ph.src = b.photo; ph.style.display = ""; }
    else { ph.removeAttribute("src"); ph.style.display = "none"; }
    document.getElementById("batterName").textContent = b.name;
    document.getElementById("batterPos").textContent = b.pos;
    document.getElementById("batterLine").innerHTML =
      "<b>" + s.ab + "</b> AB · <b>" + s.h + "</b> H · <b>" + s.rbi + "</b> CI · AVG <b>" + fmtAvg(s) + "</b>";
    var card = document.getElementById("batterCard");
    card.classList.add("flash");
    setTimeout(function () { card.classList.remove("flash"); }, 250);
  }

  function renderLineup() {
    var list = document.getElementById("lineupList");
    list.innerHTML = "";
    roster.forEach(function (p, idx) {
      var s = stats[p.id];
      var row = document.createElement("div");
      row.className = "lineup-row" + (idx === state.batterIndex ? " current" : "");
      row.innerHTML =
        '<span class="lineup-order">' + (idx + 1) + '</span>' +
        '<span class="lineup-num">#' + p.num + '</span>' +
        '<span class="lineup-name">' + p.name + '</span>' +
        '<span class="lineup-pos">' + p.pos + '</span>' +
        '<span class="lineup-stat">' + s.h + '-' + s.ab + '</span>';
      list.appendChild(row);
    });
  }

  function renderPitching() {
    var sel = document.getElementById("pitcherSelect");
    if (!sel.dataset.built) {
      pitchers.forEach(function (p) {
        var opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = "#" + p.num + " " + p.name;
        sel.appendChild(opt);
      });
      sel.value = state.currentPitcherId;
      sel.dataset.built = "1";
      sel.addEventListener("change", function () {
        state.currentPitcherId = parseInt(sel.value, 10);
        renderPitching();
      });
    }
    var p = pitching[state.currentPitcherId];
    document.getElementById("p-outs").textContent = Math.floor(p.outs / 3) + "." + (p.outs % 3);
    document.getElementById("p-k").textContent = p.k;
    document.getElementById("p-bb").textContent = p.bb;
    document.getElementById("p-h").textContent = p.h;
    document.getElementById("p-r").textContent = p.r;
    document.getElementById("p-er").textContent = p.er;
  }

  function renderResumen() {
    var body = document.getElementById("resumenBody");
    body.innerHTML = "";
    seen.forEach(function (p) {
      var s = stats[p.id];
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>#" + p.num + " " + p.name + "</td><td>" + s.ab + "</td><td>" + s.h + "</td><td>" + s["2b"] +
        "</td><td>" + s["3b"] + "</td><td>" + s.hr + "</td><td>" + s.bb + "</td><td>" + s.k + "</td><td>" + s.rbi + "</td><td>" + s.r +
        "</td><td>" + fmtAvg(s) + "</td>";
      body.appendChild(tr);
    });
    var pbody = document.getElementById("resumenPitcheo");
    pbody.innerHTML = "";
    pitchers.forEach(function (p) {
      var pt = pitching[p.id];
      if (pt.outs === 0 && pt.k === 0 && pt.bb === 0 && pt.h === 0 && pt.r === 0 && pt.er === 0) return;
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>#" + p.num + " " + p.name + "</td><td>" + Math.floor(pt.outs / 3) + "." + (pt.outs % 3) +
        "</td><td>" + pt.k + "</td><td>" + pt.bb + "</td><td>" + pt.h + "</td><td>" + pt.r + "</td><td>" + pt.er + "</td>";
      pbody.appendChild(tr);
    });
  }

  function render() {
    renderScoreboard();
    renderBatter();
    renderLineup();
    renderRunners();
    renderPitching();
    renderResumen();
  }

  document.querySelectorAll(".outcome-btn").forEach(function (btn) {
    btn.addEventListener("click", function () { recordResult(btn.dataset.result); });
  });
  document.getElementById("undoBtn").addEventListener("click", undo);

  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
      document.querySelectorAll(".panel").forEach(function (p) { p.classList.remove("active"); });
      btn.classList.add("active");
      document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
    });
  });

  document.querySelectorAll(".stepper-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (readOnly) { toast("Juego finalizado: solo lectura"); return; }
      var key = btn.dataset.p;
      var delta = parseInt(btn.dataset.d, 10);
      var p = pitching[state.currentPitcherId];
            p[key] = Math.max(0, p[key] + delta);
      savePitching(state.currentPitcherId);
      renderScoreboard();
      renderPitching();
      renderResumen();
    });
  });

  document.getElementById("adjustBtn").addEventListener("click", openAdjust);
  document.getElementById("finishBtn").addEventListener("click", function () {
    if (readOnly) { location.href = "/static/juegos.html"; return; }
    if (!confirm("¿Finalizar el juego? Ya no podrás anotar más jugadas.")) return;
    enqueue(async function () {
      await api("POST", "/api/games/" + gameId + "/finish");
      location.href = "/static/reportes.html?game=" + gameId;
    });
  });

  init();
})();
