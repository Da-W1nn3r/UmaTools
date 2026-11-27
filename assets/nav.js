/* Da_'s UmaTools — shared navbar.
 * Injected as the first child of <body> on every page. The site root is
 * derived from this script's own URL, so it works from any subdirectory
 * and under any hosting subpath.
 *
 * Wide screens: links sit inline in the bar and scroll sideways if needed.
 * Narrow screens (≤900px, see theme.css): links collapse into a dropdown
 * panel opened by the Menu button; the bar keeps its collapsed height so
 * sticky tool headers still line up.
 */
(function () {
  "use strict";
  const script = document.currentScript;
  const root = new URL("..", script.src).href; // assets/.. → site root

  // [ folder, icon HTML, name, plain-text icon (used for the bold-width reservation) ]
  const TOOLS = [
    ["eyeuma", "👁️", "EyeUma"],
    ["completionist", "<img src=\"%ASSETS%KingHalo_channel_style.svg\" alt=\"\" class=\"ut-ico\">", "Completionist", "🏆"],
    ["umatree", "<img src=\"%ASSETS%rudolf_tree_clean.svg\" alt=\"\" class=\"ut-ico\">", "UmaTree", "🌳"],
    ["tt-tracker", "<img src=\"%ASSETS%nice-nature-clean.svg\" alt=\"\" class=\"ut-ico ut-ico-wide\">", "Team Trials", "🤖"],
    ["master-browser", "🗄️", "Master Browser"],
    ["torena-notes", "📝", "Torena's Notes"],
  ];

  // Which tool are we in? (folder name appears in the page path)
  const path = location.pathname;
  let active = "";
  for (const [folder] of TOOLS) {
    if (path.includes("/" + folder + "/")) { active = folder; break; }
  }
  if (active) document.body.dataset.tool = active;

  const nav = document.createElement("nav");
  nav.className = "ut-nav";
  nav.setAttribute("aria-label", "UmaTools");
  nav.innerHTML =
    `<a class="ut-brand" href="${root}index.html"><img src="${root}assets/machan_time.svg" alt="">Da_'s <span>UmaTools</span></a>` +
    `<div class="ut-links" id="ut-links">` +
    TOOLS.map(([folder, icon, name, textIco]) =>
      `<a href="${root}${folder}/index.html" data-label="${(textIco || icon) + " " + name}"${folder === active ? ' class="active" aria-current="page"' : ""}>` +
      `<span class="ut-nav-ico">${icon}</span> <span class="ut-nav-name">${name}</span></a>`
    ).join("").replace(/%ASSETS%/g, root + "assets/") +
    `</div>` +
    `<button class="ut-toggle" type="button" aria-expanded="false" aria-controls="ut-links"` +
    ` title="Menu" aria-label="Toggle tool menu"></button>`;
  document.body.insertBefore(nav, document.body.firstChild);

  // Click-away layer, only shown while the collapsed menu is open.
  const scrim = document.createElement("div");
  scrim.className = "ut-scrim";
  nav.after(scrim);

  const links = nav.querySelector(".ut-links");
  const toggle = nav.querySelector(".ut-toggle");
  const narrow = window.matchMedia("(max-width: 900px)");

  function isOpen() { return document.body.classList.contains("ut-menu-open"); }
  function setOpen(open) {
    document.body.classList.toggle("ut-menu-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    // Centre the current tool in the freshly-shown panel.
    if (open) {
      const a = links.querySelector("a.active");
      if (a) links.scrollTop = Math.max(0, a.offsetTop - (links.clientHeight - a.offsetHeight) / 2);
    }
  }

  toggle.addEventListener("click", function (e) {
    e.stopPropagation();
    setOpen(!isOpen());
  });
  scrim.addEventListener("click", function () { setOpen(false); });
  // Picking a tool closes the menu (links may navigate, but not for in-page ones).
  links.addEventListener("click", function (e) {
    if (e.target.closest("a") && narrow.matches) setOpen(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) { setOpen(false); toggle.focus(); }
  });
  window.addEventListener("resize", function () {
    if (!narrow.matches && isOpen()) setOpen(false);
  });

  // In the inline (wide) layout, keep the active link visible when the row
  // overflows, and fade whichever edge is cutting links off.
  const activeLink = links.querySelector("a.active");
  function updateFades() {
    const over = !narrow.matches && links.scrollWidth > links.clientWidth + 4;
    links.classList.toggle("ut-fade-l", over && links.scrollLeft > 4);
    links.classList.toggle("ut-fade-r", over && links.scrollLeft < links.scrollWidth - links.clientWidth - 4);
  }
  if (activeLink && links.scrollWidth > links.clientWidth) {
    links.scrollLeft = activeLink.offsetLeft - (links.clientWidth - activeLink.offsetWidth) / 2;
  }
  links.addEventListener("scroll", updateFades, { passive: true });
  window.addEventListener("resize", updateFades);
  updateFades();
})();
