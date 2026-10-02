(function () {
  var BAT_LEADERS = [
    ["AVG", "Promedio (AVG)", "rate"], ["HR", "Jonrones (HR)"], ["RBI", "Impulsadas (CI)"],
    ["H", "Hits"], ["SB", "Bases robadas (SB)"]
  ];
  var PIT_LEADERS = [["K", "Ponches (K)"], ["ERA", "Efectividad (ERA)", "dec2"]];
  var RESULTADOS = { G: "VICTORIA", P: "DERROTA", E: "EMPATE" };

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
    if (kind === "rate") return Number(v).toFixed(3).replace(/^0\./, ".");
    if (kind === "dec2") return Number(v).toFixed(2);
    return String(v);
  }
  function fmtDate(s) { var p = s.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
           String(d.getDate()).padStart(2, "0");
  }

  function tile(label, value) {
    var t = el("div", "tile");
    t.appendChild(el("div", "tile-label", label));
    t.appendChild(el("div", "tile-val", value));
    return t;
  }

  function card(title) {
    var c = el("div", "leader-card");
    c.appendChild(el("div", "leader-title", title));
    return c;
  }

  function renderLive(g) {
    var box = $("liveBox");
    box.innerHTML = "";
    if (!g) return;
    var b = el("div", "banner");
    b.appendChild(el("span", null, "● Juego en vivo: vs " + g.opponent));
    var a = el("a", null, "Abrir ▶");
    a.href = "/static/partido.html?game=" + g.id;
    b.appendChild(a);
    box.appendChild(b);
  }

  function renderSummary(d) {
    $("seasonTitle").textContent = d.season.name;
    var r = d.record;
    var rec = r.wins + "-" + r.losses + (r.ties ? "-" + r.ties : "");
    var t = $("summaryTiles");
    t.innerHTML = "";
    t.appendChild(tile("Récord", rec));
    t.appendChild(tile("Juegos", r.played));
    t.appendChild(tile("Carreras a favor", d.runs["for"]));
    t.appendChild(tile("En contra", d.runs.against));
  }

  function renderInfo(d) {
    var box = $("infoCards");
    box.innerHTML = "";

    // Próximo juego
    var next = card("Próximo juego");
    if (d.next) {
      var g = d.next;
      next.appendChild(el("div", "leader-main", "vs " + g.opponent));
      var when = fmtDate(g.date) + (g.time ? " · " + g.time : "");
      if (g.date === todayIso()) when = "HOY · " + when;
      next.appendChild(el("div", "leader-sub", when));
      if (g.location) next.appendChild(el("div", "leader-sub", g.location));
      var a1 = el("a", null, "Ir a Juegos ▶");
      a1.href = "/static/juegos.html";
      next.appendChild(a1);
    } else {
      next.appendChild(el("div", "leader-sub", "No hay juegos programados."));
      var a2 = el("a", null, "Programar un juego ▶");
      a2.href = "/static/juegos.html";
      next.appendChild(a2);
    }
    box.appendChild(next);

    // Último resultado
    var last = card("Último resultado");
    if (d.last) {
      var l = d.last;
      var res = l.our_score > l.opp_score ? "G" : (l.our_score < l.opp_score ? "P" : "E");
      last.appendChild(el("div", "leader-main", l.our_score + " – " + l.opp_score + " · " + RESULTADOS[res]));
      last.appendChild(el("div", "leader-sub", "vs " + l.opponent + " · " + fmtDate(l.date)));
      var a3 = el("a", null, "Ver hoja de resultados ▶");
      a3.href = "/static/reportes.html?game=" + l.id;
      last.appendChild(a3);
    } else {
      last.appendChild(el("div", "leader-sub", "Aún no hay juegos finalizados."));
    }
    box.appendChild(last);

    // Últimos 5
    var form = card("Últimos juegos");
    if (d.form.length) {
      var row = el("div");
      d.form.forEach(function (x) { row.appendChild(el("span", "pill " + x.toLowerCase(), x)); });
      form.appendChild(row);
      form.appendChild(el("div", "leader-sub", "G ganado · P perdido · E empate"));
    } else {
      form.appendChild(el("div", "leader-sub", "Sin resultados todavía."));
    }
    box.appendChild(form);
  }

  function renderLeaders(boxId, defs, leaders) {
    var box = $(boxId);
    box.innerHTML = "";
    defs.forEach(function (def) {
      var c = card(def[1]);
      var list = leaders[def[0]] || [];
      if (list.length === 0) {
        c.appendChild(el("div", "leader-sub", "Sin datos todavía."));
      }
      list.forEach(function (x, i) {
        var row = el("div", "leader-row");
        row.appendChild(el("span", null, (i + 1) + ". " + x.name));
        row.appendChild(el("b", null, fmt(x.value, def[2])));
        c.appendChild(row);
      });
      box.appendChild(c);
    });
  }

  async function init() {
    try {
      var d = await api("/api/dashboard");
      renderLive(d.live);
      renderSummary(d);
      renderInfo(d);
      renderLeaders("batLeaders", BAT_LEADERS, d.leaders);
      renderLeaders("pitLeaders", PIT_LEADERS, d.leaders);
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo conectar con el servidor");
    }
  }

  init();
})();