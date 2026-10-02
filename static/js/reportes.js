(function () {
  var ESTADOS = { programado: "PROGRAMADO", en_juego: "EN JUEGO", finalizado: "FINALIZADO" };

  var BAT_COLS = [
    ["label", "Jugador"], ["pos", "Pos"], ["AB", "AB"], ["H", "H"], ["B2", "2B"], ["B3", "3B"],
    ["HR", "HR"], ["RBI", "CI"], ["BB", "BB"], ["K", "K"], ["SB", "SB"], ["E", "E"],
    ["AVG", "AVG", "rate"]
  ];
  var PIT_COLS = [
    ["name", "Pitcher"], ["IP", "IP"], ["H", "H"], ["R", "C"], ["ER", "CL"],
    ["BB", "BB"], ["K", "K"], ["ERA", "ERA", "dec2"]
  ];
  var SUM_FIELDS = ["AB", "H", "B2", "B3", "HR", "RBI", "BB", "K", "SB", "E"];

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
    toast._tm = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }
  function api(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + " -> " + r.status);
      return r.json();
    });
  }
  function fmt(v, kind) {
    if (v === null || v === undefined) return "";
    if (kind === "rate") return Number(v).toFixed(3).replace(/^0\./, ".");
    if (kind === "dec2") return Number(v).toFixed(2);
    return String(v);
  }
  function fmtDate(s) { var p = s.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }

  function buildTable(table, cols, rows) {
    table.innerHTML = "";
    var thead = el("thead");
    var hr = el("tr");
    cols.forEach(function (c) { hr.appendChild(el("th", null, c[1])); });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el("tbody");
    if (rows.length === 0) {
      var tr0 = el("tr");
      var td0 = el("td", "empty-note", "Sin datos.");
      td0.colSpan = cols.length;
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
    }
    rows.forEach(function (row) {
      var tr = el("tr", row.__total ? "total" : "");
      cols.forEach(function (c) { tr.appendChild(el("td", null, fmt(row[c[0]], c[2]))); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  function zeros() {
    var o = {};
    SUM_FIELDS.forEach(function (f) { o[f] = 0; });
    o.AVG = 0;
    return o;
  }

  function battingRows(lineup, bateo) {
    var byId = {};
    bateo.forEach(function (b) { byId[b.player_id] = b; });
    var used = {};
    var rows = [];

    lineup.forEach(function (s) {
      used[s.player_id] = true;
      var stat = byId[s.player_id] || zeros();
      rows.push(Object.assign({}, stat, {
        label: s.batting_order + ". " + s.name,
        pos: s.position || ""
      }));
    });
    // Jugadores con estadísticas que no estaban en el orden original (sustitutos)
    bateo.forEach(function (b) {
      if (!used[b.player_id]) rows.push(Object.assign({}, b, { label: b.name, pos: "" }));
    });

    var total = Object.assign(zeros(), { label: "Total equipo", pos: "", __total: true });
    rows.forEach(function (r) {
      SUM_FIELDS.forEach(function (f) { total[f] += r[f] || 0; });
    });
    total.AVG = total.AB ? total.H / total.AB : 0;
    rows.push(total);
    return rows;
  }

  function pitchingRows(pitcheo) {
    var rows = pitcheo.map(function (p) { return Object.assign({}, p); });
    if (rows.length === 0) return rows;
    var t = { name: "Total", outs: 0, H: 0, R: 0, ER: 0, BB: 0, K: 0, ERA: null, __total: true };
    rows.forEach(function (p) {
      ["outs", "H", "R", "ER", "BB", "K"].forEach(function (f) { t[f] += p[f] || 0; });
    });
    t.IP = Math.floor(t.outs / 3) + "." + (t.outs % 3);
    rows.push(t);
    return rows;
  }

  function resultText(g) {
    if (g.status !== "finalizado") return ESTADOS[g.status] || g.status;
    if (g.our_score > g.opp_score) return "VICTORIA";
    if (g.our_score < g.opp_score) return "DERROTA";
    return "EMPATE";
  }

  async function showGame(id) {
    try {
      var r = await Promise.all([api("/api/games/" + id), api("/api/games/" + id + "/sheet")]);
      var g = r[0].game;
      var lineup = r[0].lineup;
      var sheet = r[1];

      $("sTitle").textContent = "Mi Equipo vs " + g.opponent;
      var meta = [fmtDate(g.date)];
      if (g.time) meta.push(g.time);
      if (g.location) meta.push(g.location);
      $("sMeta").textContent = meta.join(" · ");

      var score = $("sScore");
      score.innerHTML = "";
      score.appendChild(document.createTextNode(
        g.status === "finalizado" ? g.our_score + " – " + g.opp_score : "—"));
      score.appendChild(el("small", null, resultText(g)));

      buildTable($("batTable"), BAT_COLS, battingRows(lineup, sheet.bateo));
      buildTable($("pitTable"), PIT_COLS, pitchingRows(sheet.pitcheo));
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo cargar la hoja");
    }
  }

  async function init() {
    try {
      var games = await api("/api/games");
      var sel = $("gameSel");
      if (games.length === 0) {
        $("sheet").style.display = "none";
        sel.appendChild(el("option", null, "Aún no hay juegos"));
        return;
      }
      games.sort(function (a, b) {
        return (b.date + (b.time || "")).localeCompare(a.date + (a.time || ""));
      });
      games.forEach(function (g) {
        var txt = fmtDate(g.date) + " vs " + g.opponent +
                  (g.status !== "finalizado" ? " (" + ESTADOS[g.status].toLowerCase() + ")" : "");
        var o = el("option", null, txt);
        o.value = g.id;
        sel.appendChild(o);
      });

      var wanted = parseInt(new URLSearchParams(location.search).get("game"), 10);
      var first = games.find(function (g) { return g.id === wanted; }) ||
                  games.find(function (g) { return g.status === "finalizado"; }) || games[0];
      sel.value = first.id;
      sel.addEventListener("change", function () { showGame(parseInt(sel.value, 10)); });
      await showGame(first.id);
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo conectar con el servidor");
    }
  }

  $("printBtn").addEventListener("click", function () { window.print(); });
  init();
})();