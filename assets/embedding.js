"use strict";

(() => {
  const embedded = new URLSearchParams(location.search).get("embed") === "1";
  const framed = embedded && window.parent !== window;
  const messageSource = "conceptarc-embedding";
  let embedState = "loading", embedHeight = 0, embedFrame = 0;
  document.documentElement.dataset.viewerState = embedState;
  function notifyParent(event, extra = {}) {
    if (framed) window.parent.postMessage({ source: messageSource, event, ...extra }, location.origin);
  }
  function reportEmbedSize() {
    if (!framed || embedFrame || embedState !== "ready") return;
    embedFrame = requestAnimationFrame(() => {
      embedFrame = 0;
      const height = Math.ceil(document.getElementById("main").getBoundingClientRect().height);
      if (height !== embedHeight) { embedHeight = height; notifyParent("resize", { height }); }
    });
  }
  function setEmbedState(state) {
    embedState = state;
    document.documentElement.dataset.viewerState = state;
    notifyParent(state);
    reportEmbedSize();
  }
  const conceptColors = ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC", "#17BECF", "#BCBD22", "#9467BD", "#8C564B", "#1F77B4", "#E377C2"];
  const gridColors = ["#000000", "#0074d9", "#ff4136", "#2ecc40", "#ffdc00", "#aaaaaa", "#f012be", "#ff851b", "#7fdbff", "#870c25"];
  const fallbackLabels = { AboveBelow: "Above and Below", Center: "Center", CleanUp: "Clean Up", CompleteShape: "Complete Shape", Copy: "Copy", Count: "Count", ExtendToBoundary: "Extend to Boundary", ExtractObjects: "Extract Objects", FilledNotFilled: "Filled and Not Filled", HorizontalVertical: "Horizontal and Vertical", InsideOutside: "Inside and Outside", MoveToBoundary: "Move to Boundary", Order: "Order", SameDifferent: "Same and Different", TopBottom2D: "Top and Bottom 2D", TopBottom3D: "Top and Bottom 3D" };
  const canonical = name => ({ Cleanup: "CleanUp", Extract: "ExtractObjects" }[name] || name);
  const $ = id => document.getElementById(id);
  const canvas = $("plot");
  const context = canvas.getContext("2d");
  const active = new Set();
  const byId = new Map();
  const supportCache = new Map();
  const pointers = new Map();
  let data, labels = { ...fallbackLabels }, initialView, view, dimensions;
  let selected = null, hovered = null, frame = 0, pendingHover = null, selectionVersion = 0;
  let pointRadius = Number($("point-size").value), gesture = null, moved = false, pointerTravel = 0;

  function node(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }

  async function fetchJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
    return response.json();
  }

  function labelFor(index) { return labels[canonical(data.concepts[index])] || data.concepts[index]; }
  function taskId(index) {
    const point = data.points[index], concept = data.concepts[point[2]];
    return `${concept}__${concept}${point[3]}__${String(point[4]).padStart(3, "0")}`;
  }
  function taskLabel(index) {
    const point = data.points[index];
    return `${labelFor(point[2])} · task ${point[3]} · instance ${point[4]}`;
  }

  function setNotice(host, message, retry) {
    host.replaceChildren(node("span", "", message));
    if (retry) {
      const button = node("button", "", "Try again");
      button.type = "button";
      button.addEventListener("click", retry);
      host.append(button);
    }
  }

  async function loadIndex() {
    setEmbedState("loading");
    $("index-status").hidden = false;
    setNotice($("index-status"), "Loading the embedding map…");
    try {
      const results = await Promise.allSettled([fetchJson("data/embedding/index.json"), fetchJson("data/catalog.json")]);
      if (results[0].status !== "fulfilled") throw results[0].reason;
      data = results[0].value;
      if (!Array.isArray(data.points) || !data.points.length || !Array.isArray(data.concepts)) throw new Error("Invalid embedding index");
      if (results[1].status === "fulfilled") {
        for (const concept of results[1].value.concepts || []) labels[concept.id] = concept.label;
      }
      let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
      data.points.forEach((point, index) => {
        xmin = Math.min(xmin, point[0]); xmax = Math.max(xmax, point[0]);
        ymin = Math.min(ymin, point[1]); ymax = Math.max(ymax, point[1]);
        byId.set(taskId(index), index);
      });
      initialView = { cx: (xmin + xmax) / 2, cy: (ymin + ymax) / 2, spanX: (xmax - xmin) * 1.06, spanY: (ymax - ymin) * 1.06 };
      view = { ...initialView };
      buildControls();
      $("index-status").hidden = true;
      $("explorer").hidden = false;
      resize();
      handleRoute();
      setEmbedState("ready");
    } catch (error) {
      setNotice($("index-status"), "The embedding map could not be loaded. Check your connection and try again.", loadIndex);
      setEmbedState("error");
    }
  }

  function buildControls() {
    $("legend").replaceChildren();
    $("pick-concept").replaceChildren();
    data.concepts.forEach((concept, index) => {
      active.add(index);
      const label = node("label", "concept-filter");
      const input = document.createElement("input");
      input.type = "checkbox"; input.checked = true; input.dataset.concept = String(index);
      const swatch = node("span", "concept-swatch");
      swatch.style.backgroundColor = conceptColors[index]; swatch.setAttribute("aria-hidden", "true");
      label.append(input, swatch, node("span", "", labelFor(index)));
      input.addEventListener("change", () => {
        input.checked ? active.add(index) : active.delete(index);
        hovered = null; pendingHover = null; updateCounts(); requestDraw(); updateHint();
      });
      $("legend").append(label);
      const option = node("option", "", labelFor(index)); option.value = String(index);
      $("pick-concept").append(option);
    });
    for (const [id, count] of [["pick-source", 100], ["pick-instance", 8]]) {
      $(id).replaceChildren();
      for (let index = 1; index <= count; index += 1) {
        const option = node("option", "", String(index)); option.value = String(index); $(id).append(option);
      }
    }
    const inside = data.concepts.indexOf("InsideOutside");
    $("pick-concept").value = String(inside === -1 ? 0 : inside);
    $("pick-source").value = "78";
    updateCounts();
  }

  function updateCounts() {
    const count = data.points.reduce((total, point) => total + Number(active.has(point[2])), 0);
    $("visible-count").textContent = `${count.toLocaleString("en-US")} points`;
    $("empty-map").hidden = count !== 0;
  }
  function setAll(show) {
    active.clear();
    if (show) data.concepts.forEach((_, index) => active.add(index));
    $("legend").querySelectorAll("input").forEach(input => { input.checked = show; });
    hovered = null; pendingHover = null; updateCounts(); updateHint(); requestDraw();
  }

  function project(point) {
    const { width, height, pad } = dimensions;
    return [pad + ((point[0] - view.cx) / view.spanX + .5) * (width - pad * 2), pad + (.5 - (point[1] - view.cy) / view.spanY) * (height - pad * 2)];
  }
  function worldAt(x, y) {
    return [view.cx + ((x - dimensions.pad) / (dimensions.width - dimensions.pad * 2) - .5) * view.spanX, view.cy + (.5 - (y - dimensions.pad) / (dimensions.height - dimensions.pad * 2)) * view.spanY];
  }
  function relative(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function nearest(x, y, threshold = 11) {
    let best = null, distance = threshold * threshold;
    data.points.forEach((point, index) => {
      if (!active.has(point[2])) return;
      const [px, py] = project(point), next = (px - x) ** 2 + (py - y) ** 2;
      if (next < distance) { best = index; distance = next; }
    });
    return best;
  }

  function render(target) {
    const { width, height } = dimensions;
    target.clearRect(0, 0, width, height);
    target.fillStyle = "#ffffff"; target.fillRect(0, 0, width, height);
    target.globalAlpha = .58;
    data.points.forEach(point => {
      if (!active.has(point[2])) return;
      const [x, y] = project(point);
      if (x < -pointRadius || y < -pointRadius || x > width + pointRadius || y > height + pointRadius) return;
      target.fillStyle = conceptColors[point[2]];
      target.beginPath(); target.arc(x, y, pointRadius, 0, Math.PI * 2); target.fill();
    });
    target.globalAlpha = 1;
    for (const index of [selected, hovered]) {
      if (index === null || !active.has(data.points[index][2])) continue;
      const [x, y] = project(data.points[index]);
      target.beginPath(); target.arc(x, y, Math.max(5.5, pointRadius + 3), 0, Math.PI * 2);
      target.strokeStyle = "#ffffff"; target.lineWidth = 4; target.stroke();
      target.strokeStyle = "#172d39"; target.lineWidth = 1.6; target.stroke();
    }
  }

  function requestDraw() {
    if (frame || !data || !dimensions) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (pendingHover && !pointers.size) {
        hovered = nearest(pendingHover.x, pendingHover.y); pendingHover = null;
        canvas.style.cursor = hovered === null ? "grab" : "pointer"; updateHint();
      }
      render(context);
    });
  }
  function resize() {
    if (!data || $("explorer").hidden) return;
    const rect = canvas.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    dimensions = { width: rect.width, height: rect.height, pad: 24 };
    requestDraw();
  }
  function updateHint() {
    $("point-hint").textContent = hovered !== null ? taskLabel(hovered) : selected !== null ? `Selected: ${taskLabel(selected)}` : "Select a point to inspect its demonstrations.";
  }

  function zoom(factor, x = dimensions.width / 2, y = dimensions.height / 2) {
    const before = worldAt(x, y);
    const ratio = Math.max(.002, Math.min(20, view.spanX / initialView.spanX * factor));
    view.spanX = initialView.spanX * ratio; view.spanY = initialView.spanY * ratio;
    const after = worldAt(x, y);
    view.cx += before[0] - after[0]; view.cy += before[1] - after[1];
    hovered = null; pendingHover = null; updateHint(); requestDraw();
  }
  function pan(dx, dy) {
    view.cx -= dx * view.spanX / (dimensions.width - dimensions.pad * 2);
    view.cy += dy * view.spanY / (dimensions.height - dimensions.pad * 2);
    requestDraw();
  }
  function resetView() { view = { ...initialView }; hovered = null; updateHint(); requestDraw(); }

  function navigateTo(index) {
    const hash = `#/task/${encodeURIComponent(taskId(index))}`;
    if (framed) {
      // Only the parent adds a history entry. Keeping the child route via replace
      // avoids two Back presses for each selection in a joint browsing history.
      history.replaceState(null, "", hash);
      showTask(index);
      notifyParent("selection", { task: taskId(index) });
    } else if (location.hash === hash) showTask(index);
    else location.hash = hash;
  }
  function handleRoute() {
    if (!data) return;
    const hash = location.hash;
    if (!hash || hash === "#/" || hash === "#" || hash === "#main") {
      selected = null; selectionVersion += 1; $("selection-heading").hidden = true; $("supports").replaceChildren();
      setNotice($("support-status"), "Click a point on the map, or choose a source task and instance above.");
      updateHint(); requestDraw(); return;
    }
    let id;
    try { id = hash.startsWith("#/task/") ? decodeURIComponent(hash.slice(7)) : null; } catch { id = null; }
    const index = byId.get(id);
    if (index === undefined) {
      selected = null; selectionVersion += 1; $("selection-heading").hidden = true; $("supports").replaceChildren();
      setNotice($("support-status"), "That task instance could not be found. Choose a task above to continue.");
      updateHint(); requestDraw(); return;
    }
    showTask(index);
  }

  async function loadSupports(concept) {
    if (!supportCache.has(concept)) {
      const request = fetchJson(`data/embedding/${encodeURIComponent(concept)}.json`).catch(error => {
        supportCache.delete(concept); throw error;
      });
      supportCache.set(concept, request);
    }
    return supportCache.get(concept);
  }

  async function showTask(index) {
    selected = index; hovered = null; pendingHover = null;
    const token = ++selectionVersion, point = data.points[index], concept = canonical(data.concepts[point[2]]);
    if (!active.has(point[2])) {
      active.add(point[2]);
      $("legend").querySelector(`input[data-concept="${point[2]}"]`).checked = true;
      updateCounts();
    }
    $("pick-concept").value = String(point[2]); $("pick-source").value = String(point[3]); $("pick-instance").value = String(point[4]);
    $("selection-heading").hidden = false;
    $("task-title").textContent = taskLabel(index);
    $("task-id").textContent = taskId(index);
    $("source-link").href = `data_viewer.html#/concept/${encodeURIComponent(concept)}/task/${encodeURIComponent(`${concept}${point[3]}_001`)}`;
    $("supports").replaceChildren();
    setNotice($("support-status"), "Loading this task’s demonstrations…");
    const [x, y] = project(point);
    if (x < 0 || x > dimensions.width || y < 0 || y > dimensions.height) { view.cx = point[0]; view.cy = point[1]; }
    updateHint(); requestDraw();
    try {
      const payload = await loadSupports(concept);
      if (token !== selectionVersion) return;
      const pairs = payload.supports[String(index)];
      if (!Array.isArray(pairs) || pairs.length !== 3) throw new Error("Missing support examples");
      const fragment = document.createDocumentFragment();
      pairs.forEach((pair, supportIndex) => fragment.append(supportCard(index, supportIndex, pair)));
      $("supports").replaceChildren(fragment);
      $("support-status").replaceChildren();
    } catch (error) {
      if (token !== selectionVersion) return;
      supportCache.delete(concept);
      setNotice($("support-status"), "The demonstrations could not be loaded. The map is still available.", () => showTask(index));
    }
  }

  function decode(encoded) {
    const pieces = encoded.split("."), rows = parseInt(pieces[0], 16), cols = parseInt(pieces[1], 16), values = [];
    for (const run of pieces.slice(2).join(".").split(",")) {
      const [value, count] = run.split(".").map(number => parseInt(number, 16));
      if (!Number.isInteger(value) || value < 0 || value >= gridColors.length || !Number.isInteger(count) || count < 1) throw new Error("Invalid grid data");
      for (let index = 0; index < count; index += 1) values.push(value);
    }
    if (!rows || !cols || values.length !== rows * cols) throw new Error("Invalid grid dimensions");
    return { rows, cols, values };
  }
  function innerGridPath({ rows, cols }) {
    const lines = [];
    for (let col = 1; col < cols; col++) lines.push(`M${col} 0V${rows}`);
    for (let row = 1; row < rows; row++) lines.push(`M0 ${row}H${cols}`);
    return lines.join(" ");
  }
  function gridMarkup(grid) {
    const cells = grid.values.map((value, index) =>
      `<rect x="${index % grid.cols}" y="${Math.floor(index / grid.cols)}" width="1" height="1" fill="${gridColors[value]}"/>`
    );
    cells.push(`<path d="${innerGridPath(grid)}" fill="none" stroke="#cccccc" stroke-width="0.5" vector-effect="non-scaling-stroke" shape-rendering="geometricPrecision"/>`);
    return `<g shape-rendering="crispEdges">${cells.join("")}</g>`;
  }
  function supportGrid(encoded, label) {
    const grid = decode(encoded);
    const output = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    output.setAttribute("class", "support-grid");
    output.setAttribute("viewBox", `0 0 ${grid.cols} ${grid.rows}`);
    output.setAttribute("role", "img");
    output.setAttribute("aria-label", `${label}, ${grid.rows} rows by ${grid.cols} columns`);
    output.innerHTML = gridMarkup(grid);
    return output;
  }
  function gridValueDetails(index, supportIndex, pair) {
    const details = node("details", "support-values");
    details.append(node("summary", "", "Grid values"));
    pair.forEach((encoded, side) => {
      const grid = decode(encoded), label = side ? "Output" : "Input";
      const group = node("div", "support-value-block");
      const heading = node("h5", "", `${label} · ${grid.rows} rows × ${grid.cols} columns`);
      heading.id = `values-${index}-${supportIndex}-${side}`;
      const rows = [];
      for (let row = 0; row < grid.rows; row += 1) rows.push(grid.values.slice(row * grid.cols, (row + 1) * grid.cols).join(" "));
      const values = node("pre", "", rows.join("\n"));
      values.setAttribute("aria-labelledby", heading.id);
      values.tabIndex = 0;
      group.append(heading, values); details.append(group);
    });
    details.append(node("p", "support-value-legend", "ARC color values: 0 black · 1 blue · 2 red · 3 green · 4 yellow · 5 gray · 6 pink · 7 orange · 8 light blue · 9 dark red. Each line is one grid row, read left to right."));
    return details;
  }
  function supportCard(index, supportIndex, pair) {
    const card = node("section", "support-card"), heading = node("div", "support-card-heading");
    const button = node("button", "support-export", "Save SVG"); button.type = "button";
    button.setAttribute("aria-label", `Save demonstration ${supportIndex + 1} as SVG`);
    button.addEventListener("click", () => exportSupport(index, supportIndex, pair));
    heading.append(node("h4", "", `Demonstration ${supportIndex + 1}`), button);
    const grids = node("div", "support-pair");
    pair.forEach((encoded, side) => {
      const box = node("div", "support-grid-box"), label = side ? "Output" : "Input";
      box.append(node("span", "support-grid-label", label), supportGrid(encoded, `Demonstration ${supportIndex + 1} ${label.toLowerCase()}`));
      if (side) { const arrow = node("span", "support-arrow", "→"); arrow.setAttribute("aria-hidden", "true"); grids.append(arrow); }
      grids.append(box);
    });
    card.append(heading, grids, gridValueDetails(index, supportIndex, pair)); return card;
  }

  function escapeXml(value) { return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character])); }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("export-status").textContent = "Export prepared.";
  }
  function exportPng() {
    if (!dimensions) return;
    const output = document.createElement("canvas"); output.width = Math.round(dimensions.width * 3); output.height = Math.round(dimensions.height * 3);
    const ctx = output.getContext("2d"); ctx.scale(3, 3); render(ctx);
    output.toBlob(blob => { if (blob) download(blob, "varc-task-embeddings.png"); }, "image/png");
  }
  function exportSvg() {
    if (!dimensions) return;
    const { width, height } = dimensions;
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * 3)}" height="${Math.round(height * 3)}" viewBox="0 0 ${width} ${height}"><title>VARC task-instance embeddings — current view</title><desc>Cosine UMAP projection. Colors identify concept categories. Current concept filters and zoom are preserved.</desc><defs><clipPath id="frame"><rect width="${width}" height="${height}"/></clipPath></defs><rect width="100%" height="100%" fill="#fff"/><g clip-path="url(#frame)">`];
    data.points.forEach(point => {
      if (!active.has(point[2])) return;
      const [x, y] = project(point);
      if (x < -pointRadius || y < -pointRadius || x > width + pointRadius || y > height + pointRadius) return;
      parts.push(`<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${pointRadius}" fill="${conceptColors[point[2]]}" fill-opacity=".58"/>`);
    });
    for (const index of [selected, hovered]) {
      if (index === null || !active.has(data.points[index][2])) continue;
      const [x, y] = project(data.points[index]), radius = Math.max(5.5, pointRadius + 3);
      parts.push(`<circle cx="${x}" cy="${y}" r="${radius}" fill="none" stroke="#fff" stroke-width="4"/><circle cx="${x}" cy="${y}" r="${radius}" fill="none" stroke="#172d39" stroke-width="1.6"/>`);
    }
    parts.push("</g></svg>");
    download(new Blob([parts.join("")], { type: "image/svg+xml;charset=utf-8" }), "varc-task-embeddings.svg");
  }
  function exportGrid(encoded, x, y, size) {
    const grid = decode(encoded);
    return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#000"/><svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 ${grid.cols} ${grid.rows}">${gridMarkup(grid)}</svg>`;
  }
  function exportSupport(index, supportIndex, pair) {
    const title = escapeXml(`${taskLabel(index)} · demonstration ${supportIndex + 1}`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="978" height="520" viewBox="0 0 978 520"><title>${title}</title><rect width="100%" height="100%" fill="#fff"/><g font-family="system-ui,sans-serif" fill="#172d39"><text x="28" y="30" font-size="15">${title}</text><text x="28" y="65" font-size="13">Input</text><text x="530" y="65" font-size="13">Output</text><text x="489" y="295" text-anchor="middle" font-size="24">→</text></g>${exportGrid(pair[0], 28, 80, 420)}${exportGrid(pair[1], 530, 80, 420)}</svg>`;
    download(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${taskId(index)}_support_${supportIndex + 1}.svg`);
  }

  function gestureState() {
    const points = [...pointers.values()];
    if (points.length < 2) return { ...points[0], distance: 0 };
    return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2, distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) };
  }
  canvas.addEventListener("pointerdown", event => {
    if (!data || event.button !== 0) return;
    const position = relative(event);
    if (!pointers.size) { moved = false; pointerTravel = 0; canvas.focus({ preventScroll: true }); }
    else moved = true;
    pointers.set(event.pointerId, position); gesture = gestureState();
    canvas.setPointerCapture(event.pointerId); canvas.style.cursor = "grabbing";
    hovered = null; pendingHover = null; updateHint(); requestDraw();
  });
  canvas.addEventListener("pointermove", event => {
    if (!data) return;
    const position = relative(event);
    if (!pointers.has(event.pointerId)) {
      if (event.pointerType === "mouse") { pendingHover = position; requestDraw(); }
      return;
    }
    pointers.set(event.pointerId, position);
    const next = gestureState(), dx = next.x - gesture.x, dy = next.y - gesture.y;
    pointerTravel += Math.abs(dx) + Math.abs(dy);
    if (pointerTravel > 3) moved = true;
    if (next.distance && gesture.distance) zoom(gesture.distance / next.distance, gesture.x, gesture.y);
    pan(dx, dy); gesture = next;
  });
  function endPointer(event, cancelled) {
    if (!pointers.has(event.pointerId)) return;
    const wasTap = pointers.size === 1 && !moved && !cancelled;
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    gesture = pointers.size ? gestureState() : null;
    canvas.style.cursor = pointers.size ? "grabbing" : "grab";
    if (wasTap) {
      const position = relative(event), index = nearest(position.x, position.y, event.pointerType === "touch" ? 22 : 11);
      if (index !== null) navigateTo(index);
    }
  }
  canvas.addEventListener("pointerup", event => endPointer(event, false));
  canvas.addEventListener("pointercancel", event => endPointer(event, true));
  canvas.addEventListener("pointerleave", () => { if (!pointers.size) { hovered = null; pendingHover = null; updateHint(); requestDraw(); } });
  canvas.addEventListener("wheel", event => {
    if (!dimensions) return;
    // Allow normal page scrolling over the inline map. Modified scrolling and
    // trackpad pinch still zoom, as do the visible and keyboard controls.
    if (framed && !event.ctrlKey && !event.metaKey) return;
    event.preventDefault(); const position = relative(event);
    zoom(Math.exp(Math.max(-200, Math.min(200, event.deltaY)) * .002), position.x, position.y);
  }, { passive: false });
  canvas.addEventListener("dblclick", resetView);
  canvas.addEventListener("keydown", event => {
    if (!dimensions) return;
    const step = 40;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "0", "Enter"].includes(event.key)) event.preventDefault();
    if (event.key === "ArrowLeft") pan(step, 0);
    else if (event.key === "ArrowRight") pan(-step, 0);
    else if (event.key === "ArrowUp") pan(0, step);
    else if (event.key === "ArrowDown") pan(0, -step);
    else if (event.key === "+" || event.key === "=") zoom(1 / 1.35);
    else if (event.key === "-") zoom(1.35);
    else if (event.key === "0") resetView();
    else if (event.key === "Enter") {
      const index = nearest(dimensions.width / 2, dimensions.height / 2, Infinity);
      if (index !== null) navigateTo(index);
    }
  });
  $("task-picker").addEventListener("submit", event => {
    event.preventDefault();
    const concept = data.concepts[Number($("pick-concept").value)];
    const id = `${concept}__${concept}${$("pick-source").value}__${String($("pick-instance").value).padStart(3, "0")}`;
    const index = byId.get(id);
    if (index !== undefined) navigateTo(index);
  });
  $("show-all").addEventListener("click", () => setAll(true));
  $("hide-all").addEventListener("click", () => setAll(false));
  $("restore-concepts").addEventListener("click", () => setAll(true));
  $("zoom-in").addEventListener("click", () => zoom(1 / 1.35));
  $("zoom-out").addEventListener("click", () => zoom(1.35));
  $("reset-view").addEventListener("click", resetView);
  $("point-size").addEventListener("input", () => { pointRadius = Number($("point-size").value); $("point-size-value").value = String(pointRadius); requestDraw(); });
  $("export-png").addEventListener("click", exportPng);
  $("export-svg").addEventListener("click", exportSvg);
  window.addEventListener("hashchange", handleRoute);
  document.querySelector(".skip-link").addEventListener("click", event => { event.preventDefault(); $("main").focus(); });
  if (embedded) {
    $("source-link").target = "_top";
    $("map-instructions").textContent = "Hold Ctrl or ⌘ while scrolling to zoom, or pinch; drag to pan. With the map focused, use arrow keys to pan, +/− to zoom, and 0 to reset. You can also select any task with the controls alongside.";
  }
  if (framed) {
    window.addEventListener("message", event => {
      if (event.source !== window.parent || event.origin !== location.origin || event.data?.source !== "conceptarc-embedding-parent") return;
      if (event.data.event === "route") {
        const task = event.data.task;
        if (task !== null && (typeof task !== "string" || !/^[A-Za-z0-9_]+$/.test(task) || task.length > 200)) return;
        const hash = task ? `#/task/${encodeURIComponent(task)}` : "#/";
        if (location.hash !== hash) { history.replaceState(null, "", hash); handleRoute(); }
      } else if (event.data.event === "focus" && embedState === "ready") {
        $("show-all").focus({ preventScroll: true });
      }
    });
    new ResizeObserver(reportEmbedSize).observe($("main"));
  }
  new ResizeObserver(resize).observe(canvas);
  loadIndex();
})();
