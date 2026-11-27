'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const conceptNames = {
    AboveBelow: 'Above and Below', Center: 'Center', FilledNotFilled: 'Filled and Not Filled',
    HorizontalVertical: 'Horizontal and Vertical', InsideOutside: 'Inside and Outside',
    SameDifferent: 'Same and Different', TopBottom2D: 'Top and Bottom 2D', TopBottom3D: 'Top and Bottom 3D',
    CleanUp: 'Clean Up', CompleteShape: 'Complete Shape', Copy: 'Copy', Count: 'Count',
    ExtendToBoundary: 'Extend to Boundary', ExtractObjects: 'Extract Objects', MoveToBoundary: 'Move to Boundary', Order: 'Order'
  };
  const predicateIds = Object.keys(conceptNames).slice(0, 8);
  const actionIds = Object.keys(conceptNames).slice(8);
  const colors = {
    'qwen35-27b': '#0072B2', 'gemma4-31b': '#D55E00', 'gpt-oss-120b': '#009E73',
    'qwen35-9b': '#9366ad', 'gpt-oss-20b': '#bb8524', 'qwen3-32b': '#287782',
    'qwen3-8b': '#be6988', 'phi4-reasoning-plus': '#6d7277', varc: '#163b51', trm: '#a28b62'
  };
  const roleColors = { layout: '#245f71', selector: '#8c78a2', action: '#ab7734', concept: '#489780' };
  const percent = (v, digits = 2) => `${Number(v).toFixed(digits)}%`;
  const accuracyCell = (mean, sd) => `<td>${mean.toFixed(2)}<span class="result-sd"> ± ${sd.toFixed(2)}</span></td>`;
  const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const datasetLink = (id) => `data_viewer.html#/concept/${encodeURIComponent(id)}`;
  let results;
  let selectedModel = 'qwen35-27b';
  const visibleModels = new Set();
  const visibleRoles = new Set(['layout', 'selector', 'action', 'concept']);

  function configureResources() {
    const config = window.CONCEPTARC_CONFIG || {};
    function safeUrl(value) {
      if (!value || typeof value !== 'string') return null;
      try { const url = new URL(value, location.href); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
      catch { return null; }
    }
    [['paperUrl', 'Paper'], ['codeUrl', 'Code'], ['datasetUrl', 'HF dataset']].forEach(([key, label]) => {
      const url = safeUrl(config[key]);
      if (!url) return;
      ['hero-resources', 'footer-resources'].forEach((id) => {
        const container = $(id);
        const existing = container.querySelector(`[data-resource="${key}"]`);
        if (existing) { existing.href = url; return; }
        const link = document.createElement('a'); link.href = url;
        link.dataset.resource = key;
        link.className = id === 'hero-resources' ? 'button resource-link' : 'resource-link';
        if (key === 'paperUrl' || key === 'codeUrl') {
          const icon = document.createElement('img');
          icon.src = key === 'paperUrl' ? 'assets/arxiv.svg' : 'assets/github.svg'; icon.alt = ''; icon.width = 18; icon.height = 18;
          icon.className = 'resource-icon'; icon.setAttribute('aria-hidden', 'true');
          link.append(icon);
          link.setAttribute('aria-label', key === 'paperUrl' ? 'Read the paper on arXiv' : 'Code on GitHub');
        } else if (key === 'datasetUrl') {
          const icon = document.createElement('span');
          icon.textContent = '🤗'; icon.className = 'resource-icon'; icon.setAttribute('aria-hidden', 'true');
          link.append(icon);
          link.setAttribute('aria-label', 'HF dataset on Hugging Face');
        }
        const text = document.createElement('span'); text.textContent = label;
        const arrow = document.createElement('span'); arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
        link.append(text, arrow);
        container.append(link);
      });
    });
    const citation = $('citation-text');
    if (typeof config.citation === 'string' && config.citation.trim()) citation.textContent = config.citation;
    const copyButton = $('copy-citation');
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(citation.textContent);
        $('citation-status').textContent = 'BibTeX copied.';
      } catch {
        window.getSelection().selectAllChildren(citation);
        $('citation-status').textContent = 'BibTeX selected. Use your browser’s Copy command.';
      }
    });
    copyButton.hidden = false;
    const siteUrl = safeUrl(config.siteUrl);
    if (siteUrl) {
      const url = new URL(siteUrl); if (!url.pathname.endsWith('/')) url.pathname += '/';
      const canonical = document.querySelector('link[rel="canonical"]') || document.createElement('link'); canonical.rel = 'canonical'; canonical.href = url.href; document.head.append(canonical);
      const ogUrl = document.querySelector('meta[property="og:url"]') || document.createElement('meta'); ogUrl.setAttribute('property', 'og:url'); ogUrl.content = url.href; document.head.append(ogUrl);
      const imageUrl = new URL('assets/social-preview.png?v=2', url).href;
      document.querySelector('meta[property="og:image"]').content = imageUrl;
      document.querySelector('meta[name="twitter:image"]').content = imageUrl;
    }
  }

  function configureExamples() {
    const dialog = $('example-dialog');
    document.querySelectorAll('.enlarge-example').forEach((button) => {
      button.addEventListener('click', () => {
        const n = button.dataset.example;
        const support = button.dataset.support;
        const source = button.closest('.support-example').querySelector('img');
        $('enlarged-example').src = source.getAttribute('src');
        $('enlarged-example').alt = source.alt;
        $('example-dialog-title').textContent = `Task ${n} · Demonstration ${support}`;
        $('example-task-link').href = `data_viewer.html#/concept/InsideOutside/task/InsideOutside${n}_001`;
        dialog.showModal();
      });
    });
    $('close-example').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
  }

  function modelComparison() {
    const host = $('model-bars');
    const models = results.performance.models;
    $('performance-qwen-overall').textContent = percent(models.find((m) => m.id === 'qwen35-27b').overall);
    const rows = [];
    for (const [group, label] of [['pretrained', 'Pretrained reasoning models'], ['scratch', 'Trained from scratch · 3 demonstrations']]) {
      rows.push(`<p class="model-group-label">${label}</p>`);
      models.filter((m) => m.group === group).sort((a, b) => b.overall - a.overall).forEach((m) => {
        rows.push(`<button type="button" class="model-bar" data-model="${m.id}" aria-pressed="${m.id === selectedModel}" aria-controls="concept-bars" aria-label="${escape(m.label)}, ${percent(m.overall)} accuracy. Show concept results"><span class="bar-name">${escape(m.label)}</span><span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${m.overall}%;background:${colors[m.id]}"></span></span><span class="bar-value">${m.overall.toFixed(2)}</span></button>`);
      });
    }
    host.innerHTML = rows.join('');
    host.addEventListener('click', (event) => {
      const button = event.target.closest('[data-model]'); if (!button) return;
      selectedModel = button.dataset.model;
      host.querySelectorAll('[data-model]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      conceptBreakdown();
    });
    conceptBreakdown();
    const columns = [...models].sort((a, b) => (a.group === b.group ? b.overall - a.overall : a.group === 'pretrained' ? -1 : 1));
    const head = `<caption>Exact-grid query accuracy (%), mean ± sample SD across three random seeds, from the paper’s tables. Predicate and action averages each weight eight concepts equally; the overall average weights all 16 equally. SDs are computed across seeds after concept averaging.</caption><thead><tr><th scope="col">Concept</th>${columns.map((m) => `<th scope="col">${escape(m.label)}${m.group === 'scratch' ? '<br>(trained from scratch)' : ''}</th>`).join('')}</tr></thead>`;
    const body = [];
    for (const [ids, group] of [[predicateIds, 'predicate'], [actionIds, 'action']]) {
      ids.forEach((id) => body.push(`<tr><th scope="row"><a href="${datasetLink(id)}">${conceptNames[id]}</a></th>${columns.map((m) => accuracyCell(m.concepts[id], m.stdevs.concepts[id])).join('')}</tr>`));
      body.push(`<tr class="average-row"><th scope="row">Average ${group} concepts</th>${columns.map((m) => accuracyCell(m[group], m.stdevs[group])).join('')}</tr>`);
    }
    body.push(`<tr class="average-row"><th scope="row">Overall average</th>${columns.map((m) => accuracyCell(m.overall, m.stdevs.overall)).join('')}</tr>`);
    $('performance-table').innerHTML = head + '<tbody>' + body.join('') + '</tbody>';
    originalComparison(columns.filter((m) => m.group === 'pretrained'));
  }

  function originalComparison(models) {
    const original = results.performance.originalModels;
    const average = (items) => items.reduce((sum, m) => sum + m.overall, 0) / items.length;
    $('original-lrm-average').textContent = percent(average(original));
    $('scaled-lrm-average').textContent = percent(average(models));
    $('original-performance-table').innerHTML = `<caption>Overall query accuracy (%), mean ± sample SD across three seeds. Original ConceptARC: 160 tasks and 480 test queries per seed. ConceptARC-100: 1,600 tasks and 16,000 test queries per seed.</caption><thead><tr><th scope="col">Model</th><th scope="col">Original<br>ConceptARC</th><th scope="col">ConceptARC-100</th></tr></thead><tbody>${models.map((m) => {
      const previous = original.find((entry) => entry.id === m.id);
      return `<tr><th scope="row">${escape(m.label)}</th>${accuracyCell(previous.overall, previous.stdevs.overall)}${accuracyCell(m.overall, m.stdevs.overall)}</tr>`;
    }).join('')}</tbody>`;
  }

  function conceptBreakdown() {
    const model = results.performance.models.find((m) => m.id === selectedModel);
    $('concept-model-title').textContent = model.label;
    $('concept-bars').setAttribute('aria-label', `${model.label} query accuracy by concept`);
    $('concept-bars').innerHTML = [[predicateIds, 'Predicate'], [actionIds, 'Action']].map(([ids, label]) => `<div class="concept-group ${label.toLowerCase()}"><h5>${label} concepts</h5>${ids.map((id) => `<div class="concept-row"><a href="${datasetLink(id)}" title="Explore ${conceptNames[id]}">${conceptNames[id]}</a><span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${model.concepts[id]}%"></span></span><span class="bar-value" aria-label="${percent(model.concepts[id])}">${model.concepts[id].toFixed(2)}</span></div>`).join('')}</div>`).join('');
  }

  function legend(hostId, series, selected, update) {
    const host = $(hostId);
    series.forEach((s) => {
      const label = document.createElement('label'); label.style.setProperty('--series-color', s.color);
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected.has(s.id); input.value = s.id;
      input.addEventListener('change', () => { input.checked ? selected.add(s.id) : selected.delete(s.id); update(); });
      const swatch = document.createElement('span'); swatch.className = 'legend-swatch'; swatch.setAttribute('aria-hidden', 'true');
      label.append(input, swatch, document.createTextNode(s.label)); host.append(label);
    });
  }

  // SVG charts keep the original sample positions. Native range inputs provide
  // the same exact-value inspection without a pointer or a visual plot.
  function drawChart({ hostId, title, description, series, selected, xMin, xMax, xTicks, yMin, yMax, yTicks, xLabel, yLabel, current, chance = false }) {
    const width = Math.max(280, Math.round($(hostId).getBoundingClientRect().width));
    const height = width < 450 ? 270 : 295;
    const margin = { left: 53, right: 17, top: 25, bottom: 43 };
    const innerWidth = width - margin.left - margin.right, innerHeight = height - margin.top - margin.bottom;
    const x = (v) => margin.left + (v - xMin) / (xMax - xMin) * innerWidth;
    const y = (v) => margin.top + (yMax - v) / (yMax - yMin) * innerHeight;
    const clipId = `${hostId}-clip`;
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${hostId}-title ${hostId}-desc"><title id="${hostId}-title">${escape(title)}</title><desc id="${hostId}-desc">${escape(description)} Use the slider below for exact values.</desc><defs><clipPath id="${clipId}"><rect x="${margin.left}" y="${margin.top - 4}" width="${innerWidth}" height="${innerHeight + 8}"/></clipPath></defs>`];
    yTicks.forEach((v) => {
      parts.push(`<line x1="${margin.left}" y1="${y(v)}" x2="${width - margin.right}" y2="${y(v)}" stroke="${chance && v === 50 ? '#a0aaa8' : '#e9ece7'}" ${chance && v === 50 ? 'stroke-dasharray="5 4"' : ''}/><text class="chart-tick" x="${margin.left - 10}" y="${y(v) + 3}" text-anchor="end">${v}%</text>`);
    });
    const ticks = width < 450 && xMax === 63 ? [0, 20, 40, 63] : xTicks;
    ticks.forEach((v) => parts.push(`<text class="chart-tick" x="${x(v)}" y="${height - margin.bottom + 19}" text-anchor="middle">${v}</text>`));
    parts.push(`<text class="chart-axis-label" x="${margin.left}" y="12">${escape(yLabel)}</text><text class="chart-axis-label" x="${margin.left + innerWidth / 2}" y="${height - 3}" text-anchor="middle">${escape(xLabel)}</text>`);
    if (chance) parts.push(`<text class="chart-tick" x="${width - margin.right - 4}" y="${y(50) - 7}" text-anchor="end">50% · chance</text>`);
    parts.push(`<g clip-path="url(#${clipId})">`);
    series.filter((s) => selected.has(s.id)).forEach((s) => {
      if (!s.stdevs) return;
      const upper = s.values.map((v, i) => `${x(i + xMin)},${y(Math.min(yMax, (v + s.stdevs[i]) * 100))}`);
      const lower = s.values.map((v, i) => `${x(i + xMin)},${y(Math.max(yMin, (v - s.stdevs[i]) * 100))}`).reverse();
      parts.push(`<polygon points="${[...upper, ...lower].join(' ')}" fill="${s.color}" opacity=".10"/>`);
    });
    series.filter((s) => selected.has(s.id)).forEach((s) => {
      const path = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i + xMin).toFixed(3)},${y(v * 100).toFixed(3)}`).join(' ');
      parts.push(`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${s.id === 'action' || s.id === 'qwen35-27b' ? 2.8 : 1.8}" stroke-linejoin="round" ${s.dashed || s.id === 'selector' || s.id === 'trm' ? 'stroke-dasharray="5 3"' : ''}/>`);
    });
    parts.push(`<line x1="${x(current)}" y1="${margin.top}" x2="${x(current)}" y2="${height - margin.bottom}" stroke="#98a9a9" stroke-dasharray="3 4"/>`);
    series.filter((s) => selected.has(s.id)).forEach((s) => {
      const value = s.values[current - xMin] * 100;
      parts.push(`<circle cx="${x(current)}" cy="${y(value)}" r="3.2" fill="${s.color}" stroke="#fff" stroke-width="1.1"/>`);
    });
    parts.push('</g>');
    if (!selected.size) parts.push(`<text class="chart-axis-label" x="${width / 2}" y="${height / 2}" text-anchor="middle">Select a series above to explore the results.</text>`);
    parts.push('</svg>');
    $(hostId).innerHTML = parts.join('');
  }

  function readout(hostId, series, selected, index) {
    $(hostId).innerHTML = series.filter((s) => selected.has(s.id)).map((s) => `<div class="readout-item" style="--series-color:${s.color}"><span>${escape(s.label)}</span><strong>${percent(s.values[index] * 100)}</strong>${s.stdevs ? `<small>± ${percent(s.stdevs[index] * 100)} SD</small>` : ''}</div>`).join('') || '<p class="chart-empty">No series selected.</p>';
  }

  function robustnessSeries() {
    return results.robustness.models.map((m) => ({ ...m, values: m.means, color: colors[m.id] }));
  }

  function updateRobustness() {
    const current = Number($('threshold').value);
    $('threshold-label').value = `${current} / 10`;
    $('threshold').setAttribute('aria-valuetext', `At least ${current} out of 10 queries correct`);
    const series = robustnessSeries();
    const qwen = series.find((model) => model.id === 'qwen35-27b');
    const oneQuery = percent(qwen.values[0] * 100), allQueries = percent(qwen.values[9] * 100);
    $('robustness-qwen-one').textContent = oneQuery;
    $('robustness-qwen-all').textContent = allQueries;
    const description = `The proportion of tasks decreases as the minimum number of correct queries rises. Qwen3.5-27B falls from ${oneQuery} with at least one query correct to ${allQueries} with all ten correct. Bands show supplied standard deviations.`;
    drawChart({hostId: 'robustness-chart', title: 'Task consistency across ten queries', description, series, selected: visibleModels, xMin: 1, xMax: 10, xTicks: [1,2,3,4,5,6,7,8,9,10], yMin: 0, yMax: 100, yTicks: [0,20,40,60,80,100], xLabel: 'Minimum correct queries out of 10', yLabel: 'Proportion of tasks', current});
    readout('robustness-readout', series, visibleModels, current - 1);
  }

  function separationSeries() {
    return results.separation.series.map((s) => ({...s, color: roleColors[s.id]}));
  }

  function updateSeparation() {
    const current = Number($('layer').value);
    $('layer-label').value = String(current);
    $('layer').setAttribute('aria-valuetext', `Transformer layer ${current}`);
    const series = separationSeries();
    drawChart({hostId: 'separation-chart', title: 'Qwen3.5-27B separation probability across layers', description: 'Early representations group primarily by layout. Action separation rises to 73.4% at layer 39 and remains the strongest property through the final layer. Chance is 50%.', series, selected: visibleRoles, xMin: 0, xMax: 63, xTicks: [0,10,20,30,40,50,63], yMin: 50, yMax: 100, yTicks: [50,60,70,80,90,100], xLabel: 'Transformer layer', yLabel: 'Separation probability', current, chance: true});
    readout('separation-readout', series, visibleRoles, current);
  }

  function addPointerInspection(hostId, inputId, min, max, update) {
    let frame = 0, pointerX;
    $(hostId).addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      pointerX = event.clientX;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = $(hostId).getBoundingClientRect();
        const fraction = (pointerX - r.left - 53) / (r.width - 53 - 17);
        const index = Math.max(min, Math.min(max, Math.round(min + fraction * (max - min))));
        if (Number($(inputId).value) === index) return;
        $(inputId).value = String(index); update();
      });
    });
  }

  function updateMatchedAction() {
    if (!$('visual-controls').open) return;
    const layer = Number($('matched-layer').value);
    const option = $('match-condition').selectedOptions[0];
    const original = results.separation.series.find((item) => item.id === 'action').values;
    const matched = results.separation.matchedAction.curves[option.value];
    const series = [
      {id: 'uncontrolled', label: 'Uncontrolled', color: '#72695e', values: original, dashed: true},
      {id: 'action', label: option.textContent, color: roleColors.action, values: matched}
    ];
    const selected = new Set(series.map((item) => item.id));
    $('matched-layer-label').value = String(layer);
    $('matched-layer').setAttribute('aria-valuetext', `Transformer layer ${layer}`);
    drawChart({hostId: 'matched-chart', title: 'Qwen3.5-27B action separation across layers',
      description: `The dashed line shows uncontrolled action separation. The solid line shows ${option.textContent}. Chance is 50%.`,
      series, selected, xMin: 0, xMax: 63, xTicks: [0,10,20,30,40,50,63], yMin: 50, yMax: 80,
      yTicks: [50,55,60,65,70,75,80], xLabel: 'Transformer layer', yLabel: 'Action separation probability', current: layer, chance: true});
    readout('matched-readout', series, selected, layer);
    const difference = (matched[layer] - original[layer]) * 100;
    const sign = difference < 0 ? '−' : '+';
    $('matched-readout').insertAdjacentHTML('beforeend', `<div class="readout-item match-difference"><span>Change from uncontrolled</span><strong>${sign}${Math.abs(difference).toFixed(2)} pp</strong></div>`);
  }

  function setupMatchedAction() {
    const {curves, varc, visualBaseline} = results.separation.matchedAction;
    const peak = Math.max(...curves.full_q25);
    const rows = [
      ['VARC', varc, 1, colors.varc],
      [`Qwen3.5-27B · layer ${curves.full_q25.indexOf(peak)}`, peak, 2, roleColors.action],
      ['Visual features', visualBaseline, 2, '#398052']
    ];
    $('matched-bars').innerHTML = rows.map(([label, value, digits, color]) =>
      `<div class="varc-row"><div><span>${label}</span><strong>${percent(value * 100, digits)}</strong></div><span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${value * 100}%;background:${color}"></span></span></div>`
    ).join('');
    $('visual-controls').addEventListener('toggle', updateMatchedAction);
    $('match-condition').addEventListener('change', updateMatchedAction);
    $('matched-layer').addEventListener('input', updateMatchedAction);
    addPointerInspection('matched-chart', 'matched-layer', 0, 63, updateMatchedAction);
    updateMatchedAction();
  }

  function setupCharts() {
    results.robustness.models.forEach((m) => visibleModels.add(m.id));
    legend('robustness-legend', robustnessSeries(), visibleModels, updateRobustness);
    legend('separation-legend', separationSeries(), visibleRoles, updateSeparation);
    $('threshold').addEventListener('input', updateRobustness);
    $('layer').addEventListener('input', updateSeparation);
    addPointerInspection('robustness-chart', 'threshold', 1, 10, updateRobustness);
    addPointerInspection('separation-chart', 'layer', 0, 63, updateSeparation);
    $('varc-bars').innerHTML = ['layout', 'selector', 'action', 'concept'].map((id) => `<div class="varc-row"><div><span>${id[0].toUpperCase() + id.slice(1)}</span><strong>${percent(results.separation.varc[id] * 100, 1)}</strong></div><span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${results.separation.varc[id] * 100}%;background:${roleColors[id]}"></span></span></div>`).join('');
    updateRobustness(); updateSeparation(); setupMatchedAction();
    const redraw = {'robustness-chart': updateRobustness, 'separation-chart': updateSeparation, 'matched-chart': updateMatchedAction};
    const observedWidths = new Map();
    const observer = new ResizeObserver((entries) => entries.forEach((entry) => {
      const width = Math.round(entry.contentRect.width);
      if (width === observedWidths.get(entry.target.id) || !width) return;
      observedWidths.set(entry.target.id, width);
      redraw[entry.target.id]();
    }));
    Object.keys(redraw).forEach((id) => observer.observe($(id)));
  }

  async function loadResults() {
    const status = $('results-status');
    status.hidden = false; status.textContent = 'Loading interactive results…';
    try {
      const response = await fetch('data/results.json?v=visual-controls-1', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Results request failed (${response.status})`);
      const data = await response.json();
      if (data.performance?.models?.length !== 10 || data.performance?.originalModels?.length !== 8 || !data.performance.models.every((model) => model.stdevs?.concepts) || data.robustness?.models?.length !== 10 || data.separation?.layers?.length !== 64) throw new Error('Incomplete results data');
      if (![...$('match-condition').options].every((option) => data.separation.matchedAction?.curves?.[option.value]?.length === 64)) throw new Error('Incomplete matched action curves');
      results = data;
      document.querySelectorAll('.results-ui').forEach((el) => { el.hidden = false; });
      modelComparison(); setupCharts();
      status.hidden = true;
    } catch (error) {
      status.textContent = 'The interactive results could not be loaded. Please try again.';
      const retry = document.createElement('button'); retry.className = 'button'; retry.type = 'button'; retry.textContent = 'Retry';
      retry.addEventListener('click', loadResults, { once: true }); status.append(retry);
    }
  }

  configureResources(); configureExamples(); loadResults();
})();
