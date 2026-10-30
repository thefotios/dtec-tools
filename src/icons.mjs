import { h } from './dom.mjs';

// Decorative class glyph in a ring; the class name text always sits beside it. Relative URL resolves via <base href>.
export function classIcon(cls, { size = 36 } = {}) {
  return h(
    'span',
    { class: `class-icon${size <= 24 ? ' is-small' : ''}`, 'aria-hidden': 'true' },
    h('img', { src: `icons/${cls.code}.png`, alt: '', width: size, height: size, loading: 'lazy', decoding: 'async' }),
  );
}
