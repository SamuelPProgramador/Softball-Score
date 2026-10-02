(function () {
  var editingId = null;
  var players = [];
  var photoAction = "keep";   // keep = no tocar | set = nueva foto | remove = quitar
  var photoData = null;

  function photoUrl(p) { return "/api/players/" + p.id + "/photo?v=" + p.photo_v; }

  function setPhotoPreview(src) {
    var prev = document.getElementById("photoPrev");
    prev.style.display = src ? "" : "none";
    document.getElementById("rmPhoto").style.display = src ? "" : "none";
    if (src) prev.src = src; else prev.removeAttribute("src");
  }

  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._tm);
    toast._tm = setTimeout(function () { t.classList.remove("show"); }, 1600);
  }

  async function api(method, url, body) {
    var opts = { method: method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    var res = await fetch(url, opts);
    if (!res.ok) throw new Error(method + " " + url + " -> " + res.status);
    return res.json();
  }

  function resetForm() {
    editingId = null;
    document.getElementById("fName").value = "";
    document.getElementById("fNumber").value = "";
    document.getElementById("fPos").value = "";
    document.getElementById("formTitle").textContent = "Nuevo jugador";
    document.getElementById("cancelBtn").style.display = "none";
    photoAction = "keep";
    photoData = null;
    setPhotoPreview(null);
  }

  function startEdit(p) {
    editingId = p.id;
    document.getElementById("fName").value = p.name;
    document.getElementById("fNumber").value = p.number == null ? "" : p.number;
    document.getElementById("fPos").value = p.position || "";
    document.getElementById("formTitle").textContent = "Editar jugador";
    document.getElementById("cancelBtn").style.display = "";
    photoAction = "keep";
    photoData = null;
    setPhotoPreview(p.photo_v ? photoUrl(p) : null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderList() {
    var list = document.getElementById("playerList");
    list.innerHTML = "";
    if (players.length === 0) {
      var empty = document.createElement("div");
      empty.className = "lineup-row";
      empty.textContent = "Aún no hay jugadores registrados.";
      list.appendChild(empty);
      return;
    }
    players.forEach(function (p) {
      var row = document.createElement("div");
      row.className = "lineup-row";

      var num = document.createElement("span");
      num.className = "lineup-num";
      num.textContent = p.number == null ? "–" : "#" + p.number;

      var name = document.createElement("span");
      name.className = "lineup-name";
      name.textContent = p.name;

      var pos = document.createElement("span");
      pos.className = "lineup-pos";
      pos.textContent = p.position || "";

      var edit = document.createElement("button");
      edit.className = "btn-link";
      edit.textContent = "Editar";
      edit.addEventListener("click", function () { startEdit(p); });

      var del = document.createElement("button");
      del.className = "btn-link danger";
      del.textContent = "Quitar";
      del.addEventListener("click", function () { removePlayer(p); });

      var av;
      if (p.photo_v) {
        av = document.createElement("img");
        av.src = photoUrl(p);
        av.alt = "";
      } else {
        av = document.createElement("span");
        av.textContent = (p.name || "?").trim().charAt(0).toUpperCase();
      }
      av.className = "avatar avatar-sm" + (p.photo_v ? "" : " avatar-empty");
      row.appendChild(av);
      row.appendChild(num);
      row.appendChild(name);
      row.appendChild(pos);
      row.appendChild(edit);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  async function load() {
    try {
      players = await api("GET", "/api/players");
      renderList();
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo conectar con el servidor");
    }
  }

  async function save() {
    var name = document.getElementById("fName").value.trim();
    var numRaw = document.getElementById("fNumber").value;
    var pos = document.getElementById("fPos").value;
    if (!name) { toast("Escribe el nombre del jugador"); return; }
    var body = {
      name: name,
      number: numRaw === "" ? null : parseInt(numRaw, 10),
      position: pos || null
    };
    if (photoAction === "set") body.photo = photoData;
    else if (photoAction === "remove") body.photo = null;
    try {
      if (editingId) {
        await api("PUT", "/api/players/" + editingId, body);
        toast("Jugador actualizado");
      } else {
        await api("POST", "/api/players", body);
        toast("Jugador agregado");
      }
      resetForm();
      await load();
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo guardar");
    }
  }

  async function removePlayer(p) {
    if (!confirm("¿Quitar a " + p.name + " del plantel? Sus estadísticas anteriores se conservan.")) return;
    try {
      await api("DELETE", "/api/players/" + p.id);
      if (editingId === p.id) resetForm();
      await load();
      toast("Jugador quitado");
    } catch (e) {
      console.error(e);
      toast("⚠ No se pudo quitar");
    }
  }

  document.getElementById("saveBtn").addEventListener("click", save);
  document.getElementById("cancelBtn").addEventListener("click", resetForm);
  document.getElementById("fPhoto").addEventListener("change", async function () {
    var input = this;
    var file = input.files[0];
    if (!file) return;
    try {
      photoData = await window.resizeImage(file, 256, "image/jpeg", 0.85);
      photoAction = "set";
      setPhotoPreview(photoData);
    } catch (e) {
      toast("⚠ " + e.message);
    }
    input.value = "";
  });
  document.getElementById("rmPhoto").addEventListener("click", function () {
    photoAction = "remove";
    photoData = null;
    setPhotoPreview(null);
  });
  load();
})();