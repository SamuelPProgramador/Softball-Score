(function () {
  var MAX = 4;

  // better: "high" = gana el mayor, "low" = gana el menor
  // needs: campo que debe ser > 0 para que el valor cuente (evita premiar promedios sin datos)
  // cmp: campo numérico para comparar cuando el que se muestra es texto (IP)
  var BAT_ROWS = [
    { key: "G",   label: "Juegos" },
    { key: "AB",  label: "Turnos (AB)" },
    { key: "H",   label: "Hits", better: "high" },
    { key: "B2",  label: "Dobles (2B)", better: "high" },
    { key: "B3",  label: "Triples (3B)", better: "high" },
    { key: "HR",  label: "Jonrones (HR)", better: "high" },
    { key: "RBI", label: "Impulsadas (CI)", better: "high" },
    { key: "BB",  label: "Boletos (BB)", better: "high" },
    { key: "K",   label: "Ponches (K)", better: "low" },
    { key: "SB",  label: "Bases robadas (SB)", better: "high" },
    { key: "AVG", label: "AVG", kind: "rate", better: "high", needs: "AB" },
    { key: "OBP", label: "OBP", kind: "rate", better: "high", needs: "AB" },
    { key: "SLG", label: "SLG", kind: "rate", better: "high", needs: "AB" },
    { key: "OPS", label: "OPS", kind: "rate", better: "high", needs: "AB" }
  ];
  var PIT_ROWS = [
    { key: "G",    label: "Juegos" },
    { key: "IP",   label: "Entradas (IP)", better: "high", cmp: "outs" },
    { key: "K",    label: "Ponches (K)", better: "high" },
    { key: "BB",   label: "Boletos (BB)", better: "low" },
    { key: "H",    label: "Hits permitidos", better: "low" },
    { key: "R",    label: "Carreras", better: "low" },
    { key: "ER",   label: "Carreras limpias", better: "low" },
    { key: "ERA",  label: "ERA", kind: "dec2", better: "low", needs: "outs" },
    { key: "WHIP", label: "WHIP", kind: "dec2", better: "low", needs: "outs" }
  ];

  var players = [];
  var selected = [];
  var seasonId = null;
  var group = "bat";
  var data = { bateo: {}, pitcheo: {} };

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
    if (v === null || v === undefined) return "—";
    if (kind === "rate") return Number(v).toFixed(3).replace(/^0\./, ".");
    if (kind === "dec2") return Number(v).toFixed(2);
    return String(v);
  }
  function label(p) { return (p.number == null ? "" : "#" + p.number + " ") + p.name; }

  function renderChips() {
    var box = $("chips");
    box.innerHTML = "";
    if (players.length === 0) {
      box.appendChild(el("span", "field-label", "Aún no hay jugadores registrados."));
      return;
    }
    players.forEach(function (p) {
      var b = el("button", "chip" + (selected.indexOf(p.id) >= 0 ? " on" : ""), label(p));
      b.type = "button";
      b.addEventListener("click", function () { toggle(p.id); });
      box.appendChild(b);
    });
  }

  function toggle(id) {
    var i = selected.indexOf(id);
    if (i >= 0) {
      selected.splice(i, 1);
    } else {
      if (selected.length >= MAX) { toast("Máximo " + MAX + " jugadores"); return; }
      selected.push(id);
    }
    renderChips();
    renderTable();
  }

  function renderTable() {
    var table = $("cmpTable");
    table.innerHTML = "";

    var chosen = players.filter(function (p) { return selected.indexOf(p.id) >= 0; });
    if (chosen.length < 2) {
      var tr0 = el("tr");
      var td0 = el("td", "empty-note", "Elige al menos 2 jugadores para compararlos.");
      tr0.appendChild(td0);
      table.appendChild(tr0);
      return;
    }

    var rows = group === "bat" ? BAT_ROWS : PIT_ROWS;
    var src = group === "bat" ? data.bateo : data.pitcheo;

    function bestIds(spec) {
      if (!spec.better) return [];
      var vals = [];
      chosen.forEach(function (p) {
        var s = src[p.id];
        if (!s) return;
        if (spec.needs && !(s[spec.needs] > 0)) return;
        vals.push({ id: p.id, v: Number(s[spec.cmp || spec.key]) });
      });
      if (vals.length < 2) return [];
      var nums = vals.map(function (x) { return x.v; });
      var best = spec.better === "high" ? Math.max.apply(null, nums) : Math.min.apply(null, nums);
      if (nums.every(function (n) { return n === best; })) return [];
      return vals.filter(function (x) { return x.v === best; }).map(function (x) { return x.id; });
    }

    var thead = el("thead");
    var hr = el("tr");
    hr.appendChild(el("th", null, ""));
    chosen.forEach(function (p) { hr.appendChild(el("th", null, label(p))); });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el("tbody");
    rows.forEach(function (spec) {
      var best = bestIds(spec);
      var tr = el("tr");
      tr.appendChild(el("td", null, spec.label));
      chosen.forEach(function (p) {
        var s = src[p.id];
        var td = el("td", best.indexOf(p.id) >= 0 ? "best" : "", s ? fmt(s[spec.key], spec.kind) : "—");
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  async function loadSeason() {
    try {
      var d = await api("/api/stats/season?season_id=" + seasonId);
      data = { bateo: {}, pitcheo: {} };
      d.bateo.forEach(function (b) { data.bateo[b.player_id] = b; });
      d.pitcheo.forEach(function (p) { data.pitcheo[p.player_id] = p; });
      renderTable();
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo conectar con el servidor");
    }
  }

  function setGroup(g) {
    group = g;
    $("tabBat").classList.toggle("active", g === "bat");
    $("tabPit").classList.toggle("active", g === "pit");
    renderTable();
  }

  async function init() {
    try {
      var r = await Promise.all([api("/api/seasons"), api("/api/players")]);
      var seasons = r[0];
      players = r[1];

      var sel = $("seasonSel");
      seasons.forEach(function (s) {
        var o = el("option", null, s.name + (s.active ? " (activa)" : ""));
        o.value = s.id;
        sel.appendChild(o);
      });
      var act = seasons.find(function (s) { return s.active; }) || seasons[0];
      seasonId = act.id;
      sel.value = seasonId;
      sel.addEventListener("change", function () {
        seasonId = parseInt(sel.value, 10);
        loadSeason();
      });

      selected = players.slice(0, 2).map(function (p) { return p.id; });
      renderChips();
      await loadSeason();
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo conectar con el servidor");
    }
  }

  $("tabBat").addEventListener("click", function () { setGroup("bat"); });
  $("tabPit").addEventListener("click", function () { setGroup("pit"); });
  init();
})();