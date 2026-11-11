// Two letters: the slug's first letter, then the earliest later letter of the slug that makes a code no other class uses
// (current or former). Null when every such pair is taken.
export function newCode(slug, taken) {
  const used = new Set(taken);
  for (const ch of slug.slice(1)) {
    const code = `${slug[0]}${ch}`;
    if (!used.has(code)) return code;
  }
  return null;
}

// A valid code is two lowercase letters: the slug's first letter, then a letter that appears later in the slug.
export const codeFits = (code, slug) => /^[a-z]{2}$/.test(code) && code[0] === slug[0] && slug.slice(1).includes(code[1]);
