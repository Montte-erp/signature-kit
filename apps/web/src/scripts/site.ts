// Progressive enhancement for the marketing + docs site.
// No framework, no hydration — just small DOM behaviours.

function copyToClipboard(text: string): Promise<boolean> {
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  );
}

function flashCopied(btn: HTMLElement) {
  btn.dataset.copied = "true";
  window.setTimeout(() => {
    btn.dataset.copied = "false";
  }, 1600);
}

function initCopyButtons() {
  document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy") ?? "";
      if (await copyToClipboard(text)) flashCopied(btn);
    });
  });
}

// Copy the rendered article text — real page content, not faked Markdown.
function initCopyArticle() {
  document.querySelectorAll<HTMLButtonElement>("[data-copy-article]").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const article = document.querySelector<HTMLElement>("article.sw-prose");
      const text = article?.innerText?.trim() ?? "";
      if (text && (await copyToClipboard(text))) flashCopied(btn);
    });
  });
}

// Generic tab/tree switcher: any [data-tab] button drives [data-tab-panel].
function initCodeTabs() {
  document.querySelectorAll<HTMLElement>("[data-code-tabs]").forEach((root) => {
    if (root.dataset.bound) return;
    root.dataset.bound = "1";
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-tab]"));
    const panels = Array.from(root.querySelectorAll<HTMLElement>("[data-tab-panel]"));
    const copyBtn = root.querySelector<HTMLButtonElement>("[data-copy]");
    const titleEl = root.querySelector<HTMLElement>("[data-tab-title]");

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.tab;
        buttons.forEach((b) => (b.dataset.active = String(b.dataset.tab === key)));
        panels.forEach((p) => (p.hidden = p.dataset.tabPanel !== key));
        if (titleEl && key) titleEl.textContent = key;
        const active = panels.find((p) => p.dataset.tabPanel === key);
        const code = active?.querySelector("pre")?.textContent;
        if (copyBtn) copyBtn.setAttribute("data-copy", code ?? key ?? "");
      });
    });
  });
}

function initTocSpy() {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".toc-link"));
  if (!links.length) return;
  const byId = new Map<string, HTMLAnchorElement>();
  links.forEach((l) => {
    const id = l.getAttribute("href")?.replace("#", "");
    if (id) byId.set(id, l);
  });
  const targets = Array.from(byId.keys())
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => Boolean(el));

  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((l) => (l.dataset.active = "false"));
        const active = byId.get(entry.target.id);
        if (active) active.dataset.active = "true";
      });
    },
    { rootMargin: "-15% 0px -75% 0px", threshold: 0 },
  );
  targets.forEach((t) => obs.observe(t));
}

function initMobileSidebar() {
  const toggle = document.querySelector<HTMLButtonElement>("[data-sidebar-toggle]");
  const sidebar = document.querySelector<HTMLElement>("[data-sidebar]");
  const overlay = document.querySelector<HTMLElement>("[data-sidebar-overlay]");
  if (!toggle || !sidebar || !overlay) return;
  const open = () => {
    sidebar.dataset.open = "true";
    overlay.dataset.open = "true";
    document.body.style.overflow = "hidden";
  };
  const close = () => {
    sidebar.dataset.open = "false";
    overlay.dataset.open = "false";
    document.body.style.overflow = "";
  };
  toggle.addEventListener("click", open);
  overlay.addEventListener("click", close);
  sidebar.querySelectorAll("a").forEach((a) => a.addEventListener("click", close));
}

function boot() {
  initCopyButtons();
  initCopyArticle();
  initCodeTabs();
  initTocSpy();
  initMobileSidebar();
}

boot();
