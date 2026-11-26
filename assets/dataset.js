"use strict";

(() => {
  const colors = ["#000000", "#0074d9", "#ff4136", "#2ecc40", "#ffdc00", "#aaaaaa", "#f012be", "#ff851b", "#7fdbff", "#870c25"];
  const colorNames = ["black", "blue", "red", "green", "yellow", "gray", "magenta", "orange", "light blue", "maroon"];
  const main = document.getElementById("main");
  const dialog = document.getElementById("enlarged");
  const announcement = document.getElementById("route-status");
  const conceptCache = new Map();
  const searches = new Map();
  const positions = new Map();
  let catalogPromise = null;
  let catalog = null;
  let currentRoute = null;
  let previousHash = location.hash || "#/";
  let gridObserver = null;
  let dialogObserver = null;
  let alternativeObserver = null;
  let renderVersion = 0;

  function node(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }

  function link(text, href, className = "") {
    const result = node("a", className, text);
    result.href = href;
    return result;
  }

  async function fetchJson(path) {
    const response = await fetch(`${path}?v=conceptarc-100-8-20261124`);
    if (!response.ok) throw new Error(`Unable to load ${path}: ${response.status}`);
    return response.json();
  }

  function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = fetchJson("data/catalog.json").then(data => {
        if (!Array.isArray(data.concepts) || !data.concepts.length) throw new Error("Invalid catalog");
        catalog = data;
        return data;
      }).catch(error => { catalogPromise = null; throw error; });
    }
    return catalogPromise;
  }

  function loadConcept(meta) {
    if (!conceptCache.has(meta.id)) {
      const pending = fetchJson(`data/dataset/${encodeURIComponent(meta.id)}.json`).then(data => {
        if (!Array.isArray(data.tasks) || !data.tasks.length || data.tasks.some(task => !Array.isArray(task.variants) || task.variants.length !== 8 || !task.metadata)) throw new Error("Invalid or outdated concept data");
        return {...meta, tasks: data.tasks};
      }).catch(error => { conceptCache.delete(meta.id); throw error; });
      conceptCache.set(meta.id, pending);
    }
    return conceptCache.get(meta.id);
  }

  const conceptUrl = concept => "#/concept/" + encodeURIComponent(concept.id);
  const taskUrl = (concept, task) => conceptUrl(concept) + "/task/" + encodeURIComponent(task.id);
  const pad = index => String(index + 1).padStart(3, "0");

  function breadcrumbs(concept, task) {
    const nav = node("nav", "breadcrumbs");
    nav.setAttribute("aria-label", "Breadcrumb");
    nav.append(link("All concepts", "#/"));
    if (concept) nav.append(node("span", "", "/"), link(concept.label, conceptUrl(concept)));
    if (task) {
      const current = node("span", "", task.id);
      current.setAttribute("aria-current", "page");
      nav.append(node("span", "", "/"), current);
    }
    return nav;
  }

  function pairView(pair, maxHeight = 220, maxCell = 18) {
    const wrapper = node("div", "pair");
    const maxRows = Math.max(pair.input.length, pair.output.length);
    const maxCols = Math.max(pair.input[0].length, pair.output[0].length);
    for (const [index, kind] of ["input", "output"].entries()) {
      if (index) {
        const arrow = node("span", "pair-arrow", "→");
        arrow.setAttribute("aria-hidden", "true");
        wrapper.append(arrow);
      }
      const rows = pair[kind];
      const figure = node("figure", "grid-figure");
      const caption = node("figcaption", "grid-caption");
      caption.append(node("span", "", kind), node("span", "dimensions", `${rows.length} × ${rows[0].length}`));
      const stage = node("div", "grid-stage");
      stage.gridSpec = {rows, maxRows, maxCols, maxHeight, maxCell};
      const canvas = node("canvas");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `${kind} grid, ${rows.length} rows by ${rows[0].length} columns`);
      canvas.textContent = rows.join("\n");
      stage.append(canvas);
      figure.append(caption, stage);
      wrapper.append(figure);
    }
    return wrapper;
  }

  function gridValues(pair) {
    const details = node("details", "grid-values");
    details.append(node("summary", "", "View grid values"));
    const values = node("div", "grid-value-pair");
    for (const kind of ["input", "output"]) {
      const section = node("div");
      const pre = node("pre", "", pair[kind].join("\n"));
      pre.tabIndex = 0;
      pre.setAttribute("aria-label", `${kind} grid values, one row per line`);
      section.append(node("strong", "", kind === "input" ? "Input" : "Output"), pre);
      values.append(section);
    }
    details.append(values, node("p", "", "Each digit is one cell; the color key is at the bottom of the page."));
    return details;
  }

  function drawGrid(stage) {
    const {rows, maxRows, maxCols, maxHeight, maxCell} = stage.gridSpec;
    const cell = Math.min(stage.clientWidth / maxCols, maxHeight / maxRows, maxCell);
    if (cell <= 0) return;
    const canvas = stage.firstElementChild;
    const ratio = window.devicePixelRatio || 1;
    const width = rows[0].length * cell;
    const height = rows.length * cell;
    stage.style.height = `${maxRows * cell}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    const stepX = canvas.width / rows[0].length;
    const stepY = canvas.height / rows.length;
    rows.forEach((row, y) => [...row].forEach((color, x) => {
      context.fillStyle = colors[Number(color)];
      const left = Math.round(x * stepX), top = Math.round(y * stepY);
      context.fillRect(left, top, Math.round((x + 1) * stepX) - left, Math.round((y + 1) * stepY) - top);
    }));
    if (cell >= 5) {
      context.strokeStyle = "rgba(160, 170, 160, 0.40)";
      context.lineWidth = Math.max(0.5, ratio * 0.7);
      context.beginPath();
      for (let x = 1; x < rows[0].length; x++) { context.moveTo(x * stepX, 0); context.lineTo(x * stepX, canvas.height); }
      for (let y = 1; y < rows.length; y++) { context.moveTo(0, y * stepY); context.lineTo(canvas.width, y * stepY); }
      context.stroke();
    }
  }

  function observeGrids(container) {
    const observer = new ResizeObserver(entries => entries.forEach(entry => drawGrid(entry.target)));
    container.querySelectorAll(".grid-stage").forEach(stage => { drawGrid(stage); observer.observe(stage); });
    return observer;
  }

  function preview(pair) {
    const result = node("div", "preview");
    result.append(pairView(pair, 116, 11));
    return result;
  }

  function renderHome() {
    const hero = node("section", "hero");
    const intro = node("div");
    intro.append(node("p", "eyebrow", "ConceptARC-100 / Dataset explorer"), node("h1", "", "Explore the concepts."), node("p", "subtitle", "Sixteen concepts. A hundred different rules for each. Choose a concept to inspect the support examples and test queries illustrating each task."));
    const stats = node("div", "stats");
    const taskCount = catalog.concepts.reduce((sum, concept) => sum + concept.count, 0);
    for (const [value, label] of [[catalog.concepts.length, "concepts"], [taskCount, "tasks"], [10, "queries / task"]]) {
      const stat = node("div", "stat");
      stat.append(node("strong", "", value.toLocaleString("en-US")), node("span", "", label));
      stats.append(stat);
    }
    hero.append(intro, stats);
    const heading = node("div", "section-heading");
    heading.append(node("h2", "", "All concepts"), node("p", "note", "Previews show one support example."));
    const grid = node("div", "concept-grid");
    catalog.concepts.forEach(concept => {
      const card = link("", conceptUrl(concept), "card concept-card");
      const copy = node("div", "card-copy");
      const meta = node("div", "card-meta");
      const count = node("span", "", `${concept.count} tasks`);
      meta.append(count);
      if (concept.type) meta.append(node("span", "concept-type", concept.type));
      const arrow = node("span", "card-arrow", "↗");
      arrow.setAttribute("aria-hidden", "true");
      meta.append(arrow);
      copy.append(node("h3", "", concept.label), meta);
      card.append(preview(concept.preview), copy);
      grid.append(card);
    });
    main.append(hero, heading, grid);
  }

  function renderConcept(concept) {
    main.append(breadcrumbs(concept));
    const heading = node("div", "catalog-heading");
    const intro = node("div");
    intro.append(node("p", "eyebrow", `${concept.type || "Visual reasoning"} concept`), node("h1", "", concept.label), node("p", "subtitle", `${concept.tasks.length} tasks. Select a task to inspect its support examples and test queries.`));
    const search = node("label", "search-label", "Find a task");
    const input = node("input");
    input.type = "search";
    input.placeholder = "Task number or ID…";
    input.value = searches.get(concept.id) || "";
    search.append(input);
    heading.append(intro, search);
    main.append(heading);
    const status = node("p", "note");
    status.setAttribute("role", "status");
    const grid = node("div", "task-grid");
    const empty = node("p", "empty", "No matching tasks. Try another task number or ID.");
    function refresh() {
      if (gridObserver) gridObserver.disconnect();
      searches.set(concept.id, input.value);
      grid.replaceChildren();
      let count = 0;
      const query = input.value.trim().toLowerCase();
      concept.tasks.forEach((task, index) => {
        if (/^\d+$/.test(query) ? index + 1 !== Number(query) : !task.id.toLowerCase().includes(query)) return;
        count++;
        const card = link("", taskUrl(concept, task), "card task-card");
        const copy = node("div", "card-copy");
        copy.append(node("h3", "", `Task ${pad(index)}`), node("p", "task-id", task.id));
        card.append(preview(task.train[0]), copy);
        grid.append(card);
      });
      status.textContent = `${count} of ${concept.tasks.length} tasks · previews show support example 1`;
      empty.hidden = count !== 0;
      gridObserver = observeGrids(grid);
    }
    main.append(status, grid, empty);
    input.addEventListener("input", refresh);
    refresh();
  }

  function stepTask(delta) {
    if (currentRoute?.kind !== "task") return;
    const {concept, index} = currentRoute;
    const next = concept.tasks[index + delta];
    if (next) location.hash = taskUrl(concept, next);
  }

  function pager(concept, index) {
    const result = node("nav", "pager");
    result.setAttribute("aria-label", "Task navigation");
    for (const delta of [-1, 1]) {
      if (delta === 1) result.append(node("span", "pager-count", `${index + 1} / ${concept.tasks.length}`));
      const button = node("button", "button icon-button", delta < 0 ? "←" : "→");
      button.type = "button";
      button.setAttribute("aria-label", delta < 0 ? "Previous task" : "Next task");
      button.title = delta < 0 ? "Previous task (←)" : "Next task (→)";
      button.disabled = !concept.tasks[index + delta];
      button.addEventListener("click", () => stepTask(delta));
      result.append(button);
    }
    return result;
  }

  function enlarge(pair, title) {
    document.getElementById("dialog-title").textContent = title;
    document.getElementById("dialog-body").replaceChildren(pairView(pair, Math.max(180, window.innerHeight - 260), 32), gridValues(pair));
    dialog.showModal();
    if (dialogObserver) dialogObserver.disconnect();
    dialogObserver = observeGrids(dialog);
  }

  function exampleCard(pair, title) {
    const article = node("article", "example");
    const heading = node("div", "example-heading");
    const expand = node("button", "expand", "Enlarge ↗");
    expand.type = "button";
    expand.setAttribute("aria-label", `Enlarge ${title.toLowerCase()}`);
    expand.addEventListener("click", () => enlarge(pair, title));
    heading.append(node("h3", "", title), expand);
    article.append(heading, pairView(pair), gridValues(pair));
    return article;
  }

  function alternativeSupports(task) {
    if (!task.variants || task.variants.length < 2) return null;
    let selected = 0;
    const panel = node("details", "alternative-supports");
    const summary = node("summary", "disclosure-summary");
    summary.append(node("span", "", "Alternative support sets"));
    const body = node("div", "alternative-body");
    const controls = node("div", "support-set-controls");
    const nav = node("nav", "pager");
    nav.setAttribute("aria-label", "Support set navigation");
    const count = node("span", "support-set-count");
    const previous = node("button", "button icon-button", "←");
    const next = node("button", "button icon-button", "→");
    for (const [button, name] of [[previous, "Previous support set"], [next, "Next support set"]]) {
      button.type = "button";
      button.setAttribute("aria-label", name);
      button.title = name;
    }
    nav.append(previous, count, next);
    const status = node("p", "alternative-status note");
    status.id = "alternative-status";
    status.setAttribute("role", "status");
    controls.append(node("p", "note", "Use ← and → to browse all eight sets. Test queries are shared."), nav);
    const grid = node("div", "examples alternative-examples");
    function refresh() {
      if (alternativeObserver) alternativeObserver.disconnect();
      const variant = task.variants[selected];
      previous.disabled = selected === 0;
      next.disabled = selected === task.variants.length - 1;
      count.textContent = `Set ${selected + 1} of ${task.variants.length}`;
      status.textContent = `${variant.id} · ${selected === 0 ? "Human reviewed · Used for evaluation" : "Not human reviewed · For additional studies"}`;
      status.classList.toggle("reviewed", selected === 0);
      grid.replaceChildren(...variant.train.map((pair, index) => exampleCard(pair, `Set ${selected + 1} · Support ${index + 1}`)));
      alternativeObserver = observeGrids(grid);
    }
    function step(delta) {
      if (!task.variants[selected + delta]) return;
      selected += delta;
      refresh();
      if (document.activeElement === previous && previous.disabled) next.focus();
      if (document.activeElement === next && next.disabled) previous.focus();
    }
    previous.addEventListener("click", () => step(-1));
    next.addEventListener("click", () => step(1));
    panel.addEventListener("keydown", event => {
      if (!panel.open || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest("input, textarea, select, pre, [contenteditable]")) return;
      if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        step(event.key === "ArrowLeft" ? -1 : 1);
      }
    });
    panel.addEventListener("toggle", () => {
      if (!panel.isConnected) return;
      if (panel.open) refresh();
      else if (alternativeObserver) alternativeObserver.disconnect();
    });
    body.append(node("p", "note support-review-note", "ConceptARC-100 evaluations use the above support set, which is human reviewed. The seven additional sets are provided for further studies and have not been human reviewed."), controls, status, grid);
    panel.append(summary, body);
    return panel;
  }

  function metadataFieldLabel(key) {
    return key.replace(/_/g, " ").replace(/^./, letter => letter.toUpperCase());
  }

  function metadataProperties(value) {
    const list = node("dl", "metadata-properties");
    for (const [key, child] of Object.entries(value)) {
      if (key === "op" && typeof child === "string") continue;
      const row = node("div", "metadata-property");
      const definition = node("dd");
      definition.append(metadataValue(child, key));
      row.append(node("dt", "", metadataFieldLabel(key)), definition);
      list.append(row);
    }
    return list;
  }

  function metadataValue(value, key) {
    if (Array.isArray(value)) {
      if (!value.length) return node("code", "", "[]");
      const simple = value.every(item => item === null || typeof item !== "object");
      const list = node(simple ? "ul" : "ol", simple ? "metadata-chips" : "metadata-list");
      value.forEach(item => {
        const entry = node("li");
        entry.append(metadataValue(item, key));
        list.append(entry);
      });
      return list;
    }
    if (value !== null && typeof value === "object") {
      if (!Object.keys(value).length) return node("code", "", "{}");
      const branch = node("details", "metadata-branch");
      const summary = node("summary", "metadata-subsummary");
      summary.append(node("code", "metadata-operation", typeof value.op === "string" ? value.op : `${Object.keys(value).length} fields`));
      branch.append(summary, metadataProperties(value));
      return branch;
    }
    const result = node("span", "metadata-value");
    if ((key === "color" || key.endsWith("_color")) && Number.isInteger(value) && value >= 0 && value < colors.length) {
      const swatch = node("span", "metadata-color");
      swatch.style.background = colors[value];
      swatch.setAttribute("aria-hidden", "true");
      result.append(swatch);
    }
    result.append(node("code", "", value === null ? "null" : String(value)));
    return result;
  }

  function programMetadata(task) {
    const spec = task.metadata;
    if (!spec) return null;
    const panel = node("details", "program-metadata");
    const summary = node("summary", "disclosure-summary");
    summary.append(node("span", "", "Program metadata"), node("span", "disclosure-hint", "Description & program"));
    const body = node("div", "metadata-body");
    body.append(node("p", "metadata-description", spec.description));
    const facts = node("dl", "metadata-facts");
    for (const [label, value] of [["Task ID", spec.task_id], ["Concept", spec.concept_name]]) {
      const fact = node("div", "metadata-fact");
      const definition = node("dd");
      definition.append(node("code", "", String(value)));
      fact.append(node("dt", "", label), definition);
      facts.append(fact);
    }
    body.append(facts, node("h3", "metadata-heading", "Program"));
    const components = node("div", "metadata-components");
    for (const key of ["layout", "selector", "action"]) {
      const value = spec.program[key];
      const component = node("details", "metadata-component");
      const heading = node("summary", "metadata-subsummary");
      heading.append(node("span", "metadata-section-label", metadataFieldLabel(key)), node("code", "metadata-operation", value.op));
      component.append(heading, metadataProperties(value));
      components.append(component);
    }
    body.append(components);
    const source = node("p", "metadata-source", "Source: ");
    source.append(node("code", "", `ConceptARC-100-specs/${spec.task_id}.json`));
    body.append(source);
    const raw = node("details", "metadata-raw");
    raw.append(node("summary", "", "View JSON"));
    const pre = node("pre");
    pre.tabIndex = 0;
    pre.setAttribute("aria-label", "Program metadata JSON");
    pre.append(node("code", "", JSON.stringify(spec, null, 2)));
    raw.append(pre);
    body.append(raw);
    panel.append(summary, body);
    return panel;
  }

  function renderTask(concept, task, index) {
    main.append(breadcrumbs(concept, task));
    const heading = node("div", "detail-heading");
    const intro = node("div");
    const title = node("div", "task-title");
    title.append(node("h1", "", `Task ${pad(index)}`), node("span", "badge", concept.label));
    intro.append(title, node("p", "task-id", task.id));
    heading.append(intro, pager(concept, index));
    main.append(heading);
    for (const [split, name, prefix] of [["train", "Support examples", "Support"], ["test", "Test queries", "Test"]]) {
      const section = node("section", split === "test" ? "test-panel" : "support-panel");
      const sectionHeading = node("div", "section-heading");
      const label = node("h2", "", name);
      label.append(node("span", "number", task[split].length));
      sectionHeading.append(label);
      const grid = node("div", "examples");
      task[split].forEach((pair, i) => grid.append(exampleCard(pair, `${prefix} ${i + 1}`)));
      section.append(sectionHeading, grid);
      if (split === "train") {
        const alternatives = alternativeSupports(task);
        if (alternatives) section.append(alternatives);
      }
      main.append(section);
    }
    const bottom = node("div", "bottom-nav");
    bottom.append(link("← All tasks", conceptUrl(concept), "button"), node("span", "note", "Use ← and → to move between tasks"), pager(concept, index));
    main.append(bottom);
    const metadata = programMetadata(task);
    if (metadata) main.append(metadata);
  }

  function route() {
    const hash = location.hash || "#/";
    let parts;
    try { parts = hash.slice(1).split("/").filter(Boolean).map(decodeURIComponent); }
    catch { return {kind: "missing"}; }
    if (!parts.length || hash === "#main") return {kind: "home"};
    const meta = parts[0] === "concept" ? catalog.concepts.find(concept => concept.id === parts[1]) : null;
    if (meta && parts.length === 2) return {kind: "concept", meta};
    if (meta && parts.length === 4 && parts[2] === "task") return {kind: "task", meta, taskId: parts[3]};
    return {kind: "missing"};
  }

  function renderMissing() {
    const section = node("section", "load-state");
    section.append(node("h1", "", "This task could not be found."), node("p", "", "Choose a concept from the catalog to continue exploring."), link("Return to all concepts", "#/", "button"));
    main.append(section);
  }

  function renderError() {
    const section = node("section", "load-state");
    const actions = node("div", "load-actions");
    const retry = node("button", "button", "Try again");
    retry.type = "button";
    retry.addEventListener("click", () => render(true));
    actions.append(retry, link("All concepts", "#/"));
    section.append(node("h1", "", "The dataset could not load."), node("p", "", "Check your connection and try again. Your selected task is still in the address bar."), actions);
    main.replaceChildren(section);
  }

  async function render(focus = false) {
    const version = ++renderVersion;
    const hash = location.hash || "#/";
    currentRoute = null;
    if (gridObserver) gridObserver.disconnect();
    if (alternativeObserver) { alternativeObserver.disconnect(); alternativeObserver = null; }
    if (dialog.open) dialog.close();
    main.setAttribute("aria-busy", "true");
    const loading = node("section", "load-state");
    loading.append(node("p", "eyebrow", "Dataset explorer"), node("h1", "", "Loading…"), node("p", "", "Preparing your view of ConceptARC-100."));
    main.replaceChildren(loading);
    try {
      await loadCatalog();
      if (version !== renderVersion) return;
      let selected = route();
      if (selected.meta) {
        const concept = await loadConcept(selected.meta);
        if (version !== renderVersion) return;
        selected = {...selected, concept};
        if (selected.kind === "task") {
          const index = concept.tasks.findIndex(task => task.id === selected.taskId);
          selected = index < 0 ? {kind: "missing"} : {...selected, index, task: concept.tasks[index]};
        }
      }
      currentRoute = selected;
      main.replaceChildren();
      let title = catalog.name || "ConceptARC-100";
      if (selected.kind === "home") renderHome();
      else if (selected.kind === "concept") { renderConcept(selected.concept); title = `${selected.concept.label} · ${title}`; }
      else if (selected.kind === "task") { renderTask(selected.concept, selected.task, selected.index); title = `${selected.task.id} · ${title}`; }
      else renderMissing();
      document.title = title + " · Dataset explorer";
      if (selected.kind !== "concept") gridObserver = observeGrids(main);
      announcement.textContent = selected.kind === "task" ? `${selected.concept.label}, task ${selected.index + 1} of ${selected.concept.tasks.length}. Support set 1 is human reviewed. Seven alternative support sets and ten shared test queries are available.` : selected.kind === "concept" ? `${selected.concept.label}: ${selected.concept.tasks.length} tasks.` : selected.kind === "home" ? `${catalog.concepts.length} concepts ready to explore.` : "Task not found.";
    } catch (error) {
      if (version !== renderVersion) return;
      renderError();
      announcement.textContent = "Dataset loading failed. Use Try again to retry.";
    } finally {
      if (version === renderVersion) {
        main.setAttribute("aria-busy", "false");
        if (focus) main.focus({preventScroll: true});
        requestAnimationFrame(() => {
          if (version === renderVersion && focus) window.scrollTo(0, currentRoute?.kind === "task" ? 0 : positions.get(hash) || 0);
        });
      }
    }
  }

  const palette = document.getElementById("palette");
  palette.append(node("span", "", "Color key"));
  colors.forEach((color, index) => {
    const swatch = node("span", "swatch");
    swatch.title = `${index}: ${colorNames[index]}`;
    swatch.setAttribute("aria-label", `${index}: ${colorNames[index]}`);
    const chip = node("i");
    chip.style.background = color;
    chip.setAttribute("aria-hidden", "true");
    swatch.append(chip, node("span", "", index));
    palette.append(swatch);
  });
  document.getElementById("close-dialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  dialog.addEventListener("close", () => { if (dialogObserver) dialogObserver.disconnect(); });
  document.addEventListener("keydown", event => {
    if (dialog.open || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.target instanceof Element && event.target.closest("input, textarea, select, pre, [contenteditable]"))) return;
    if (currentRoute?.kind === "task" && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      stepTask(event.key === "ArrowLeft" ? -1 : 1);
    }
  });
  document.querySelector(".dataset-skip").addEventListener("click", event => { event.preventDefault(); main.focus(); });
  window.addEventListener("hashchange", () => {
    positions.set(previousHash, window.scrollY);
    previousHash = location.hash || "#/";
    render(true);
  });
  render();
})();
