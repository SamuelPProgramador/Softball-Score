(function () {
  // [campo, encabezado, formato]
  var BAT_COLS = [
    ["name", "Jugador"], ["G", "G"], ["AB", "AB"], ["H", "H"], ["B2", "2B"], ["B3", "3B"],
    ["HR", "HR"], ["RBI", "CI"], ["BB", "BB"], ["K", "K"], ["SB", "SB"],
    ["AVG", "AVG", "rate"], ["OBP", "OBP", "rate"], ["SLG", "SLG", "rate"], ["OPS", "OPS", "rate"]
  ];
  var PIT_COLS = [
    ["name", "Pitcher"], ["G", "G"], ["IP", "IP"], ["K", "K"], ["BB", "BB"], ["H", "H"],
    ["R", "C"], ["ER", "CL"], ["ERA", "ERA", "dec2"], ["WHIP", "WHIP", "dec2"]
  ];
  var BAT_LOG_COLS = [
    ["label", "Juego"], ["AB", "AB"], ["H", "H"], ["B2", "2B"], ["B3", "3B"], ["HR", "HR"],
    ["RBI", "CI"], ["BB", "BB"], ["K", "K"], ["AVG", "AVG", "rate"]
  ];
  var PIT_LOG_COLS = [
    ["label", "Juego"], ["IP", "IP"], ["K", "K"], ["BB", "BB"], ["H", "H"],
    ["R", "C"], ["ER", "CL"], ["ERA", "ERA", "dec2"]
  ];

  var seasonId = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, text) {
    var e = document.createElement(tag);
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
  function fmtDate(s) { var p = s.split("-"); return p[2] + "/" + p[1]; }

  function buildTable(table, cols, rows, onClick) {
    table.innerHTML = "";
    var thead = el("thead");
    var hr = el("tr");
    cols.forEach(function (c) { hr.appendChild(el("th", c[1])); });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el("tbody");
    if (rows.length === 0) {
      var tr0 = el("tr");
      var td0 = el("td", "Sin datos todavía.");
      td0.colSpan = cols.length;
      td0.className = "empty-note";
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
    }
    rows.forEach(function (row) {
      var tr = el("tr");
      if (onClick) {
        tr.className = "clickable";
        tr.addEventListener("click", function () { onClick(row); });
      }
      cols.forEach(function (c) { tr.appendChild(el("td", fmt(row[c[0]], c[2]))); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  function tile(label, value) {
    var t = el("div");
    t.className = "tile";
    var l = el("div", label); l.className = "tile-label";
    var v = el("div", value); v.className = "tile-val";
    t.appendChild(l);
    t.appendChild(v);
    return t;
  }

  async function showPlayer(row) {
    try {
      var q = "?season_id=" + seasonId;
      var d = await api("/api/players/" + row.player_id + "/stats" + q);
      var p = d.player;
      var title = $("detailTitle");
      title.innerHTML = "";
      title.style.cssText = "display:flex;align-items:center;gap:10px";
      if (p.photo_v) {
        var im = document.createElement("img");
        im.className = "avatar avatar-md";
        im.alt = "";
        im.src = "/api/players/" + p.id + "/photo?v=" + p.photo_v;
        title.appendChild(im);
      }
      title.appendChild(document.createTextNode(
        (p.number == null ? "" : "#" + p.number + " ") + p.name + (p.position ? " · " + p.position : "")));

      var tiles = $("detailTiles");
      tiles.innerHTML = "";
      if (d.bateo) {
        [["AVG", fmt(d.bateo.AVG, "rate")], ["OBP", fmt(d.bateo.OBP, "rate")],
         ["SLG", fmt(d.bateo.SLG, "rate")], ["OPS", fmt(d.bateo.OPS, "rate")],
         ["Hits", d.bateo.H], ["HR", d.bateo.HR], ["CI", d.bateo.RBI], ["Juegos", d.bateo.G]
        ].forEach(function (t) { tiles.appendChild(tile(t[0], t[1])); });
      }
      if (d.pitcheo) {
        [["IP", d.pitcheo.IP], ["ERA", fmt(d.pitcheo.ERA, "dec2")],
         ["WHIP", fmt(d.pitcheo.WHIP, "dec2")], ["K (pitcheo)", d.pitcheo.K]
        ].forEach(function (t) { tiles.appendChild(tile(t[0], t[1])); });
      }

      var batRows = [], pitRows = [];
      d.juegos.forEach(function (g) {
        var label = fmtDate(g.date) + " vs " + g.opponent;
        if (g.bateo) batRows.push(Object.assign({ label: label }, g.bateo));
        if (g.pitcheo) pitRows.push(Object.assign({ label: label }, g.pitcheo));
      });
      $("batLogBox").style.display = d.bateo ? "" : "none";
      $("pitLogBox").style.display = d.pitcheo ? "" : "none";
      buildTable($("batLog"), BAT_LOG_COLS, batRows, null);
      buildTable($("pitLog"), PIT_LOG_COLS, pitRows, null);

      $("detail").style.display = "";
      $("detail").scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo cargar el jugador");
    }
  }

  async function loadSeason() {
    try {
      var data = await api("/api/stats/season?season_id=" + seasonId);
      buildTable($("batTable"), BAT_COLS, data.bateo, showPlayer);
      buildTable($("pitTable"), PIT_COLS, data.pitcheo, showPlayer);
      $("detail").style.display = "none";
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo conectar con el servidor");
    }
  }

  async function init() {
    try {
      var seasons = await api("/api/seasons");
      var sel = $("seasonSel");
      seasons.forEach(function (s) {
        var o = el("option", s.name + (s.active ? " (activa)" : ""));
        o.value = s.id;
        sel.appendChild(o);
      });
      var wanted = parseInt(new URLSearchParams(location.search).get("season"), 10);
      var act = seasons.find(function (s) { return s.id === wanted; }) ||
                seasons.find(function (s) { return s.active; }) || seasons[0];
      seasonId = act.id;
      sel.value = seasonId;
      sel.addEventListener("change", function () {
        seasonId = parseInt(sel.value, 10);
        loadSeason();
      });
      await loadSeason();
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo conectar con el servidor");
    }
  }

  init();
})();