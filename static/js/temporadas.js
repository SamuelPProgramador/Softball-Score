(function () {
  var seasons = [];

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

  function record(s) {
    if (s.finished === 0) return "Sin juegos finalizados";
    return "Récord " + s.wins + "-" + s.losses + (s.ties ? "-" + s.ties : "");
  }

  function render() {
    var box = $("seasonList");
    box.innerHTML = "";
    seasons.forEach(function (s) {
      var row = el("div", "lineup-row game-row");

      var name = el("div", "lineup-name", s.name);
      row.appendChild(name);
      if (s.active) row.appendChild(el("span", "badge live", "ACTIVA"));

      row.appendChild(el("span", "lineup-stat", s.games + (s.games === 1 ? " juego" : " juegos")));
      row.appendChild(el("span", "lineup-stat", record(s)));

      var acts = el("div", "game-actions");

      var stats = el("a", "btn-link", "Estadísticas");
      stats.href = "/static/estadisticas.html?season=" + s.id;
      acts.appendChild(stats);

      var ren = el("button", "btn-link", "Renombrar");
      ren.type = "button";
      ren.addEventListener("click", function () { rename(s); });
      acts.appendChild(ren);

      if (!s.active) {
        var act = el("button", "btn-link", "Activar");
        act.type = "button";
        act.addEventListener("click", function () { activate(s); });
        acts.appendChild(act);
      }

      row.appendChild(acts);
      box.appendChild(row);
    });
  }

  async function load() {
    try {
      seasons = await api("GET", "/api/seasons");
      render();
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo conectar con el servidor");
    }
  }

  async function create() {
    var name = $("fName").value.trim();
    if (!name) { toast("Escribe el nombre de la temporada"); return; }
    if (!confirm("Se creará \"" + name + "\" y pasará a ser la temporada activa. ¿Continuar?")) return;
    try {
      await api("POST", "/api/seasons", { name: name });
      $("fName").value = "";
      toast("Temporada creada");
      await load();
    } catch (e) {
      console.error(e);
      toast("⚠ " + e.message);
    }
  }

  async function rename(s) {
    var name = prompt("Nuevo nombre de la temporada:", s.name);
    if (name === null) return;
    name = name.trim();
    if (!name) { toast("El nombre no puede quedar vacío"); return; }
    try {
      await api("PUT", "/api/seasons/" + s.id, { name: name });
      toast("Nombre actualizado");
      await load();
    } catch (e) {
      console.error(e);
      toast("⚠ " + e.message);
    }
  }

  async function activate(s) {
    if (!confirm("¿Activar \"" + s.name + "\"? Los juegos nuevos se guardarán en ella.")) return;
    try {
      await api("POST", "/api/seasons/" + s.id + "/activate");
      toast("Temporada activada");
      await load();
    } catch (e) {
      console.error(e);
      toast("⚠ " + e.message);
    }
  }

  $("createBtn").addEventListener("click", create);
  load();
})();