(function () {
  var POSITIONS = ["", "P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "BD"];
  var MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
               "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  var ESTADOS = { programado: "Programado", en_juego: "En juego", finalizado: "Finalizado" };

  var players = [];
  var games = [];
  var lineup = [];          // [{ player_id, position }]
  var editingId = null;
  var now = new Date();
  var viewYear = now.getFullYear();
  var viewMonth = now.getMonth();

  function $(id) { return document.getElementById(id); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function iso(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
  var todayIso = iso(now.getFullYear(), now.getMonth(), now.getDate());
  function fmtDate(s) { var p = s.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }

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

  // ---------- Orden al bate ----------
  function moveSlot(i, dir) {
    var j = i + dir;
    if (j < 0 || j >= lineup.length) return;
    var tmp = lineup[i];
    lineup[i] = lineup[j];
    lineup[j] = tmp;
    renderLineup();
  }

  function renderLineup() {
    var box = $("lineupBuilder");
    box.innerHTML = "";
    if (players.length === 0) {
      var a = el("a", "btn-link", "Primero registra tus jugadores en el módulo Jugadores");
      a.href = "/static/jugadores.html";
      box.appendChild(a);
      return;
    }
    if (lineup.length === 0) {
      box.appendChild(el("div", "field-label", "Aún no hay bateadores en el orden."));
    }
    lineup.forEach(function (slot, i) {
      var row = el("div", "slot-row");
      row.appendChild(el("span", "slot-order", String(i + 1)));

      var selPos = el("select", "input");
      POSITIONS.forEach(function (p) {
        var o = el("option", null, p === "" ? "Pos." : p);
        o.value = p;
        selPos.appendChild(o);
      });
      selPos.value = slot.position || "";
      selPos.addEventListener("change", function () { slot.position = selPos.value; });

      var selP = el("select", "input");
      var blank = el("option", null, "Elegir jugador…");
      blank.value = "";
      selP.appendChild(blank);
      players.forEach(function (p) {
        var o = el("option", null, (p.number == null ? "" : "#" + p.number + " ") + p.name);
        o.value = p.id;
        selP.appendChild(o);
      });
      selP.value = slot.player_id || "";
      selP.addEventListener("change", function () {
        slot.player_id = selP.value ? parseInt(selP.value, 10) : null;
        if (slot.player_id && !slot.position) {
          var pl = players.find(function (x) { return x.id === slot.player_id; });
          slot.position = (pl && pl.position) || "";
          selPos.value = slot.position;
        }
      });

      var acts = el("div", "slot-actions");
      [["↑", -1], ["↓", 1]].forEach(function (a) {
        var b = el("button", "btn-link", a[0]);
        b.type = "button";
        b.addEventListener("click", function () { moveSlot(i, a[1]); });
        acts.appendChild(b);
      });
      var rm = el("button", "btn-link danger", "✕");
      rm.type = "button";
      rm.addEventListener("click", function () { lineup.splice(i, 1); renderLineup(); });
      acts.appendChild(rm);

      row.appendChild(selP);
      row.appendChild(selPos);
      row.appendChild(acts);
      box.appendChild(row);
    });
  }

  // ---------- Calendario ----------
  function renderCalendar() {
    $("calTitle").textContent = MESES[viewMonth] + " " + viewYear;
    var grid = $("calGrid");
    grid.innerHTML = "";
    ["D", "L", "M", "M", "J", "V", "S"].forEach(function (d) {
      grid.appendChild(el("div", "cal-dow", d));
    });

    var startDow = new Date(viewYear, viewMonth, 1).getDay();
    var days = new Date(viewYear, viewMonth + 1, 0).getDate();
    var byDate = {};
    games.forEach(function (g) { (byDate[g.date] = byDate[g.date] || []).push(g); });

    for (var i = 0; i < startDow; i++) grid.appendChild(el("div", "cal-day empty"));

    for (var d = 1; d <= days; d++) {
      (function (d) {
        var key = iso(viewYear, viewMonth, d);
        var cell = el("button", "cal-day");
        cell.type = "button";
        if (key === todayIso) cell.classList.add("today");
        if (key === $("fDate").value) cell.classList.add("selected");
        cell.appendChild(el("span", null, String(d)));
        (byDate[key] || []).forEach(function (g) {
          cell.appendChild(el("span", "cal-chip" + (g.status === "finalizado" ? " done" : ""),
                              "vs " + g.opponent));
        });
        cell.addEventListener("click", function () {
          $("fDate").value = key;
          renderCalendar();
          toast("Fecha elegida: " + fmtDate(key));
        });
        grid.appendChild(cell);
      })(d);
    }
  }

  // ---------- Lista de juegos ----------
  function sortKey(g) { return g.date + (g.time || ""); }

  function gameRow(g) {
    var row = el("div", "lineup-row game-row");

    var date = el("div", "game-date", fmtDate(g.date));
    if (g.time) date.appendChild(el("small", null, g.time));
    row.appendChild(date);

    row.appendChild(el("div", "lineup-name",
      "vs " + g.opponent + (g.location ? " · " + g.location : "") +
      (g.status === "finalizado" ? " · " + g.our_score + "–" + g.opp_score : "")));
    row.appendChild(el("span", "badge" + (g.status === "en_juego" ? " live" : ""),
      ESTADOS[g.status] || g.status));

    var acts = el("div", "game-actions");
    var open = el("a", "btn-link", g.status === "finalizado" ? "Ver" : "Abrir");
    open.href = "/static/partido.html?game=" + g.id;
    acts.appendChild(open);

    if (g.status === "finalizado") {
      var sheet = el("a", "btn-link", "Hoja");
      sheet.href = "/static/reportes.html?game=" + g.id;
      acts.appendChild(sheet);
    }

    var edit = el("button", "btn-link", "Editar");
    edit.type = "button";
    edit.addEventListener("click", function () { startEdit(g); });
    acts.appendChild(edit);

    var del = el("button", "btn-link danger", "Borrar");
    del.type = "button";
    del.addEventListener("click", function () { removeGame(g); });
    acts.appendChild(del);

    row.appendChild(acts);
    return row;
  }

  function fillList(box, list, emptyMsg) {
    box.innerHTML = "";
    if (list.length === 0) {
      box.appendChild(el("div", "lineup-row", emptyMsg));
      return;
    }
    list.forEach(function (g) { box.appendChild(gameRow(g)); });
  }

  function renderGames() {
    var upcoming = games.filter(function (g) { return g.status !== "finalizado"; })
      .sort(function (a, b) { return sortKey(a).localeCompare(sortKey(b)); });
    var done = games.filter(function (g) { return g.status === "finalizado"; })
      .sort(function (a, b) { return sortKey(b).localeCompare(sortKey(a)); });
    fillList($("upcomingList"), upcoming, "No hay juegos programados.");
    fillList($("doneList"), done, "Aún no hay juegos finalizados.");
  }

  // ---------- Formulario ----------
  function resetForm() {
    editingId = null;
    $("fDate").value = todayIso;
    $("fTime").value = "";
    $("fOpp").value = "";
    $("fPlace").value = "";
    lineup = [];
    $("formTitle").textContent = "Nuevo juego";
    $("cancelBtn").style.display = "none";
    renderLineup();
    renderCalendar();
  }

  async function startEdit(g) {
    try {
      var data = await api("GET", "/api/games/" + g.id);
      editingId = g.id;
      $("fDate").value = g.date;
      $("fTime").value = g.time || "";
      $("fOpp").value = g.opponent;
      $("fPlace").value = g.location || "";
      lineup = data.lineup.map(function (s) {
        return { player_id: s.player_id, position: s.position || "" };
      });
      $("formTitle").textContent = "Editar juego";
      $("cancelBtn").style.display = "";
      renderLineup();
      renderCalendar();
      $("formCard").scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo cargar el juego");
    }
  }

  async function saveGame() {
    var date = $("fDate").value;
    var opp = $("fOpp").value.trim();
    if (!date) { toast("Elige la fecha"); return; }
    if (!opp) { toast("Escribe el nombre del rival"); return; }

    var clean = lineup.filter(function (s) { return s.player_id; });
    var ids = clean.map(function (s) { return s.player_id; });
    if (ids.length !== new Set(ids).size) {
      toast("Hay un jugador repetido en el orden al bate");
      return;
    }

    var body = {
      date: date,
      time: $("fTime").value || null,
      opponent: opp,
      location: $("fPlace").value.trim() || null,
      lineup: clean.map(function (s) { return { player_id: s.player_id, position: s.position || null }; })
    };

    try {
      if (editingId) {
        await api("PUT", "/api/games/" + editingId, body);
        toast("Juego actualizado");
      } else {
        await api("POST", "/api/games", body);
        toast("Juego guardado");
      }
      resetForm();
      await load();
    } catch (e) {
      console.error(e);
      toast("⚠ " + e.message);
    }
  }

  async function removeGame(g) {
    if (!confirm("¿Borrar el juego vs " + g.opponent + " (" + fmtDate(g.date) +
                 ")? Se borran también sus jugadas.")) return;
    try {
      await api("DELETE", "/api/games/" + g.id);
      if (editingId === g.id) resetForm();
      await load();
      toast("Juego borrado");
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo borrar");
    }
  }

  async function load() {
    try {
      var r = await Promise.all([api("GET", "/api/players"), api("GET", "/api/games")]);
      players = r[0];
      games = r[1];
      renderLineup();
      renderCalendar();
      renderGames();
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo conectar con el servidor");
    }
  }

  $("addSlotBtn").addEventListener("click", function () {
    lineup.push({ player_id: null, position: "" });
    renderLineup();
  });
  $("fillAllBtn").addEventListener("click", function () {
    lineup = players.map(function (p) { return { player_id: p.id, position: p.position || "" }; });
    renderLineup();
  });
  $("saveBtn").addEventListener("click", saveGame);
  $("cancelBtn").addEventListener("click", resetForm);
  $("calPrev").addEventListener("click", function () {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderCalendar();
  });
  $("calNext").addEventListener("click", function () {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar();
  });

  $("fDate").value = todayIso;
  load();
})();