# DTTEC Tools

Class and passive combo viewer for Drill to Earth's Core. Pick a base class and up to three passives (levels 1 to 3) to see the combined effects. Client-side only: static ES modules, no framework, data in `data/classes.json`, hosted on GitHub Pages.

## URL format

A build code is the URL path: `/c5-sc1sal2sal3` is base class Crafter at level 5 with passives Scout 1, Salvager 2, Salvager 3. It is hyphen-separated: the first segment is the base class code plus its level (1 to 5); a later segment ending in a digit is the passive run; a later segment ending in a roster letter (`X B C D F G`) is the roster code. The passive run and the roster are each optional and each used once, in either order. Output is always in the order build, passive run, roster.

The passive run is class code plus one level digit (1 to 3), repeated, at most three groups, no duplicates, never the base class. Class tokens are exact codes, case-insensitive. Passives are written in canonical order: class list order in `data/classes.json`, then level, so Scout 1, Salvager 2, Salvager 3 is `sc1sal2sal3` (Scout precedes Salvager). Any order is accepted on input.

Two query parameters carry the rest of a share link. `u` is the player's username. `s` is every other saved passive set, as dot-separated `<base code>-<passive run>` items: `?s=mi-rec1sc2.sal-c2` is Miner with Recruit 1 and Scout 2, and Salvager with Crafter 2. `u` and `s` are independent and either may be absent. A full link is `/c5-sc1sal2sal3-D5XB8XG5XD?u=thefotios&s=mi-rec1sc2`.

A share input is accepted as a full URL on any host, a path, or a bare code. Invalid tokens, extra path segments, malformed `s` items, and a roster that fails to decode are dropped with a notice. An unknown base class or level rejects the input with a reason.

Class codes:

$table

## Classes page

The Classes page has two columns: your classes on the left, the selected class's loadout on the right. On a phone the loadout follows the class list, and a "Loadout" button in the list header jumps to it.

The class list shows the classes you own in tier order, each with a pill showing the level (`L3`). Tapping a class selects it as the base class. Its five levels head the loadout column, unlocked levels in color and locked ones dimmed and marked "Locked". Marks persist in the browser.

"Edit" in the class list is the only place to change what you own. It shows every class, with a "+" pill that buys level 1 of an unowned class. Tapping a row only expands it and never changes the selected class. Tapping a level unlocks every level up to it (levels are cumulative), and tapping your current top level steps back one level. "Remove class" returns a class to unowned. "Done" returns to the owned list. Edit mode is not saved and is not part of any URL. The filter box applies in both modes.

A selected base class or passive you don't own is flagged "Not owned". With no classes marked, the list says so and the loadout asks you to pick a class.

The address bar shows the build code of the selected class at your owned level, such as `/c5-sc1sal2sal3`. A class you own at level 0 shows `/`, and both copy actions are disabled with "Unlock <class> to share".

"Copy my code" copies that build code, short enough for chat. "Copy link" copies the full share URL: the build code with your roster segment, `u` when you have a username, and `s` when you have saved sets for other classes.

## Passive sets

Each base class has its own set of up to 3 passives, saved in the browser. Selecting a class loads that class's saved set, or an empty set if none is saved. The same passive can be in any number of classes' sets, but not twice in one set, and a class is never its own passive. The last selected class is remembered, and opening `/` restores it with its saved set.

The loadout panel is titled "<Class> passives (n/3)". It lists the selected passives as level rows headed by their class, and "Clear" removes the passives.

"Edit" in the loadout opens the passive picker and "Done" closes it. The picker has one row per owned class (plus classes of selected passives), with levels 1 to 3 written out like the class list rows. Select up to 3 across the whole list; the base class is not listed. Levels above what you own are shown gray and marked "Locked", and cannot be selected, so you can see what to level next. The "Unlocked only" checkbox in the picker header hides locked levels, and the choice is saved.

Opening your own link with passives, such as `/c5-sc1sal2sal3`, shows the link's passives without changing the saved set for that class. A bare code without passives loads the saved set. Editing passives on a link view saves the displayed set. Selecting the already-selected class while viewing a link reloads its saved set. `s` on your own link is ignored and never overwrites your saved sets.

## Roster code

The roster code encodes your marks as a short string. It has one symbol per class, in the order of `data/classes.json`, giving the highest owned level: `X` is 0, `B` is 1, `C` is 2, `D` is 3, `F` is 4, `G` is 5. The symbols are consonants only, so codes can't spell words. Like FEN notation, a run of three or more identical symbols is written as a count plus the symbol (`16X`), while runs of one or two stay literal (`XX`). Trailing unowned classes are trimmed, and an empty roster is `X`. For example, `15XF` is level 4 on the 16th class (Crafter), and `31D` is every class at level 3. In a link it is the last hyphen segment, as in `/c5-sc1sal2sal3-15XF`.

