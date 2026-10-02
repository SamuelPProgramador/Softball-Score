(function () {
  var items = [
    { key: "dashboard",    label: "Dashboard",    href: "/static/dashboard.html" },
    { key: "jugadores",    label: "Jugadores",    href: "/static/jugadores.html" },
    { key: "juegos",       label: "Juegos",       href: "/static/juegos.html" },
    { key: "estadisticas", label: "Estadísticas", href: "/static/estadisticas.html" },
    { key: "comparar",     label: "Comparar",     href: "/static/comparar.html" },
    { key: "temporadas",   label: "Temporadas",   href: "/static/temporadas.html" },
    { key: "reportes",     label: "Reportes",     href: "/static/reportes.html" },
    { key: "equipo",       label: "Equipo",       href: "/static/equipo.html" }
  ];
  var DEFAULT_TEAM = { name: "Mi Equipo", color: "#E0AE45", logo: null };

  var host = document.getElementById("mainnav");
  if (!host) return;
  var current = document.body.dataset.page;
  document.body.classList.add("has-sidebar");

  var toggle = document.createElement("button");
  toggle.className = "sidebar-toggle";
  toggle.setAttribute("aria-label", "Abrir menú");
  toggle.textContent = "☰";

  var backdrop = document.createElement("div");
  backdrop.className = "sidebar-backdrop";

  var side = document.createElement("aside");
  side.className = "sidebar";

  var brand = document.createElement("div");
  brand.className = "sidebar-brand";
  brand.textContent = "STATS";
  side.appendChild(brand);

  var teamBox = document.createElement("div");
  teamBox.className = "sidebar-team";
  var logoEl = document.createElement("img");
  logoEl.className = "sidebar-logo";
  logoEl.alt = "";
  var nameEl = document.createElement("span");
  nameEl.className = "sidebar-teamname";
  teamBox.appendChild(logoEl);
  teamBox.appendChild(nameEl);
  side.appendChild(teamBox);

  items.forEach(function (it) {
    var el;
    if (it.href) {
      el = document.createElement("a");
      el.href = it.href;
    } else {
      el = document.createElement("span");
      el.className = "disabled";
      el.title = "Próximamente";
    }
    el.classList.add("mainnav-link");
    if (it.key === current) el.classList.add("active");
    el.textContent = it.label;
    side.appendChild(el);
  });

  function setOpen(open) {
    side.classList.toggle("open", open);
    backdrop.classList.toggle("show", open);
  }
  toggle.addEventListener("click", function () { setOpen(!side.classList.contains("open")); });
  backdrop.addEventListener("click", function () { setOpen(false); });

  host.appendChild(toggle);
  host.appendChild(backdrop);
  host.appendChild(side);

  // ---- Identidad del equipo ----
  function applyTeam(t) {
    document.documentElement.style.setProperty("--amber", t.color || DEFAULT_TEAM.color);
    nameEl.textContent = t.name || DEFAULT_TEAM.name;
    if (t.logo) { logoEl.src = t.logo; logoEl.style.display = ""; }
    else { logoEl.removeAttribute("src"); logoEl.style.display = "none"; }
  }

  var cached = null;
  try { cached = JSON.parse(localStorage.getItem("team") || "null"); } catch (e) {}
  applyTeam(cached || DEFAULT_TEAM);

  // Las demás páginas pueden esperar esto para usar el nombre del equipo
  window.teamReady = fetch("/api/team")
    .then(function (r) { if (!r.ok) throw new Error("team"); return r.json(); })
    .then(function (t) {
      window.TEAM = t;
      applyTeam(t);
      try { localStorage.setItem("team", JSON.stringify(t)); } catch (e) {}
      return t;
    })
    .catch(function () {
      window.TEAM = cached || DEFAULT_TEAM;
      return window.TEAM;
    });
})();