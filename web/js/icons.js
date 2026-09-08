// Lucide icon renderer.
// Renders static <i data-lucide="..."> placeholders on DOMContentLoaded, and
// exposes renderIcons(root) for icons injected dynamically (ag-grid cells,
// innerHTML) — call it right after inserting the markup.
function renderIcons(root) {
  if (window.lucide) lucide.createIcons(root ? { root } : undefined);
}
document.addEventListener('DOMContentLoaded', function () { renderIcons(); });
