# DTEC Tools

Class and passive combo viewer for Drill to Earth's Core. Pick a base class and up to three passives (levels 1 to 3) to see the combined effects. Client-side only: static ES modules, no framework, data in `data/classes.json` and `data/effects.json`, hosted on Cloudflare Workers.

## URL format

A build code is the URL path: `/c5-sc1sal23` is base class Crafter at level 5 with passives Scout 1, Salvager 2, Salvager 3. It is hyphen-separated: the first segment is the base class code plus its level (1 to 5); a later segment ending in a digit is the passive run; a later segment ending in a roster letter (`X B C D F G`) is the roster code. The passive run and the roster are each optional and each used once, in either order. Output is always in the order build, passive run, roster.

The passive run is class code plus one or more level digits (1 to 3), repeated, at most three passives, no duplicates, never the base class. Several levels of one class share its code: `sal23` is Salvager 2 and Salvager 3, the same as `sal2sal3`. Class tokens are exact codes, case-insensitive. Passives are written in canonical order: class list order in `data/classes.json`, then level, with a class's levels combined, so Scout 1, Salvager 2, Salvager 3 is `sc1sal23` (Scout precedes Salvager). Any order and either form is accepted on input.

Two query parameters carry the rest of a share link. `u` is the player's username. `s` is every other saved passive set, as dot-separated `<base code>-<passive run>` items: `?s=mi-rec1sc2.sal-c2` is Miner with Recruit 1 and Scout 2, and Salvager with Crafter 2. `u` and `s` are independent and either may be absent. A full link is `/c5-sc1sal23-D5XB8XG5XD?u=thefotios&s=mi-rec1sc2`.

A share input is accepted as a full URL on any host, a path, or a bare code. Invalid tokens, extra path segments, malformed `s` items, and a roster that fails to decode are dropped with a notice. An unknown base class or level rejects the input with a reason.

Class codes:

$table

## Builds page

The Builds page is the first header tab. It has two columns: your classes on the left, the selected class's loadout on the right. On a phone the loadout follows the class list, and a "Loadout" button in the list header jumps to it.

The class list shows the classes you own in tier order, each with a pill showing the level (`L3`). Tapping a class selects it as the base class. Its five levels head the loadout column, unlocked levels in color and locked ones dimmed and marked "Locked". Marks persist in the browser. Each class name is accompanied by its icon (`icons/<code>.png`, the single-circle base icon) in the class list, the loadout title, passive rows, the team matrix, and the Players library.

"Edit" in the class list is the only place to change what you own. It shows every class, with a "+" pill that buys level 1 of an unowned class. Tapping a row only expands it and never changes the selected class. Tapping a level unlocks every level up to it (levels are cumulative), and tapping your current top level steps back one level. "Remove class" returns a class to unowned. "Done" returns to the owned list. Edit mode is not saved and is not part of any URL. The filter box applies in both modes.

A selected base class or passive you don't own is flagged "Not owned". With no classes marked, the list says so and the loadout asks you to pick a class.

The address bar shows the build code of the selected class at your owned level, such as `/c5-sc1sal23`. A class you own at level 0 shows `/`, and both copy actions are disabled with "Unlock <class> to share".