Decoding is case-insensitive, ignores spaces, and maps `O` to `0` and `I`/`L` to `1`. Classes past the end of a code count as unowned, so codes stay valid when classes are added. `E` and `U` are reserved as version markers. Invalid text shows an inline error and leaves your marks unchanged.

The "You" panel at the top of the class list is collapsed by default. It holds the username field, your roster code with a Copy button, and a field to paste and import a roster code.

A username is 3 to 20 letters, digits, or one underscore that is not at either end, compared case-insensitively.

## Players and teams

Opening someone else's link shows their build read-only: base levels unlocked per their roster (or the code's level when there is none), passives shown without an Edit button. A banner reads "<name>'s build" with a name field prefilled from `u` and a "Save to players" button. A link is someone else's when its `u` is not your username, or when it has no `u` and carries a roster or `s`. The name follows the username rules and your own username is rejected ("That's you"). When the name matches a saved player the button reads "Update <name>". After saving, the button becomes "Saved" with a link to the Team page.

The Team page has a players library and named teams. The library has one paste box that accepts any share input; a name is required, taken from `u` or from the adjacent name field. Pasting for an existing name updates that player everywhere. A player record holds the name, a base class, the highest owned level per class, and a passive set per class. A link without a roster or `s` merges into the existing record (base, its level, and its set); a link with either replaces it. A team link pasted here is rejected.

"Me" is a live library entry computed from your owned marks, saved sets, and username on the Classes page, listed first and never removable. Without a valid username it shows "Set your username" and cannot join a team. Removing a player removes them from every team. Changing your username re-keys your team memberships. Setting your username to a saved player's name asks whether it is you, and confirming merges that player into Me.

A team has a name and up to 8 members, each a library player; a player can be on many teams, and the active team is remembered. A team card shows the player's name, a class selector limited to classes the player owns, that class's five levels per the player's levels, and the passives the player saved for it, or "No passives saved". Cards never edit passives.

A team link is `/team/ann.c5-sc1sal2sal3~bob.mi3-rec1?n=Raid%20night`: members separated by `~`, each `<name>.<build code>` with the selected class, its level, and that class's passives only, and the team name in `n` (at most 40 characters). The Team page address bar is `/team`; "Copy link" in its header copies the active team's link. Opening a team link shows it read-only with "Save team", which creates the team, adds players whose names are not in the library, maps your own name to Me, and opens `/team`. Links never import anything on their own.

## Local development

```
npm run serve   # http://localhost:8080 (env PORT, BASE_PATH)
npm test        # node --test
npm run check   # validate data/classes.json against scripts/codes.lock.json
npm run build   # static site into dist/ (env BASE_PATH, default /)
```

Node only, no dependencies. `BASE_PATH` is the sub-path the site is served under, e.g. `BASE_PATH=/dttec-tools/ npm run build`.

## Deploy

Cloudflare Workers static assets, configured in `wrangler.jsonc`: `dist/` served at the domain root, with unknown paths answered by `index.html` (status 200) so build and team links open directly. Cloudflare Workers Builds deploys every push to `main`. One-time setup: in the Cloudflare dashboard, Workers & Pages, Create, Import a repository, pick this repo, build command `npm run build`, deploy command `npx wrangler deploy`.

`.github/workflows/ci.yml` runs check, tests and build on pull requests and pushes to `main`.

## Adding a class

1. Copy an existing entry and append it at the END of `classes` in `data/classes.json`. Never reorder or insert: file order drives roster codes and canonical passive order, and the check fails if it differs from the order of `scripts/codes.lock.json`.
2. Fill every field: `code`, `slug` (lowercase letters only), `name`, `tier` (a key of `tiers`), `event`, `gear`, five `levels` (level 4 has `"tag": "team"`, level 5 has `"tag": "master"`, levels 1 to 3 have no tag), `source`. Use any placeholder for `code` for now.
3. Run `npm run check`. It fails with the expected code: `cannoneer: not in the registry; expected code "ca"`, with ` (has "...")` appended when your code differs.
4. Set `code` on the entry to the expected value.
5. Append `"<code>": "<slug>"` to the END of `scripts/codes.lock.json`, e.g. `"ca": "cannoneer"`.
6. Run `npm run check` again. It prints `data ok`. Run `npm test`.

The code is the shortest prefix of the slug that is not an existing code and is a prefix of no other slug; if none qualifies, it is the full slug. Examples: `cannoneer` gets `ca` (`c` is taken by Crafter); `prince` beside `princess` gets `prince`, since `prince` is a prefix of `princess` and no shorter prefix is free. Registered codes never change, even when later classes would have produced a shorter one. Merging to `main` deploys.
