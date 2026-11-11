import { cardModel, ME_ID } from './people.mjs';
import { h } from './dom.mjs';
import { classIcon } from './icons.mjs';

// The person cards on Builds. Renders from state only; every control carries a data-fk so focus survives the full re-render.
// state.cards is { form, message }: form is null or { kind: 'add' | 'menu' | 'rename' | 'delete' | 'save', draft, error }.

const REGION_ID = 'card-region';

const classText = (cls, model) => {
  if (model.empty) return 'No classes';
  return `${cls.name} L${model.level}`;
};

// One card: a select button (name and class) and, on the saved selected card, a sibling menu button. Never a button inside a button.
function card(state, actions, person, { selected, temp = false, active = false }) {
  const model = cardModel(state.data.classes, person);
  const cls = model.empty ? null : state.data.classes.find((c) => c.code === model.code);
  const text = classText(cls, model);
  const me = person.id === ME_ID;
  const menuOpen = selected && !temp && ['menu', 'rename', 'delete'].includes(state.cards.form?.kind);
  return h(
    'li',
    { class: `card${selected ? ' is-selected' : ''}${me ? ' is-me' : ''}${temp ? ' is-temp' : ''}${active ? ' is-active' : ''}`, 'data-person': person.id },
    h(
      'button',
      { type: 'button', class: 'card-select', 'data-fk': temp ? 'card-temp' : `card-${person.id}`, 'aria-current': selected ? 'true' : null, 'aria-label': `${model.label}, ${text}`, title: me ? 'Your card' : null, onclick: () => (temp ? null : actions.selectPerson(person.id)) },
      cls ? classIcon(cls, { size: 24 }) : h('span', { class: 'card-noicon', 'aria-hidden': 'true' }),
      h('span', { class: 'card-text' }, h('span', { class: 'card-name', text: model.label }), h('span', { class: `card-class${model.empty ? ' is-empty' : ''}`, text })),
      me ? h('span', { class: 'card-mine', 'aria-hidden': 'true', text: 'you' }) : null,
    ),
    selected && !temp
      ? h('button', { type: 'button', class: 'card-menu-btn', 'data-fk': 'card-menu', 'aria-label': `Edit ${model.label}`, 'aria-expanded': String(menuOpen), 'aria-controls': REGION_ID, onclick: actions.toggleCardMenu, onkeydown: (e) => (e.key === 'Escape' && menuOpen ? (e.preventDefault(), actions.closeCardForm()) : null), text: '⋯' })
      : null,
    temp ? h('button', { type: 'button', class: 'btn btn-green btn-small card-save', 'data-fk': 'card-temp-save', 'aria-expanded': String(state.cards.form?.kind === 'save'), 'aria-controls': REGION_ID, onclick: () => actions.openCardForm('save'), text: 'Save' }, h('span', { class: 'visually-hidden', text: ` ${model.label}` })) : null,
  );
}

function addCard(state, actions) {
  const open = state.cards.form?.kind === 'add';
  return h(
    'li',
    { class: `card card-add${open ? ' is-active' : ''}` },
    h('button', { type: 'button', class: 'card-select', 'data-fk': 'card-add', 'aria-label': 'Add a person', 'aria-expanded': String(open), 'aria-controls': REGION_ID, onclick: () => actions.openCardForm('add') }, h('span', { class: 'card-plus', 'aria-hidden': 'true', text: '+' })),
  );
}

const FORM_TEXT = {
  add: { label: 'Name', submit: 'Create' },
  rename: { label: 'New name', submit: 'Rename' },
  save: { label: 'Save as', submit: 'Save' },
};

function nameForm(actions, form) {
  const text = FORM_TEXT[form.kind];
  return h(
    'form',
    { class: 'card-form', onsubmit: (e) => (e.preventDefault(), actions.submitCardForm(e.target.elements.name.value)) },
    h('label', { class: 'field-label', for: 'card-name', text: text.label }),
    h(
      'div',
      { class: 'roster-row' },
      h('input', { type: 'text', id: 'card-name', name: 'name', class: 'roster-field', 'data-fk': 'card-name', autocomplete: 'off', spellcheck: 'false', maxlength: '40', 'aria-invalid': form.error ? 'true' : null, 'aria-describedby': form.error ? 'card-error' : null, value: form.draft, oninput: (e) => actions.setCardDraft(e.target.value) }),
      h('button', { type: 'submit', class: 'btn btn-green btn-small', 'data-fk': 'card-submit', text: text.submit }),
      h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'card-cancel', onclick: actions.closeCardForm, text: 'Cancel' }),
    ),
    form.error ? h('p', { class: 'roster-error', id: 'card-error', role: 'status', text: form.error }) : null,
  );
}

function menu(state, actions) {
  const person = state.shown;
  return h(
    'div',
    { class: 'card-menu', role: 'group', 'aria-label': `${cardModel(state.data.classes, person).label} menu` },
    h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'menu-rename', onclick: () => actions.openCardForm('rename'), text: 'Rename' }),
    person.id === ME_ID ? null : h('button', { type: 'button', class: 'btn btn-red btn-small', 'data-fk': 'menu-delete', onclick: () => actions.openCardForm('delete'), text: 'Delete' }),
  );
}

function deleteConfirm(state, actions) {
  const person = state.shown;
  const onTeam = state.people.team.members.some((m) => m.id === person.id);
  return h(
    'div',
    { class: 'card-confirm', role: 'group', 'aria-label': `Delete ${person.name}` },
    h('p', { class: 'roster-error', text: `Delete ${person.name}?${onTeam ? ' They are removed from your team.' : ''} This cannot be undone.` }),
    h(
      'div',
      { class: 'roster-row' },
      h('button', { type: 'button', class: 'btn btn-red btn-small', 'data-fk': 'delete-yes', onclick: actions.confirmDelete, text: 'Yes' }),
      h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'delete-no', onclick: actions.closeCardForm, text: 'No' }),
    ),
  );
}

// The form region: one full-width block under the card row that holds the edit menu, the name forms and the delete confirm.
function region(state, actions) {
  const form = state.cards.form;
  const body = !form ? null : form.kind === 'menu' ? menu(state, actions) : form.kind === 'delete' ? deleteConfirm(state, actions) : nameForm(actions, form);
  return h('div', { id: REGION_ID, class: 'card-region', onkeydown: (e) => (e.key === 'Escape' && form ? (e.preventDefault(), actions.closeCardForm()) : null) }, body);
}

// The cards panel: Me, the saved people A to Z, the temporary link's card, then the "+" card; below them the form region and the live message.
export function cardsPanel(state, actions) {
  const [me, ...others] = state.people.people;
  const temp = state.temp?.record ?? null;
  const pick = (p) => card(state, actions, p, { selected: !temp && p.id === state.selectedId });
  return h(
    'section',
    { class: 'panel cards-panel', 'aria-label': 'People' },
    h('ul', { class: 'card-row' }, pick(me), others.map(pick), temp ? card(state, actions, temp, { selected: true, temp: true, active: state.cards.form?.kind === 'save' }) : null, addCard(state, actions)),
    region(state, actions),
    h('div', { class: 'card-status', role: 'status', text: state.cards.message }),
  );
}

// Brings the highlighted card into view inside the scrolling row. The page itself never scrolls.
export function revealCard(root) {
  const row = root.querySelector('.card-row');
  const target = row?.querySelector('.card.is-active') ?? row?.querySelector('.card.is-selected');
  if (!row || !target || row.scrollWidth <= row.clientWidth) return;
  row.scrollLeft = target.offsetLeft - (row.clientWidth - target.offsetWidth) / 2;
}
