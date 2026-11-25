/* Da_'s UmaTools — shared navbar.
 * Injected as the first child of <body> on every page. The site root is
 * derived from this script's own URL, so it works from any subdirectory
 * and under any hosting subpath.
 */
(function () {
  "use strict";
  const script = document.currentScript;
  const root = new URL("..", script.src).href; // assets/.. → site root

  const TOOLS = [
    ["eyeuma", "👁️ EyeUma"],
    ["completionist", "🏆 Completionist"],
    ["umatree", "🌳 UmaTree"],
    ["tt-tracker", "🤖 Team Trials"],
    ["master-browser", "🗄️ Master Browser"],
    ["torena-notes", "📝 Torena's Notes"],
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
    `<div class="ut-links">` +
    TOOLS.map(([folder, label]) =>
      `<a href="${root}${folder}/index.html" data-label="${label}"${folder === active ? ' class="active" aria-current="page"' : ""}>${label}</a>`
    ).join("") +
    `</div>`;
  document.body.insertBefore(nav, document.body.firstChild);

  // Keep the active link visible when the nav overflows on small screens.
  // Scroll only the links container — never the page itself.
  const activeLink = nav.querySelector("a.active");
  const links = nav.querySelector(".ut-links");
  if (activeLink) links.scrollLeft = activeLink.offsetLeft - (links.clientWidth - activeLink.offsetWidth) / 2;
})();