The sharing actions sit in the title row of the base class panel (the class's five levels), for your own build only. "Copy link" copies the full share URL: the build code with your roster segment, `u` when you have a username, and `s` when you have saved sets for other classes. "Copy code" copies the build code with the roster segment, such as `c5-sc1sal23-D5XB8XG5XD`, short enough for chat. If the clipboard is unavailable, the text appears in a field to copy by hand. The header holds navigation only.

The Combined effects panel follows the passives panel and sums the stat effects of the unlocked base levels and the chosen passives: each stat shows a total with its sources, grouped by category. Effects that apply only in a situation are listed under Conditional, boolean effects under Flags, bonuses that grow with proximity under Nearby, and effects tied to an open game question under Uncertain. A row marked "rounded" includes values scaled by Recruit level 5 and rounded to 1 decimal, and "stacking unconfirmed" marks a stat fed by more than one copy of the same class. The panel also appears on opened builds.

## Passive sets

Each base class has its own set of up to 3 passives, saved in the browser. Selecting a class loads that class's saved set, or an empty set if none is saved. The same passive can be in any number of classes' sets, but not twice in one set, and a class is never its own passive. The last selected class is remembered, and opening `/` restores it with its saved set.

The loadout panel is titled "<Class> passives (n/3)". It lists the selected passives as level rows headed by their class. "Clear" in the passive picker (Edit) removes them.

"Edit" in the loadout opens the passive picker and "Done" closes it. The picker has one row per owned class (plus classes of selected passives), with levels 1 to 3 written out like the class list rows. Select up to 3 across the whole list; the base class is not listed. Levels above what you own are shown gray and marked "Locked", and cannot be selected, so you can see what to level next. The "Unlocked only" checkbox in the picker header hides locked levels, and the choice is saved.

Opening your own link with passives, such as `/c5-sc1sal23`, shows the link's passives without changing the saved set for that class. A bare code without passives loads the saved set. Editing passives on a link view saves the displayed set. Selecting the already-selected class while viewing a link reloads its saved set. `s` on your own link is ignored and never overwrites your saved sets.

## Roster code

The roster code encodes your marks as a short string. It has one symbol per class, in the order of `data/classes.json`, giving the highest owned level: `X` is 0, `B` is 1, `C` is 2, `D` is 3, `F` is 4, `G` is 5. The symbols are consonants only, so codes can't spell words. Like FEN notation, a run of three or more identical symbols is written as a count plus the symbol (`16X`), while runs of one or two stay literal (`XX`). Trailing unowned classes are trimmed, and an empty roster is `X`. For example, `15XF` is level 4 on the 16th class (Crafter), and `31D` is every class at level 3. In a link it is the last hyphen segment, as in `/c5-sc1sal23-15XF`.

Decoding is case-insensitive, ignores spaces, and maps `O` to `0` and `I`/`L` to `1`. Classes past the end of a code count as unowned, so codes stay valid when classes are added. `E` and `U` are reserved as version markers. Invalid text shows an inline error and leaves your marks unchanged.

The "You" panel at the top of the class list is a compact identity row. With a username set it shows the name and an "Edit" (pencil) button that swaps in the input with Save and Cancel; Enter saves and Escape cancels. Without a username it shows the input directly with a Save button. Below it, the always-visible "Import link or code" box takes any share input; it is shown for your own view and while another player is viewed. Your own link and code are shared with the buttons on the base class panel.

A username is 3 to 20 letters, digits, or one underscore that is not at either end, compared case-insensitively.

## Players

Opening someone else's link shows their build in the same read-only view as a saved player: base levels unlocked per their roster (or the code's level when there is none), passives shown without an Edit button, and the link's name in the Viewing select. A link whose `u` matches a saved player opens that saved record with no banner when its data matches, and with an "Update <name>" banner when the link carries a newer roster or passives. Any other someone else's link shows a banner reading "<name>'s build" with a name field prefilled from `u` and a "Save to players" button. A link is someone else's when its `u` is not your username, or when it has no `u` and carries a roster or `s`. The name follows the username rules and your own username is rejected ("That's you"). After saving, the button becomes "Saved" with a link to the Team page.

The You panel on the Builds page has a Viewing select listing Me, each saved player, and the opened link when there is one. Picking a player shows their classes, levels and saved passives read-only, with a Remove button that deletes them from the library and the team and returns to Me. The address bar holds that player's share link, so Back, reload, Copy link and Copy code all follow the view. While viewing, Edit on the loadout lets you try other passives as an experiment: changed passives are tagged NEW, the saved ones they replace stay as ORIGINAL rows, and Revert restores the saved set. Combined effects are labelled Experiment while one is active. Experiments live in memory only, so a reload drops them; they never change the saved player and never reach the Team page.

