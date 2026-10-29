const GROUP = /^[a-z]+\d/;

// Splits a passive run into greedy letters+digit groups; any other maximal chunk is one invalid group.
export function tokenize(run) {
  const s = String(run).toLowerCase();
  const groups = [];
  for (let i = 0; i < s.length; ) {
    const m = GROUP.exec(s.slice(i));
    if (m) {
      const [, token, digit] = /^([a-z]+)(\d)$/.exec(m[0]);
      const level = Number(digit);
      groups.push({ raw: m[0], token, level, valid: level >= 1 && level <= 3 });
      i += m[0].length;
      continue;
    }
    let j = i + 1;
    while (j < s.length && !GROUP.test(s.slice(j))) j++;
    groups.push({ raw: s.slice(i, j), valid: false });
    i = j;
  }
  return groups;
}

// Exact code, then exact slug, then unique slug prefix; null when nothing or several match.
export function resolve(classes, token) {
  const t = String(token).toLowerCase();
  if (!t) return null;
  const exact = classes.find((c) => c.code === t) ?? classes.find((c) => c.slug === t);
  if (exact) return exact;
  const prefixed = classes.filter((c) => c.slug.startsWith(t));
  return prefixed.length === 1 ? prefixed[0] : null;
}
