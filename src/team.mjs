import { parseBuildCode, serializeBuildCode } from './code.mjs';
import { isValidName, cleanTeamName, MAX_MEMBERS } from './players.mjs';

function teamNotice(token, reason, message) {
  return { token, reason, message };
}

// Parses a team link: `segment` is the part after "/team" ("/bob.c5-sal2~ann.mi3"), `search` its query string.
// Returns { name, members: [{ name, player }], notices }; player is { name, base, levels, sets } for the member's one class.
// A member with a bad name, no ".", an unknown base, or a name already listed (case-insensitive) is dropped with a notice naming it; members past MAX_MEMBERS are dropped.
export function parseTeamLink(classes, segment, search) {
  const [list = '', ...extras] = String(segment ?? '').split('/').filter(Boolean);
  const notices = [];
  const members = [];
  const seen = new Set();
  for (const raw of list.split('~').filter(Boolean)) {
    const dot = raw.indexOf('.');
    const name = dot < 0 ? '' : raw.slice(0, dot);
    if (dot < 0 || !isValidName(name)) {
      notices.push(teamNotice(raw, 'member', `Member "${raw}" dropped: needs a valid name and a build code`));
      continue;
    }
    if (seen.has(name.toLowerCase())) {
      notices.push(teamNotice(raw, 'duplicate', `Member "${raw}" dropped: "${name}" is already listed`));
      continue;
    }
    const build = parseBuildCode(classes, raw.slice(dot + 1));
    if (!build.base) {
      notices.push(teamNotice(raw, 'member', `Member "${raw}" dropped: ${build.notices[0].message}`));
      continue;
    }
    for (const n of build.notices) notices.push(teamNotice(n.token, n.reason, `Member "${name}": ${n.message}`));
    const player = { name, base: build.base, levels: { [build.base]: build.level }, sets: { [build.base]: build.slots } };
    seen.add(name.toLowerCase());
    members.push({ name, player });
  }
  if (members.length > MAX_MEMBERS) {
    notices.push(teamNotice(String(members.length), 'extra', `Only ${MAX_MEMBERS} members fit; ignored ${members.length - MAX_MEMBERS}`));
    members.length = MAX_MEMBERS;
  }
  if (extras.length) notices.push(teamNotice(extras[0], 'extra', 'extra path ignored'));
  return { name: cleanTeamName(new URLSearchParams(search ?? '').get('n')), members, notices };
}

// team: { name, members: [{ name, base }] }; resolvePlayer(name) returns a player record or null (member skipped).
// Each member carries its stored base while the player owns it (level above 0), else the player's own base.
// Returns base-relative { path, search }.
export function serializeTeamLink(classes, team, resolvePlayer) {
  const parts = [];
  for (const m of team.members ?? []) {
    const player = resolvePlayer(m.name);
    if (!player) continue;
    const base = player.levels?.[m.base] > 0 ? m.base : player.base;
    const code = serializeBuildCode(classes, { ...player, base });
    if (code) parts.push(`${m.name}.${code}`);
  }
  const name = cleanTeamName(team.name);
  return { path: parts.length ? `/team/${parts.join('~')}` : '/team', search: name ? `?n=${encodeURIComponent(name)}` : '' };
}