## Import box

The "Import link or code" box in the You panel accepts, with surrounding whitespace ignored, a full share link on any host, a path, a build code with or without a roster segment, a bare roster code, or a team link. Each input has one outcome:

| Input | Outcome |
|---|---|
| Link or code whose `u` is your username | Updates your build, after a confirm when it would replace existing data |
| Link or code whose `u` is another valid name | Saved to the players at once: "Added <name>" or "Updated <name>" with a "View" button |
| Link or code whose `u` is a name while your username is unset | "Whose build is this?" with the name prefilled; "Mine" also sets your username |
| Build code or link with no `u`, or a `u` that fails the username rules | "Whose build is this?" with any name prefilled |
| Bare roster code | Replaces your owned classes only, after a confirm |
| Team link | Opens that team on the Team page; nothing is saved |
| Anything else | Inline error; the typed text stays in the box |

Updating your own build writes only what the input carries. A roster segment replaces your owned classes, with the code's base level winning; without one only the base class level is set. A full share link (with a URL scheme) that carries a roster is a complete snapshot and replaces every passive set, clearing the ones it does not list. Any other input replaces every set only when it has `s`; otherwise only the base class's set is replaced, and cleared when the code has no passives. The imported base becomes your selected class and the view returns to Me. The confirm appears only when the import would replace classes or passive sets you already have, and it names what is replaced.

The "Whose build is this?" prompt offers "Mine", which updates your build as above, and "Save as" with a name field, which follows the username rules, saves to the players like a named input and rejects your own username with a pointer to "Mine". Cancel changes nothing. Notices about dropped tokens or extra roster classes show under the box after a successful import. An error or an open prompt keeps the typed text; editing the box or pressing Import again dismisses the prompt. This is how you restore your build on another device: paste your own link or code.

## Team

The Team page holds one team with an editable name and up to 8 members, and below it the Players list: you first, then each saved player with a Remove button that deletes them from the library and the team. The Players list has no paste form; its empty state points to the import box on Builds. A player record holds the name, a base class, the highest owned level per class, and a passive set per class.

"Me" is a live entry computed from your owned marks, saved sets and username on the Builds page, listed first and never removable. Without a valid username it shows "Set your username" and cannot join the team. Removing a player removes them from the team. Changing your username re-keys your team membership. Setting your username to a saved player's name asks whether it is you, and confirming merges that player into Me.

The team is stored in the v1 shape with exactly one team (`teams` holds one entry and `active` points to it), so the previous version of the app can still read it. On first load after the update, stored teams collapse to one: the active team, else the first, else an empty team. Saved players and your username are unchanged.

The team is a table. Columns run left to right: the effect with its scope tag, one column per member in team order, a narrow "+" column, then Team total. Each member header shows the player's name ("(you)" for me), a class select limited to the classes that player owns, and a Remove button. The "+" header adds a player with their saved class (me with my selected class). Each row is one effect tagged self, team or nearby, with that member's summed contribution at their level and saved passives; a member who does not contribute has an empty cell, and sources are not shown. Rows are grouped as in Combined effects: categories, then Conditional per situation, Flags, Nearby and Uncertain per open question; a stat with both self and team contributions has two rows. Team total sums the member cells of team-scope rows with a number; self, nearby and uncertain rows have no total, and a flag shows a check mark. A row is marked "rounded" or "stacking unconfirmed" by the same rules as Combined effects, and the Recruit level 5 scaling note shows under the table when it applies. A row with two or more contributing members is marked ×N and has the accessible name "shared by N players". Passives are never edited on the Team page. With no members the table shows the "+" column and a line explaining how to add players. The header row stays visible while the table scrolls, and on a phone the table scrolls sideways inside its panel with the effect column pinned.

