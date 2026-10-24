(function () {
  var ESTADOS = { en_curso: "EN CURSO", finalizado: "FINALIZADO" };

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

  function render(list) {
    var box = $("tournamentList");
    box.innerHTML = "";
    if (list.length === 0) {
      box.appendChild(el("div", "lineup-row", "Aún no hay torneos. Crea el primero arriba."));
      return;
    }
    list.forEach(function (t) {
      var row = el("div", "lineup-row game-row");
      row.appendChild(el("div", "lineup-name", t.name));
      row.appendChild(el("span", "badge" + (t.status === "en_curso" ? " live" : ""),
                         ESTADOS[t.status] || t.status));
      var range = [fmtDate(t.start_date), fmtDate(t.end_date)].filter(Boolean).join(" – ");
      if (range) row.appendChild(el("span", "lineup-stat", range));
      row.appendChild(el("span", "lineup-stat",
        t.teams + " equipos · " + t.finished + "/" + t.games + " juegos"));

      var acts = el("div", "game-actions");
      var open = el("a", "btn-link", "Abrir");
      open.href = "/static/torneo.html?id=" + t.id;
      acts.appendChild(open);
      var del = el("button", "btn-link danger", "Borrar");
      del.type = "button";
      del.addEventListener("click", function () { remove(t); });
      acts.appendChild(del);
      row.appendChild(acts);
      box.appendChild(row);
    });
  }

  async function load() {
    try {
      render(await api("GET", "/api/tournaments"));
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo conectar con el servidor");
    }
  }

  async function create() {
    var name = $("fName").value.trim();
    if (!name) { toast("Escribe el nombre del torneo"); return; }
    try {
      var t = await api("POST", "/api/tournaments", {
        name: name,
        start_date: $("fStart").value || null,
        end_date: $("fEnd").value || null,
        location: $("fPlace").value.trim() || null,
        status: "en_curso"
      });
      location.href = "/static/torneo.html?id=" + t.id;
    } catch (e) {
      console.error(e);
      toast("⚠ " + e.message);
    }
  }

  async function remove(t) {
    if (!confirm("¿Borrar el torneo \"" + t.name + "\" con todos sus juegos? Los equipos se conservan.")) return;
    try {
      await api("DELETE", "/api/tournaments/" + t.id);
      toast("Torneo borrado");
      await load();
    } catch (e) {
      console.error(e);
      toast("⚠ " + e.message);
    }
  }

  $("createBtn").addEventListener("click", create);
  load();
})();