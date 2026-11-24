'use strict';

// Small, local interactions; no explorer data or external dependencies.
(() => {
  const grid = document.getElementById('scale-grid');
  const figure = grid.closest('.scale-figure');
  const buttons = ['original', 'generated'].map(name => document.getElementById(`scale-${name}`));
  const dots = Array.from(grid.children);
  const anatomy = document.getElementById('task-anatomy');
  // Verified against all ten tasks at the pinned original repository revision.
  // Source URLs, hashes, and the corpus format are in
  // assets/original-conceptarc/task-counts.json (not fetched by the landing page).
  const originalSupports = [3, 4, 4, 4, 3, 2, 3, 2, 2, 2];
  const originalRepository = 'https://github.com/victorvikram/ConceptARC/blob/0e67da6af879e4bad3d7cd3c196e8d551b445725';
  let collection = 'original';
  let cursor = 0;
  let selected = 0;
  const taskCount = () => collection === 'generated' ? 100 : 10;
  function updateTaskButtons() {
    dots.forEach((dot, index) => {
      const active = index < taskCount();
      dot.classList.toggle('is-active', active);
      dot.classList.toggle('is-selected', active && !anatomy.hidden && index === selected);
      dot.disabled = !active;
      dot.tabIndex = active && index === cursor ? 0 : -1;
      dot.setAttribute('aria-hidden', String(!active));
      dot.setAttribute('aria-label', `${collection === 'generated' ? 'ConceptARC-100' : 'Original ConceptARC'} Inside and Outside task ${index + 1}: show examples`);
      dot.setAttribute('aria-controls', 'task-anatomy');
      dot.setAttribute('aria-expanded', String(active && !anatomy.hidden && index === selected));
    });
  }
  function exampleSymbols(count, test) {
    return Array.from({length: count}, (_, index) => {
      const example = document.createElement('span');
      example.className = 'anatomy-example';
      const number = document.createElement('span');
      number.className = 'example-number';
      number.textContent = String(index + 1);
      const pair = document.createElement('span');
      pair.className = 'example-symbols';
      const input = document.createElement('i');
      input.className = 'example-grid-symbol';
      const arrow = document.createElement('span');
      arrow.textContent = '→';
      const output = document.createElement(test ? 'span' : 'i');
      output.className = test ? 'example-unknown' : 'example-grid-symbol example-known';
      if (test) output.textContent = '?';
      pair.append(input, arrow, output);
      example.append(number, pair);
      return example;
    });
  }
  function renderAnatomy() {
    const generated = collection === 'generated';
    const supports = generated ? 3 : originalSupports[selected];
    const tests = generated ? 10 : 3;
    document.getElementById('anatomy-collection').textContent = generated ? 'ConceptARC-100' : 'Original ConceptARC';
    document.getElementById('anatomy-task-title').textContent = `Inside and Outside · Task ${selected + 1}`;
    document.getElementById('anatomy-support-count').textContent = String(supports);
    document.getElementById('anatomy-test-count').textContent = String(tests);
    document.getElementById('anatomy-supports').replaceChildren(...exampleSymbols(supports, false));
    document.getElementById('anatomy-tests').replaceChildren(...exampleSymbols(tests, true));
    document.getElementById('anatomy-note').textContent = generated
      ? 'All ConceptARC-100 tasks have three support examples and ten test queries. Icons show the task structure; the source link shows the actual grids.'
      : 'Original ConceptARC has 1–4 support examples and three test queries per task. Counts above are for this selected task; icons show its structure.';
    document.getElementById('anatomy-source').href = generated
      ? `data_viewer.html#/concept/InsideOutside/task/InsideOutside${selected + 1}_001`
      : `${originalRepository}/corpus/InsideOutside/InsideOutside${selected + 1}.json`;
  }
  function closeAnatomy() {
    anatomy.hidden = true;
    cursor = selected;
    updateTaskButtons();
    dots[cursor].focus();
  }
  function openTask(index) {
    if (!anatomy.hidden && selected === index) { closeAnatomy(); return; }
    cursor = selected = index;
    anatomy.hidden = false;
    renderAnatomy();
    updateTaskButtons();
  }
  dots.forEach((dot, index) => {
    dot.addEventListener('click', () => openTask(index));
    dot.addEventListener('focus', () => { cursor = index; updateTaskButtons(); });
    dot.addEventListener('keydown', event => {
      const steps = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -10, ArrowDown: 10};
      let next;
      if (Object.hasOwn(steps, event.key)) next = Math.max(0, Math.min(taskCount() - 1, index + steps[event.key]));
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = taskCount() - 1;
      else return;
      event.preventDefault();
      cursor = next;
      updateTaskButtons();
      dots[cursor].focus();
    });
  });
  document.getElementById('close-anatomy').addEventListener('click', closeAnatomy);
  figure.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !anatomy.hidden) { event.preventDefault(); closeAnatomy(); }
  });
  buttons.forEach(button => { button.disabled = false; });
  function showCollection(name) {
    collection = name;
    const generated = name === 'generated';
    const count = generated ? 100 : 10;
    figure.dataset.collection = name;
    cursor = Math.min(cursor, count - 1);
    selected = Math.min(selected, count - 1);
    if (!anatomy.hidden) renderAnatomy();
    updateTaskButtons();
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.id === `scale-${name}`)));
    document.getElementById('scale-task-count').textContent = String(count);
    document.getElementById('scale-task-description').textContent = generated ? 'new, reviewed tasks per concept' : 'hand-crafted tasks per concept';
    document.getElementById('scale-total-count').textContent = generated ? '1,600 new tasks' : '160 tasks';
    document.getElementById('scale-note').textContent = generated
      ? 'A new collection: 100 generated tasks for each of the same 16 concepts. The original tasks are not included in this count.'
      : 'The same task count applies to each of the 16 concepts.';
  }
  buttons.forEach(button => button.addEventListener('click', () => showCollection(button.id.slice(6))));
  showCollection('original');

  document.querySelectorAll('[data-original-task]').forEach(select => {
    select.disabled = false;
    const task = select.dataset.originalTask;
    const image = document.querySelector(`#original-task-${task}>img`);
    const baseAlt = image.alt;
    select.addEventListener('change', () => {
      image.src = `assets/original-conceptarc/InsideOutside${task}-support-${select.value}.svg`;
      image.alt = `Demonstration ${select.value}. ${baseAlt}`;
    });
  });
})();