A team link is `/team/ann.c5-sc1sal23~bob.mi3-rec1?n=Raid%20night`: members separated by `~`, each `<name>.<build code>` with the selected class, its level, and that class's passives only, and the team name in `n` (at most 40 characters). The Team page address bar is `/team`; "Copy team link" in the team panel header copies the team's link and is disabled with "Add players to share" while the team is empty. Opening a team link shows the linked team as the same table, read-only (class as text, no Remove, no "+"), with "Replace my team" and "Copy link". Replace asks for confirmation when your team has members or when the link includes players already saved, whose base level and passives it would update. It sets your team's name and members from the link, adds players that are not in the library, updates saved players with the link's class, level and passives for that class, maps your own name to Me, and opens `/team`. A link that matches your team shows "This is your team". A repeated member name (case-insensitive) is dropped with a notice. Links never import anything on their own.

## Help

The Help page at `/help` is reached from the "Help" button in the header and from the "New here? See Help" link in the first-run empty states on the Builds and Team pages. It explains getting started, sharing a build, importing, the team and its table, how to read a code (with a table of class codes generated from `data/classes.json`), and where your data is stored. It is handled before build-code parsing, so `help` is never read as a class code.

## Local development

```
npm run serve   # http://localhost:8080 (env PORT, BASE_PATH)
npm test        # node --test
npm run check   # validate data/classes.json against scripts/codes.lock.json
npm run build   # static site into dist/ (env BASE_PATH, default /)
```

Node only, no dependencies. `BASE_PATH` is the sub-path the site is served under, e.g. `BASE_PATH=/dtec-tools/ npm run build`.

## Deploy

Cloudflare Workers static assets, configured in `wrangler.jsonc`: `dist/` served at the domain root, with unknown paths answered by `index.html` (status 200) so build and team links open directly. Cloudflare Workers Builds deploys every push to `main`. One-time setup: in the Cloudflare dashboard, Workers & Pages, Create, Import a repository, pick this repo, build command `npm run build`, deploy command `npx wrangler deploy`.

`.github/workflows/ci.yml` runs check, tests and build on pull requests and pushes to `main`.

## Adding a class

1. Copy an existing entry and append it at the END of `classes` in `data/classes.json`. Never reorder or insert: file order drives roster codes and canonical passive order, and the check fails if it differs from the order of `scripts/codes.lock.json`.
2. Fill every field: `code`, `slug` (lowercase letters only), `name`, `tier` (a key of `tiers`), `event`, `gear`, five `levels` (level 4 has `"tag": "team"`, level 5 has `"tag": "master"`, levels 1 to 3 have no tag), `source`. Every level also needs a non-empty `effects` array of `{stat, value?, scope, when?, uncertain?}`: `stat` is a stat id from `data/effects.json`, `value` is a number and is omitted for flag stats, `scope` is `self`, `nearby` or `team` (level 4 effects are `team` or `nearby`, never `self`), `when` is an id from `whens` for conditional effects, and `uncertain` is an id from `questions` for effects whose behavior is unconfirmed. Use any placeholder for `code` for now.
3. Run `npm run check`. It fails with the expected code: `cannoneer: not in the registry; expected code "ca"`, with ` (has "...")` appended when your code differs.
4. Set `code` on the entry to the expected value.
5. Append `"<code>": "<slug>"` to the END of `scripts/codes.lock.json`, e.g. `"ca": "cannoneer"`.
6. Add `icons/<code>.png`: 72x72, white glyph on a transparent background, the inner glyph of the class's single-circle base icon. `npm run check` and `npm run build` fail while a class has no icon.
7. Run `npm run check` again. It prints `data ok`. Run `npm test`.

The code is the shortest prefix of the slug that is not an existing code and is a prefix of no other slug; if none qualifies, it is the full slug. Examples: `cannoneer` gets `ca` (`c` is taken by Crafter); `prince` beside `princess` gets `prince`, since `prince` is a prefix of `princess` and no shorter prefix is free. Registered codes never change, even when later classes would have produced a shorter one. Merging to `main` deploys.
