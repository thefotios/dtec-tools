import { isValidName } from './players.mjs';
import { h } from './dom.mjs';

const listOf = (parts) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);

// What an import replaces, in words: "your classes and all passive sets"; `who` is the owner's possessive. Empty when nothing existing is replaced.
export function replacesText(state, parsed, summary, who = 'your') {
  const base = parsed.player ? state.data.classes.find((c) => c.code === parsed.player.base) : null;
  const parts = [];
  if (summary.replacesRoster) parts.push(`${who} classes`);
  if (summary.replacesAllSets) parts.push('all passive sets');
  else if (summary.replacesBaseSet) parts.push(`${who} ${base.name} passives`);
  if (summary.replacesBaseLevel) parts.push(`${who} ${base.name} level`);
  return listOf(parts);
}

function confirmPrompt(state, actions, pending) {
  return h(
    'div',
    { class: 'claim-prompt import-prompt', role: 'alert' },
    h('p', { class: 'roster-error', text: `This replaces ${replacesText(state, pending.parsed, pending.summary)}. Continue?` }),
    h(
      'div',
      { class: 'roster-row' },
      h('button', { type: 'button', class: 'btn btn-green btn-small', 'data-fk': 'import-yes', onclick: actions.confirmImport, text: 'Yes' }),
      h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'import-no', onclick: actions.cancelImport, text: 'No' }),
    ),
  );
}

function whosePrompt(state, actions, pending) {
  const { parsed } = pending;
  const replaces = replacesText(state, parsed, actions.importSummary(parsed));
  const setsName = !state.people.me.name && parsed.player.name && isValidName(parsed.player.name);
  const hint = [setsName ? `sets your username to ${parsed.player.name}` : null, replaces ? `replaces ${replaces}` : null].filter(Boolean);
  return h(
    'div',
    { class: 'claim-prompt import-prompt', role: 'group', 'aria-labelledby': 'import-whose-title' },
    h('p', { class: 'import-prompt-title', id: 'import-whose-title', text: 'Whose build is this?' }),
    hint.length ? h('p', { class: 'roster-notice', id: 'import-mine-hint', text: `Mine ${listOf(hint)}.` }) : null,
    h('div', { class: 'roster-row' }, h('button', { type: 'button', class: 'btn btn-green btn-small', 'data-fk': 'import-mine', 'aria-describedby': hint.length ? 'import-mine-hint' : null, onclick: actions.importAsMine, text: 'Mine' })),
    h(
      'form',
      { class: 'import-save', onsubmit: (e) => (e.preventDefault(), actions.importAs(e.target.elements.name.value)) },
      h('label', { class: 'field-label', for: 'import-name', text: 'Save as' }),
      h(
        'div',
        { class: 'roster-row' },
        h('input', { type: 'text', id: 'import-name', name: 'name', class: 'roster-field', 'data-fk': 'import-name', autocomplete: 'off', spellcheck: 'false', maxlength: '40', 'aria-invalid': pending.error ? 'true' : null, 'aria-describedby': pending.error ? 'import-name-error' : null, value: pending.nameDraft, oninput: (e) => actions.setImportName(e.target.value) }),
        h('button', { type: 'submit', class: 'btn btn-green btn-small', 'data-fk': 'import-save', text: 'Save' }),
        h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'import-cancel', onclick: actions.cancelImport, text: 'Cancel' }),
      ),
      pending.error ? h('p', { class: 'roster-error', id: 'import-name-error', role: 'alert', text: pending.error }) : null,
    ),
  );
}

// The import panel under the header on every page: any pasted link or code. Feedback (error, prompt, message, notices) renders below it.
// Escape and Close dismiss it; the View button shows only off Builds, where the imported person is not on screen.
export function importPanel(state, actions) {
  const imp = state.list.import;
  const { pending } = imp;
  return h(
    'section',
    { class: 'panel import-panel', id: 'import-panel', 'aria-label': 'Import', onkeydown: (e) => (e.key === 'Escape' ? (e.preventDefault(), actions.closeImport()) : null) },
    h(
      'form',
      { class: 'import-form', onsubmit: (e) => (e.preventDefault(), actions.importText(e.target.elements.paste.value)) },
      h('label', { class: 'field-label', for: 'import-field', text: 'Import link or code' }),
      h(
        'div',
        { class: 'roster-row' },
        h('input', { type: 'text', id: 'import-field', name: 'paste', class: 'roster-field', 'data-fk': 'import-field', autocomplete: 'off', spellcheck: 'false', 'aria-invalid': imp.error ? 'true' : null, 'aria-describedby': 'import-msg', value: imp.draft, oninput: (e) => actions.setImportDraft(e.target.value) }),
        h('button', { type: 'submit', class: 'btn btn-grey', 'data-fk': 'import-btn', text: 'Import' }),
        h('button', { type: 'button', class: 'btn btn-grey', 'data-fk': 'import-close', onclick: actions.closeImport, text: 'Close' }),
      ),
    ),
    h(
      'div',
      { id: 'import-msg', class: 'field-msg', 'aria-live': 'polite' },
      imp.error ? h('p', { class: 'roster-error', role: 'alert', text: imp.error }) : null,
      pending?.kind === 'confirm' ? confirmPrompt(state, actions, pending) : null,
      pending?.kind === 'whose' ? whosePrompt(state, actions, pending) : null,
      imp.message
        ? h('p', { class: 'visitor-saved', role: 'status' }, imp.message, state.view !== 'builds' ? h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'import-view', onclick: actions.viewImported, text: 'View' }) : null)
        : null,
      imp.notices.map((n) => h('p', { class: 'roster-notice', text: n })),
    ),
  );
}
