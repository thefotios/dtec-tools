// Minimal, unstyled view. Renders from state only; all data text goes through textContent.
// Class names are the hooks U3 themes: .panel, .picker, .tier, .diamond, .level, .slot, .notice, .combined.

const MAX_SLOTS = 3;
const TAG_LABEL = { team: 'TEAM', master: 'MASTER' };

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const hidden = (text) => h('span', { class: 'visually-hidden', text });

function diamonds(cls, tiers) {
  const color = cls.event ? 'orange' : tiers[cls.tier]?.color ?? 'white';
  return h(
    'span',
    { class: 'diamonds', 'data-color': color },
    ...Array.from({ length: cls.tier }, () => h('span', { class: 'diamond', 'aria-hidden': 'true', text: '◆' })),
    hidden(`Tier ${cls.tier}${cls.event ? ', event' : ''}`),
  );
}

function levelRow(level, index, label) {
  return h(
    'li',
    { class: 'level', 'data-level': index + 1, 'data-tag': level.tag },
    h('span', { class: 'level-chip', text: label }),
    level.tag ? h('span', { class: 'level-tag', text: TAG_LABEL[level.tag] ?? level.tag }) : null,
    h('span', { class: 'level-text', text: level.text }),
  );
}

function matches(cls, filter) {
  if (!filter) return true;
  const f = filter.toLowerCase();
  return cls.name.toLowerCase().includes(f) || cls.levels.some((l) => l.text.toLowerCase().includes(f));
}

function loadingPanel() {
  return h('section', { class: 'panel loading', role: 'status' }, h('p', { text: 'Loading classes' }));
}

function errorPanel(error, actions) {
  return h(
    'section',
    { class: 'panel error', role: 'alert' },
    h('p', { text: `Could not load ${error.url}` }),
    error.message ? h('p', { class: 'error-detail', text: error.message }) : null,
    h('button', { type: 'button', onclick: actions.retry, text: 'Retry' }),
  );
}

function noticesBar(notices, actions) {
  if (!notices.length) return null;
  return h(
    'div',
    { class: 'notices' },
    notices.map((n, i) =>
      h(
        'p',
        { class: 'notice', role: 'status', 'data-reason': n.reason },
        h('span', { class: 'notice-text', text: n.message }),
        h('button', { type: 'button', 'aria-label': `Dismiss notice for ${n.token}`, onclick: () => actions.dismissNotice(i), text: 'Dismiss' }),
      ),
    ),
  );
}

function picker(state, actions) {
  const { classes, tiers } = state.data;
  const groups = Object.keys(tiers).map((tier) => ({
    tier,
    items: classes.filter((c) => String(c.tier) === tier && matches(c, state.filter)),
  }));
  return h(
    'section',
    { class: 'panel picker', 'aria-label': 'Classes' },
    h('input', { type: 'search', class: 'picker-filter', 'aria-label': 'Filter classes', placeholder: 'Filter classes', value: state.filter, oninput: (e) => actions.setFilter(e.target.value) }),
    groups
      .filter((g) => g.items.length)
      .map((g) =>
        h(
          'div',
          { class: 'tier', 'data-tier': g.tier },
          h('h3', { text: `Tier ${g.tier}` }),
          h(
            'ul',
            {},
            g.items.map((c) =>
              h(
                'li',
                {},
                h('button', { type: 'button', class: 'class-button', 'aria-pressed': state.build.base?.slug === c.slug ? 'true' : 'false', onclick: () => actions.setBase(c.slug) },
                  h('span', { class: 'class-name', text: c.name }), diamonds(c, tiers)),
              ),
            ),
          ),
        ),
      ),
  );
}

function baseLevels(state, actions) {
  const base = state.build.base;
  if (!base) return h('section', { class: 'panel base', 'aria-label': 'Base class' }, h('p', { class: 'empty', text: 'Choose a base class' }));
  return h(
    'section',
    { class: 'panel base', 'aria-label': 'Base class' },
    h('h2', {}, base.name, ' ', diamonds(base, state.data.tiers)),
    h('button', { type: 'button', class: 'clear', onclick: () => actions.setBase(null) }, 'Clear', hidden(` base ${base.name}`)),
    h('ol', {}, base.levels.map((l, i) => levelRow(l, i, `Lv ${i + 1}`))),
  );
}

