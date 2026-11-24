"use strict";

(() => {
  const host = document.getElementById("inline-embedding");
  const frame = document.getElementById("inline-embedding-frame");
  const status = document.getElementById("inline-embedding-status");
  if (!host || !frame || !status) return;

  const source = new URL(frame.dataset.src, location.href);
  if (source.origin !== location.origin) return;
  let started = false, timer = 0, focusOnReady = false, lastRoute = "";

  function route() {
    if (location.hash === "#embeddings") return { active: true, task: null };
    if (!location.hash.startsWith("#embeddings/task/")) return { active: false, task: null };
    let task;
    try { task = decodeURIComponent(location.hash.slice("#embeddings/task/".length)); } catch { task = ""; }
    return { active: true, task: /^[A-Za-z0-9_]{1,200}$/.test(task) ? task : null };
  }
  function send(event, extra = {}) {
    frame.contentWindow?.postMessage({ source: "conceptarc-embedding-parent", event, ...extra }, source.origin);
  }
  function state(value) {
    host.dataset.state = value;
    host.setAttribute("aria-busy", String(value === "loading" || value === "idle"));
  }
  function notice(message, retry = false) {
    status.hidden = false;
    const copy = document.createElement("p");
    copy.textContent = message;
    status.replaceChildren(copy);
    if (retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button";
      button.textContent = "Try again";
      button.addEventListener("click", () => {
        focusOnReady = document.activeElement === button;
        start(true);
      });
      status.append(button);
    }
  }
  function failed() {
    clearTimeout(timer);
    state("error");
    frame.hidden = true;
    notice("The interactive map could not be loaded. Check your connection and try again.", true);
  }
  function height(value) {
    // The child reports its content box, never the viewport height. Only apply
    // changed whole pixels so an iframe resize cannot feed back into itself.
    if (!Number.isFinite(value) || value < 100 || value > 40000) return;
    const pixels = `${Math.ceil(value)}px`;
    if (frame.style.height !== pixels) frame.style.height = pixels;
  }
  function ready() {
    clearTimeout(timer);
    state("ready");
    frame.hidden = false;
    status.hidden = true;
    const current = route();
    send("route", { task: current.active ? current.task : null });
    if (focusOnReady) { focusOnReady = false; send("focus"); }
  }
  function start(retry = false) {
    if (started && !retry) return;
    started = true;
    state("loading");
    notice("Loading the interactive embedding map…");
    frame.hidden = false;
    const url = new URL(source);
    const current = route();
    if (current.task) url.hash = `#/task/${encodeURIComponent(current.task)}`;
    clearTimeout(timer);
    timer = setTimeout(failed, 25000);
    // The iframe has no src before this point, so neither the viewer nor its
    // data competes with the initial overview and result charts.
    frame.src = url.href;
  }

  window.addEventListener("message", event => {
    if (event.source !== frame.contentWindow || event.origin !== source.origin || event.data?.source !== "conceptarc-embedding") return;
    const message = event.data;
    if (message.event === "ready") ready();
    else if (message.event === "error") failed();
    else if (message.event === "resize") height(message.height);
    else if (message.event === "selection" && typeof message.task === "string" && /^[A-Za-z0-9_]{1,200}$/.test(message.task)) {
      const hash = `#embeddings/task/${encodeURIComponent(message.task)}`;
      if (location.hash !== hash) history.pushState(null, "", hash);
      lastRoute = hash;
    }
  });
  frame.addEventListener("load", () => {
    if (!started || !frame.getAttribute("src")) return;
    // HTML failures and missing scripts may still fire iframe 'load'. Detect
    // those immediately; the timeout covers a connection that never completes.
    try {
      const doc = frame.contentDocument;
      const viewerState = doc?.documentElement.dataset.viewerState;
      if (!doc?.getElementById("plot") || !viewerState) failed();
      else if (viewerState === "ready") {
        height(doc.getElementById("main").getBoundingClientRect().height);
        ready();
      } else if (viewerState === "error") failed();
    } catch { failed(); }
  });
  frame.addEventListener("error", failed);

  function followRoute() {
    if (lastRoute === location.hash) return;
    lastRoute = location.hash;
    const current = route();
    if (!current.active) {
      if (host.dataset.state === "ready") send("route", { task: null });
      return;
    }
    start();
    if (host.dataset.state === "ready") send("route", { task: current.task });
    // A task route is not an element ID. Scroll it directly to the map while
    // retaining ordinary anchor navigation for #embeddings and other sections.
    if (current.task) requestAnimationFrame(() => host.scrollIntoView({ block: "start", behavior: "instant" }));
  }
  window.addEventListener("hashchange", followRoute);
  window.addEventListener("popstate", followRoute);
  followRoute();

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); start(); }
    }, { rootMargin: "600px 0px" });
    observer.observe(host);
  } else start();
})();
