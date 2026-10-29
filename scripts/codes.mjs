// Shortest prefix of `slug` that is not an existing code and prefixes no other slug; else the full slug.
export function newCode(slug, existing) {
  const codes = new Set(existing.map((c) => c.code));
  const others = existing.map((c) => c.slug).filter((s) => s !== slug);
  for (let k = 1; k < slug.length; k++) {
    const p = slug.slice(0, k);
    if (!codes.has(p) && !others.some((s) => s.startsWith(p))) return p;
  }
  return slug;
}
