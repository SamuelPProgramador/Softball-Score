(function () {
  var items = [
    { key: "dashboard",    label: "Dashboard",    href: null },
    { key: "jugadores",    label: "Jugadores",    href: "/static/jugadores.html" },
    { key: "juegos",       label: "Juegos",       href: "/static/juegos.html" },
    { key: "estadisticas", label: "Estadísticas", href: "/static/estadisticas.html" },
    { key: "comparar",     label: "Comparar",     href: "/static/comparar.html" },
    { key: "temporadas",   label: "Temporadas",   href: "/static/temporadas.html" },
    { key: "reportes",     label: "Reportes",     href: "/static/reportes.html" }
  ];

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
})();