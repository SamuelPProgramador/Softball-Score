(function () {
  var logo = null;   // data URL del logo actual

  function $(id) { return document.getElementById(id); }
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

  function showLogo() {
    $("logoPrev").style.display = logo ? "" : "none";
    $("rmLogo").style.display = logo ? "" : "none";
    if (logo) $("logoPrev").src = logo;
  }

  async function load() {
    try {
      var t = await api("GET", "/api/team");
      $("fName").value = t.name;
      $("fColor").value = t.color || "#E0AE45";
      logo = t.logo || null;
      showLogo();
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo conectar con el servidor");
    }
  }

  async function save() {
    var name = $("fName").value.trim();
    if (!name) { toast("Escribe el nombre del equipo"); return; }
    try {
      var saved = await api("PUT", "/api/team", {
        name: name,
        color: $("fColor").value,
        logo: logo
      });
      try { localStorage.setItem("team", JSON.stringify(saved)); } catch (e) {}
      toast("Equipo guardado");
      setTimeout(function () { location.reload(); }, 600);
    } catch (e) {
      console.error(e);
      toast("⚠ " + e.message);
    }
  }

  $("fLogo").addEventListener("change", async function () {
    var input = this;
    var file = input.files[0];
    if (!file) return;
    try {
      logo = await window.resizeImage(file, 256, "image/png");
      showLogo();
    } catch (e) {
      toast("⚠ " + e.message);
    }
    input.value = "";
  });
  $("rmLogo").addEventListener("click", function () { logo = null; showLogo(); });
  $("saveBtn").addEventListener("click", save);
  load();
})();