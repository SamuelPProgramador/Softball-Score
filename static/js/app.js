
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
    bases: [false, false, false],
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
    toast._tm = setTimeout(function () { t.classList.remove("show"); }, 1400);
  }

  function currentBatter() { return roster[state.batterIndex]; }

  function advanceRunners(basesToAdvance, batterReachesBase) {
    // basesToAdvance: number of bases each existing runner moves
    var runsScored = 0;
    var newBases = [false, false, false];
    for (var i = 2; i >= 0; i--) {
      if (state.bases[i]) {
        var dest = i + basesToAdvance;
        if (dest >= 3) { runsScored++; }
        else { newBases[dest] = true; }
      }
    }
    if (batterReachesBase >= 0 && batterReachesBase < 3) newBases[batterReachesBase] = true;
    else if (batterReachesBase >= 3) runsScored++;
    state.bases = newBases;
    return runsScored;
  }

  function walkAdvance() {
    // Force-advance logic for BB / Error-on-1st
    var runsScored = 0;
    var b = state.bases;
    if (b[0] && b[1] && b[2]) { runsScored++; b[2] = true; b[1] = true; b[0] = true; }
    else if (b[0] && b[1]) { b[2] = true; b[1] = true; b[0] = true; }
    else if (b[0]) { b[1] = true; b[0] = true; }
    else { b[0] = true; }
    state.bases = b;
    return runsScored;
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
    stats = {};
    pitching = {};
    roster.forEach(function (p) {
      stats[p.id] = { ab: 0, h: 0, "1b": 0, "2b": 0, "3b": 0, hr: 0, bb: 0, k: 0, rbi: 0, r: 0 };
    });
    pitchers.forEach(function (p) {
      pitching[p.id] = { outs: 0, k: 0, bb: 0, h: 0, r: 0, er: 0 };
    });
    state.batterIndex = 0;
    state.inning = 1;
    state.ourScore = 0;
    state.theirScore = 0;
    state.outs = 0;
    state.bases = [false, false, false];
    playIds = [];
  }

  // Aplica una jugada al estado local (sin tocar el servidor)
  function applyResult(result) {
    var batter = currentBatter();
    var s = stats[batter.id];
    var inning = state.inning;
    var runs = 0, outsMade = 0;

    if (result === "1B") { s.ab++; s.h++; s["1b"]++; runs = advanceRunners(1, 0); }
    else if (result === "2B") { s.ab++; s.h++; s["2b"]++; runs = advanceRunners(2, 1); }
    else if (result === "3B") { s.ab++; s.h++; s["3b"]++; runs = advanceRunners(3, 2); }
    else if (result === "HR") { s.ab++; s.h++; s.hr++; runs = advanceRunners(3, 3); }
    else if (result === "BB") { s.bb++; runs = walkAdvance(); }
    else if (result === "E") { s.ab++; runs = walkAdvance(); }
    else if (result === "K") { s.ab++; s.k++; state.outs++; outsMade = 1; }
    else if (result === "OUT") { s.ab++; state.outs++; outsMade = 1; }

    if (runs > 0) { s.rbi += runs; state.ourScore += runs; }
    state.batterIndex = (state.batterIndex + 1) % roster.length;

    var inningEnded = false;
    if (state.outs >= 3) {
      state.outs = 0;
      state.bases = [false, false, false];
      state.inning++;
      inningEnded = true;
    }
    return { batter: batter, inning: inning, runs: runs, outsMade: outsMade, inningEnded: inningEnded };
  }

  function recordResult(result) {
    if (!gameId || roster.length === 0) { toast("Aún no hay conexión con el servidor"); return; }
    if (readOnly) { toast("Juego finalizado: solo lectura"); return; }
    var info = applyResult(result);
    toast(info.inningEnded
      ? "Fin de la entrada — pasa a la entrada " + state.inning
      : info.batter.name + " — " + result);
    render();
    enqueue(async function () {
      var saved = await api("POST", "/api/games/" + gameId + "/plays", {
        inning: info.inning,
        batter_id: info.batter.id,
        result: result,
        rbi: info.runs,
        outs_made: info.outsMade,
        runs_scored: info.runs
      });
      playIds.push(saved.id);
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

  // Carga el juego: reconstruye bases, outs, marcador y estadísticas repitiendo las jugadas
  async function loadGame() {
    resetLocal();
    var plays = await api("GET", "/api/games/" + gameId + "/plays");
    plays.forEach(function (p) { applyResult(p.result); playIds.push(p.id); });
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

      var players = await api("GET", "/api/players");
      pitchers = players.map(function (p) {
        return { id: p.id, num: p.number == null ? "–" : p.number, name: p.name, pos: p.position || "" };
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
    if (state.bases[0]) names.push("1ra");
    if (state.bases[1]) names.push("2da");
    if (state.bases[2]) names.push("3ra");
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
    roster.forEach(function (p) {
      var s = stats[p.id];
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>#" + p.num + " " + p.name + "</td><td>" + s.ab + "</td><td>" + s.h + "</td><td>" + s["2b"] +
        "</td><td>" + s["3b"] + "</td><td>" + s.hr + "</td><td>" + s.bb + "</td><td>" + s.k + "</td><td>" + s.rbi +
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
