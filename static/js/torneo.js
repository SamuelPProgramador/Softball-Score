(function () {
  var tid = parseInt(new URLSearchParams(location.search).get("id"), 10);
  var data = null;

  var POS_COLS = [
    ["rank", "#"], ["name", "Equipo"], ["played", "PJ"], ["wins", "G"], ["losses", "P"],
    ["ties", "E"], ["rf", "CF"], ["ra", "CC"], ["diff", "DIF", "diff"], ["pct", "PCT", "rate"]
  ];

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._tm);
    toast._tm = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }
  async function api(method, url, body) {
    var opts = { method: method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    var res = await fetch(url, opts);
    if (!res.ok) {
      var msg = "";
      try { msg = (await res.json()).detail || ""; } catch (e) {}
      throw new Error(msg || (method + " " + url + " -> " + res.status));
    }
    return res.json();
  }
  function fmtDate(s) {
    if (!s) return "";
    var p = s.split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }
  function fmt(v, kind) {
    if (kind === "rate") return Number(v).toFixed(3).replace(/^0\./, ".");
    if (kind === "diff") return (v > 0 ? "+" : "") + v;
    return String(v);
  }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
           String(d.getDate()).padStart(2, "0");
  }

  // ---------- Encabezado ----------
  function renderHeader() {
    var t = data.tournament;
    $("tTitle").textContent = t.name;
    var meta = [];
    var range = [fmtDate(t.start_date), fmtDate(t.end_date)].filter(Boolean).join(" – ");
    if (range) meta.push(range);
    if (t.location) meta.push(t.location);
    meta.push(t.status === "finalizado" ? "Finalizado" : "En curso");
    $("tMeta").textContent = meta.join(" · ");
    $("statusBtn").textContent = t.status === "finalizado" ? "Reabrir torneo" : "Marcar como finalizado";
  }

  async function toggleStatus() {
    var t = data.tournament;
    try {
      await api("PUT", "/api/tournaments/" + tid, {
        name: t.name, start_date: t.start_date, end_date: t.end_date, location: t.location,
        status: t.status === "finalizado" ? "en_curso" : "finalizado"
      });
      await load();
    } catch (e) {
      toast("⚠ " + e.message);
    }
  }

  // ---------- Posiciones ----------
  function renderStandings() {
    var table = $("posTable");
    table.innerHTML = "";
    var thead = el("thead");
    var hr = el("tr");
    POS_COLS.forEach(function (c) { hr.appendChild(el("th", null, c[1])); });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el("tbody");
    if (data.standings.length === 0) {
      var tr0 = el("tr");
      var td0 = el("td", "empty-note", "Agrega equipos en la pestaña Equipos.");
      td0.colSpan = POS_COLS.length;
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
    }
    data.standings.forEach(function (r) {
      var tr = el("tr", r.is_mine ? "mine" : "");
      POS_COLS.forEach(function (c) { tr.appendChild(el("td", null, fmt(r[c[0]], c[2]))); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  // ---------- Juegos ----------
  function fillTeamSelects() {
    ["gHome", "gAway"].forEach(function (id) {
      var sel = $(id);
      var keep = sel.value;
      sel.innerHTML = "";
      var blank = el("option", null, "Elegir equipo…");
      blank.value = "";
      sel.appendChild(blank);
      data.teams.forEach(function (t) {
        var o = el("option", null, t.name);
        o.value = t.id;
        sel.appendChild(o);
      });
      sel.value = keep;
    });
    $("gamesHint").textContent = data.teams.length < 2
      ? "Necesitas al menos 2 equipos en el torneo (pestaña Equipos)." : "";
  }

  function renderGames() {
    var box = $("gameList");
    box.innerHTML = "";
    if (data.games.length === 0) {
      box.appendChild(el("div", "lineup-row", "Aún no hay juegos en el calendario."));
      return;
    }
    data.games.forEach(function (g) {
      var row = el("div", "lineup-row game-row");

      var date = el("div", "game-date", fmtDate(g.date));
      if (g.time) date.appendChild(el("small", null, g.time));
      row.appendChild(date);

      var label = g.home_name + " vs " + g.away_name;
      var name = el("div", "lineup-name", label);
      if (g.phase) name.appendChild(el("small", null, " · " + g.phase));
      row.appendChild(name);

      if (g.status === "finalizado") {
        row.appendChild(el("span", "badge live", g.home_score + " – " + g.away_score));
      } else {
        row.appendChild(el("span", "badge", "Programado"));
      }

      var acts = el("div", "game-actions");
      var res = el("button", "btn-link", g.status === "finalizado" ? "Editar resultado" : "Anotar resultado");
      res.type = "button";
      res.addEventListener("click", function () { openResult(g); });
      acts.appendChild(res);
      if (g.status === "finalizado") {
        var re = el("button", "btn-link", "Reabrir");
        re.type = "button";
        re.addEventListener("click", function () { reopenGame(g); });
        acts.appendChild(re);
      }
      var del = el("button", "btn-link danger", "Borrar");
      del.type = "button";
      del.addEventListener("click", function () { removeGame(g); });
      acts.appendChild(del);
      row.appendChild(acts);
      box.appendChild(row);
    });
  }

  async function addGame() {
    var home = parseInt($("gHome").value, 10);
    var away = parseInt($("gAway").value, 10);
    if (!home || !away) { toast("Elige los dos equipos"); return; }
    if (home === away) { toast("Un equipo no puede jugar contra sí mismo"); return; }
    if (!$("gDate").value) { toast("Elige la fecha"); return; }
    try {
      await api("POST", "/api/tournaments/" + tid + "/games", {
        home_team_id: home, away_team_id: away, date: $("gDate").value,
        time: $("gTime").value || null,
        location: $("gPlace").value.trim() || null,
        phase: $("gPhase").value.trim() || null
      });
      $("gHome").value = "";
      $("gAway").value = "";
      $("gTime").value = "";
      toast("Juego agregado");
      await load();
    } catch (e) {
      toast("⚠ " + e.message);
    }
  }

  function openResult(g) {
    var back = el("div", "modal-backdrop");
    var box = el("div", "modal");
    box.appendChild(el("div", "modal-title", "Resultado"));
    box.appendChild(el("div", "modal-sub", g.home_name + " (local) vs " + g.away_name + " (visitante)"));

    function scoreRow(label, value) {
      var row = el("div", "modal-row");
      row.appendChild(el("span", null, label));
      var inp = el("input", "input");
      inp.type = "number";
      inp.min = "0";
      inp.inputMode = "numeric";
      inp.value = value == null ? "" : value;
      row.appendChild(inp);
      box.appendChild(row);
      return inp;
    }
    var homeInp = scoreRow(g.home_name, g.home_score);
    var awayInp = scoreRow(g.away_name, g.away_score);

    var err = el("div", "modal-error");
    box.appendChild(err);

    var actions = el("div", "form-actions");
    var save = el("button", "btn", "Guardar");
    save.type = "button";
    var cancel = el("button", "btn secondary", "Cancelar");
    cancel.type = "button";
    actions.appendChild(save);
    actions.appendChild(cancel);
    box.appendChild(actions);
    back.appendChild(box);
    document.body.appendChild(back);
    homeInp.focus();

    function close() { document.body.removeChild(back); }
    cancel.addEventListener("click", close);
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    save.addEventListener("click", async function () {
      var h = parseInt(homeInp.value, 10);
      var a = parseInt(awayInp.value, 10);
      if (isNaN(h) || isNaN(a) || h < 0 || a < 0) { err.textContent = "Escribe las carreras de los dos equipos"; return; }
      try {
        await api("POST", "/api/tournament-games/" + g.id + "/result", { home_score: h, away_score: a });
        close();
        toast("Resultado guardado");
        await load();
      } catch (e) {
        err.textContent = e.message;
      }
    });
  }

  async function reopenGame(g) {
    if (!confirm("¿Reabrir este juego? Se borra su resultado.")) return;
    try {
      await api("POST", "/api/tournament-games/" + g.id + "/reopen");
      await load();
    } catch (e) {
      toast("⚠ " + e.message);
    }
  }

  async function removeGame(g) {
    if (!confirm("¿Borrar el juego " + g.home_name + " vs " + g.away_name + "?")) return;
    try {
      await api("DELETE", "/api/tournament-games/" + g.id);
      await load();
    } catch (e) {
      toast("⚠ " + e.message);
    }
  }

  // ---------- Equipos ----------
  function renderTeams() {
    var box = $("teamList");
    box.innerHTML = "";
    if (data.teams.length === 0) {
      box.appendChild(el("div", "lineup-row", "Aún no hay equipos en este torneo."));
    }
    data.teams.forEach(function (t) {
      var n = data.games.filter(function (g) {
        return g.home_team_id === t.id || g.away_team_id === t.id;
      }).length;
      var row = el("div", "lineup-row");
      row.appendChild(el("span", "lineup-name", t.name + (t.is_mine ? " (mi equipo)" : "")));
      row.appendChild(el("span", "lineup-stat", n + (n === 1 ? " juego" : " juegos")));
      var del = el("button", "btn-link danger", "Quitar");
      del.type = "button";
      del.addEventListener("click", function () { removeTeam(t); });
      row.appendChild(del);
      box.appendChild(row);
    });
    $("addMineBtn").style.display = data.teams.some(function (t) { return t.is_mine; }) ? "none" : "";
  }

  async function loadSuggestions() {
    try {
      var all = await api("GET", "/api/teams");
      var dl = $("teamSuggest");
      dl.innerHTML = "";
      all.forEach(function (t) {
        var o = document.createElement("option");
        o.value = t.name;
        dl.appendChild(o);
      });
    } catch (e) { /* sin sugerencias */ }
  }

  async function addTeam(isMine) {
    var name = $("teamName").value.trim();
    if (isMine) {
      var team = window.teamReady ? await window.teamReady : { name: "Mi Equipo" };
      name = team.name;
    }
    if (!name) { toast("Escribe el nombre del equipo"); return; }
    try {
      await api("POST", "/api/tournaments/" + tid + "/teams", { name: name, is_mine: !!isMine });
      $("teamName").value = "";
      toast("Equipo agregado");
      await load();
      loadSuggestions();
    } catch (e) {
      toast("⚠ " + e.message);
    }
  }

  async function removeTeam(t) {
    if (!confirm("¿Quitar a " + t.name + " del torneo?")) return;
    try {
      await api("DELETE", "/api/tournaments/" + tid + "/teams/" + t.id);
      await load();
    } catch (e) {
      toast("⚠ " + e.message);
    }
  }

  // ---------- Carga general ----------
  async function load() {
    try {
      data = await api("GET", "/api/tournaments/" + tid);
      renderHeader();
      renderStandings();
      fillTeamSelects();
      renderGames();
      renderTeams();
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo cargar el torneo");
    }
  }

  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
      document.querySelectorAll(".panel").forEach(function (p) { p.classList.remove("active"); });
      btn.classList.add("active");
      $("panel-" + btn.dataset.tab).classList.add("active");
    });
  });
  $("statusBtn").addEventListener("click", toggleStatus);
  $("addGameBtn").addEventListener("click", addGame);
  $("addTeamBtn").addEventListener("click", function () { addTeam(false); });
  $("addMineBtn").addEventListener("click", function () { addTeam(true); });

  $("gDate").value = todayIso();
  load();
  loadSuggestions();
})();