function slotView(state, actions, index) {
  const slot = state.build.slots[index];
  const { classes } = state.data;
  const select = h(
    'select',
    { 'aria-label': `Slot ${index + 1} class`, onchange: (e) => actions.setSlot(index, e.target.value || null, 1) },
    h('option', { value: '', text: 'Choose class' }),
    classes.map((c) => h('option', { value: c.slug, selected: slot?.cls.slug === c.slug, text: c.name })),
  );
  if (!slot) return h('li', { class: 'slot empty', 'data-slot': index + 1 }, select);
  return h(
    'li',
    { class: 'slot filled', 'data-slot': index + 1 },
    select,
    h('span', { class: 'slot-levels' },
      [1, 2, 3].map((n) =>
        h('button', { type: 'button', class: 'level-button', 'data-level': n, 'aria-pressed': slot.level === n ? 'true' : 'false',
          onclick: () => actions.setSlot(index, slot.cls.slug, n), text: String(n) }),
      ),
    ),
    h('button', { type: 'button', class: 'clear', onclick: () => actions.clearSlot(index) }, 'Clear', hidden(` slot ${index + 1}`)),
    h('p', { class: 'slot-text', text: slot.cls.levels[slot.level - 1].text }),
  );
}

function slotsPanel(state, actions) {
  if (!state.build.base) return null;
  return h('section', { class: 'panel slots', 'aria-label': 'Passive slots' },
    h('h2', { text: 'Passives' }),
    h('ol', {}, Array.from({ length: MAX_SLOTS }, (_, i) => slotView(state, actions, i))));
}

function combined(state, actions) {
  const { base, slots } = state.build;
  if (!base) return null;
  const rows = [
    ...base.levels.map((l, i) => ({ label: `Base ${i + 1}`, level: i + 1, text: l.text })),
    ...slots.map((s, i) => ({ label: `Slot ${i + 1}`, level: s.level, text: s.cls.levels[s.level - 1].text, from: s.cls.name })),
  ];
  return h(
    'section',
    { class: 'panel combined', 'aria-label': 'Combined effects' },
    h('h2', { text: 'Combined effects' }),
    base.slug === 'recruit' ? h('p', { class: 'recruit-note', text: base.levels[4].text }) : null,
    h('ul', {}, rows.map((r) =>
      h('li', { class: 'row', 'data-level': r.level },
        h('span', { class: 'level-chip', text: r.label }),
        r.from ? h('span', { class: 'row-from', text: r.from }) : null,
        h('span', { class: 'level-text', text: r.text })))),
    copyLink(state, actions),
  );
}

function copyLink(state, actions) {
  return h(
    'div',
    { class: 'copy-link' },
    h('button', { type: 'button', onclick: actions.copyLink, text: state.copy === 'copied' ? 'Link copied' : 'Copy link' }),
    state.copy === 'failed'
      ? h('input', { type: 'text', readonly: true, 'aria-label': 'Build link', value: actions.currentUrl(),
          onfocus: (e) => e.target.select() })
      : null,
  );
}

// Replaces root's content from state. state.status is 'loading' | 'error' | 'ready'.
export function render(root, state, actions) {
  let focusKey = null;
  const active = document.activeElement;
  if (active && root.contains(active)) focusKey = active.getAttribute('aria-label') || active.className;
  root.replaceChildren();
  if (state.status === 'loading') return void root.append(loadingPanel());
  if (state.status === 'error') return void root.append(errorPanel(state.error, actions));
  root.append(
    h('header', {}, h('h1', { text: 'Class Combo Viewer' })),
    noticesBar(state.notices, actions),
    h('main', { class: 'layout' }, picker(state, actions), baseLevels(state, actions), h('div', { class: 'build' }, slotsPanel(state, actions), combined(state, actions))),
  );
  if (state.copy === 'failed') root.querySelector('.copy-link input')?.select();
  if (focusKey) {
    const next = [...root.querySelectorAll('[aria-label], input, select, button')].find(
      (el) => (el.getAttribute('aria-label') || el.className) === focusKey,
    );
    if (next && next.tagName !== 'BUTTON') {
      next.focus();
      if (next.type === 'search') next.setSelectionRange(next.value.length, next.value.length);
    }
  }
}
