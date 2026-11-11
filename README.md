# DTEC Tools

Class and passive combo viewer for Drill to Earth's Core. Pick a base class and up to three passives (levels 1 to 3) to see the combined effects. Client-side only: static ES modules, no framework, data in `data/classes.json` and `data/effects.json`, hosted on Cloudflare Workers.

## URL format

A build code is the URL path: `/c5-sc1sal23` is base class Crafter at level 5 with passives Scout 1, Salvager 2, Salvager 3. It is hyphen-separated: the first segment is the base class code plus its level (1 to 5); a later segment ending in a digit is the passive run; a later segment ending in a roster letter (`X B C D F G`) is the roster code. The passive run and the roster are each optional and each used once, in either order. Output is always in the order build, passive run, roster.

The passive run is class code plus one or more level digits (1 to 3), repeated, at most three passives, no duplicates, never the base class. Several levels of one class share its code: `sal23` is Salvager 2 and Salvager 3, the same as `sal2sal3`. Class tokens are exact codes, case-insensitive. Passives are written in canonical order: class list order in `data/classes.json`, then level, with a class's levels combined, so Scout 1, Salvager 2, Salvager 3 is `sc1sal23` (Scout precedes Salvager). Any order and either form is accepted on input.

Two query parameters carry the rest of a share link. `u` is the person's name. `s` is every other saved passive set, as dot-separated `<base code>-<passive run>` items: `?s=mi-rec1sc2.sal-c2` is Miner with Recruit 1 and Scout 2, and Salvager with Crafter 2. `u` and `s` are independent and either may be absent. A full link is `/c5-sc1sal23-D5XB8XG5XD?u=thefotios&s=mi-rec1sc2`.

A share input is accepted as a full URL on any host, a path, or a bare code. Invalid tokens, extra path segments, malformed `s` items, and a roster that fails to decode are dropped with a notice. An unknown base class or level rejects the input with a reason.

Class codes:

$table

## Builds page

The Builds page is the first header tab. It has two columns: the people cards and the selected person's classes on the left, that person's selected class and loadout on the right. On a phone the loadout follows the class list, and a "Loadout" button in the list header jumps to it.

The top-left panel is the people cards: Me first, then every saved person A to Z by name (case ignored), then a "+" card. A card shows the name and the person's class with its icon, name and level, "No classes" for a person who owns none, and "Me" for a Me without a name. Me's card is marked as mine. Clicking a card selects that person, highlights the card, and shows that person's class list and loadout. The selection survives switching between Builds, Team and Help and a reload of `/`. Below 720px the cards form one horizontally scrolling row and the selected card is scrolled into view.

The "+" card opens a name form in a full-width region directly under the cards. A valid name creates a person with no classes and selects them; an invalid or taken name shows an inline error and creates nothing. Cancel and Escape close the form. The selected card has an edit menu button with Rename and Delete; Me's menu has Rename only. Rename saves the new name at once, and the person keeps their place on the team and stays selected. Delete asks for a confirm in the same region, which says so when the person is on the team, then removes the person and selects Me. There is no undo.

A name is 3 to 20 letters, digits, or one underscore that is not at either end, unique across all people and compared case-insensitively. Me may have no name unless Me is on the team. A link or code carries a person's name in `u`, so a rename changes the name that links match; a link that carries an old name counts as an unknown name.

The class list shows the classes the selected person owns in tier order, each with a pill showing the level (`L3`). Tapping a class selects it as the base class. Its five levels head the loadout column, unlocked levels in color and locked ones dimmed and marked "Locked". Marks persist in the browser. Each class name is accompanied by its icon (`icons/<code>.png`, the single-circle base icon) in the class list, the loadout title, passive rows, the team matrix, and the Players library.

"Edit" in the class list is the only place to change what the person owns. It shows every class, with a "+" pill that buys level 1 of an unowned class. Tapping a row only expands it and never changes the selected class. Tapping a level unlocks every level up to it (levels are cumulative), and tapping your current top level steps back one level. "Remove class" returns a class to unowned. "Done" returns to the owned list. Edit mode is not saved and is not part of any URL. The filter box applies in both modes.

A selected base class or passive the person doesn't own is flagged "Not owned". With no classes marked, the list says so and the loadout asks you to pick a class.

The address bar shows the selected person's share path: their share link with `u` (for example `/c5-sc1sal23-D5XB8XG5XD?u=ann`), or `/` when the person has no class to share. While Me has no name, Me's path is the bare build code, such as `/c5-sc1sal23`. A class owned at level 0 shows `/`, and both copy actions are disabled with "Unlock <class> to share".

The sharing actions sit in the title row of the base class panel (the class's five levels), for the selected person. "Copy link" copies the full share URL: the build code with the person's roster segment, `u` when the person has a name, and `s` when they have saved sets for other classes. "Copy code" copies the build code with the roster segment, such as `c5-sc1sal23-D5XB8XG5XD`, short enough for chat. If the clipboard is unavailable, the text appears in a field to copy by hand. The header holds navigation and Import only.

Every person is edited the same way: class levels in the class list Edit, the selected class, and the passive set of each class. Each change is saved at once to that person only. A person created from a code without a roster has unknown class levels, so the passive picker treats levels 1 to 3 of every class as unlocked until the first level edit for that person.

Typing a build URL with no name, such as `/bo5-mi3`, shows its class and passives on the selected person, Me or another card, with their class levels as stored: a class or passive the person lacks is flagged "Not owned". A roster segment and `s` in such a URL are ignored, and a URL with no passive run keeps the person's stored set for that class. While the shown build is not what the person has stored, the base panel shows a Save button in place of Copy link and Copy code, an "Unsaved build" label next to it names each class level Save will raise (here Bounty Hunter 5 and Miner 3), and the loadout offers no passive Edit. Save sets the build's class and raises the person's class levels so every class the build uses is owned: `/bo5-mi3` sets Bounty Hunter to level 5 and Miner to at least level 3. A level that is already higher is never lowered, and nothing else in the roster changes. A URL with a passive run replaces that class's passive set; a URL with no passive run leaves the stored set as it is. After Save the share buttons return and the address bar shows the person's share path. Selecting a class or a card, opening class Edit, or changing a level discards an unsaved build. A URL build that would change nothing only selects its class.

The Combined effects panel follows the passives panel and sums the stat effects of the unlocked base levels and the chosen passives: each stat shows a total with its sources, grouped by category. Effects that apply only in a situation are listed under Conditional, boolean effects under Flags, bonuses that grow with proximity under Nearby, and effects tied to an open game question under Uncertain. A row marked "rounded" includes values scaled by Recruit level 5 and rounded to 1 decimal, and "stacking unconfirmed" marks a stat fed by more than one copy of the same class. The panel also appears on opened builds.

## Passive sets

Each person has, per base class, a set of up to 3 passives, saved in the browser. Selecting a class loads that person's saved set for it, or an empty set if none is saved. The same passive can be in any number of classes' sets, but not twice in one set, and a class is never its own passive. The selected person and class are remembered, and opening `/` restores them with the saved set.

The loadout panel is titled "<Class> passives (n/3)". It lists the selected passives as level rows headed by their class. "Clear" in the passive picker (Edit) removes them.

"Edit" in the loadout opens the passive picker and "Done" closes it. The picker has one row per owned class (plus classes of selected passives), with levels 1 to 3 written out like the class list rows. Select up to 3 across the whole list; the base class is not listed. Levels above what you own are shown gray and marked "Locked", and cannot be selected, so you can see what to level next. The "Unlocked only" checkbox in the picker header hides locked levels, and the choice is saved.

A build URL with passives shows those passives for the selected person without changing the saved set; Save in the base panel stores them (see Builds page). A bare code without passives shows the saved set.

## Roster code

The roster code encodes your marks as a short string. It has one symbol per class, in the order of `data/classes.json`, giving the highest owned level: `X` is 0, `B` is 1, `C` is 2, `D` is 3, `F` is 4, `G` is 5. The symbols are consonants only, so codes can't spell words. Like FEN notation, a run of three or more identical symbols is written as a count plus the symbol (`16X`), while runs of one or two stay literal (`XX`). Trailing unowned classes are trimmed, and an empty roster is `X`. For example, `15XF` is level 4 on the 16th class (Crafter), and `33D` is every class at level 3. In a link it is the last hyphen segment, as in `/c5-sc1sal23-15XF`.

Decoding is case-insensitive, ignores spaces, and maps `O` to `0` and `I`/`L` to `1`. Classes past the end of a code count as unowned, so codes stay valid when classes are added. `E` and `U` are reserved as version markers. Invalid text shows an inline error and leaves your marks unchanged.

## People

Every person is a record with a name, a base class, the highest owned level per class, and a passive set per class. Me is always the first person and can be unnamed; every other person has a name. All of them are edited the same way on Builds, and the roster and passives you see for a person are the stored data.

Opening a share URL from outside the app (typed, clicked or bookmarked) has one outcome by what it carries:

| URL carries | Outcome |
|---|---|
| A name that is not saved | A temporary card |
| A saved person's name | That person is selected; when the link's data differs from the saved data, an "Update <name>" banner offers Yes and Dismiss |
| Me's name | Me is selected; when the link would change Me's data, a confirm for your own update shows first |
| No name | The build is shown on the selected person as an unsaved build |
| An invalid code | The stored selection, with the invalid-link notice |

The temporary card sits last before the "+" card and shows the link's name. It is read-only: no class Edit, no passive picker, no edit menu. Its Save button opens a name form, prefilled, that saves the person like "Save as" in the import prompt and then selects them. Selecting another card discards it. It is never offered on the Team page.

A pending Update banner or own-update confirm keeps the incoming URL in the address bar, so a reload shows it again. It lists what it replaces. Yes applies the link; Dismiss leaves the stored data untouched. Either way the address bar then shows the person's share path, and selecting another card also clears it. Nothing is written until Yes.

Back and Forward restore which person and class were shown, always with the stored data, and never import from a URL. An entry for a deleted person shows Me.

## Import

The "Import" button in the header opens a paste panel below it on every page. It takes, with surrounding whitespace ignored, a full share link on any host, a path, a build code with or without a roster segment, a bare roster code, or a team link. Each input has one outcome:

| Input | Outcome |
|---|---|
| Team link | The panel closes and the Team page shows that link read-only; nothing is saved |
| Bare roster code | Replaces Me's owned classes, after a confirm when classes exist; Me is selected |
| Link or code whose `u` is Me's name | Updates Me, after a confirm when it replaces existing data; Me is selected |
| Link or code whose `u` is a saved person's name | Applies to that person without asking: a full link replaces the record, a bare code updates only its class; "Updated <name>" |
| Link or code whose `u` is another valid name, while Me has a name | Creates that person; "Added <name>" |
| Link or code whose `u` is an unsaved valid name, while Me has no name | "Whose build is this?" with the name prefilled; "Mine" also names Me |
| Build code or link with no `u`, or a `u` that fails the name rule | "Whose build is this?" with any name prefilled |
| Anything else | Inline error; the typed text stays in the box |

Updating Me writes only what the input carries. A roster segment replaces your owned classes, with the code's base level winning; without one only the base class level is set. A full share link (with a URL scheme) that carries a roster is a complete snapshot and replaces every passive set, clearing the ones it does not list. Any other input replaces every set only when it has `s`; otherwise only the base class's set is replaced, and cleared when the code has no passives. The confirm appears only when the import would replace classes or passive sets that exist, and it names what is replaced.

The "Whose build is this?" prompt offers "Mine", which updates Me as above, "Save as" with a name field, and Cancel. Save as follows the name rules and applies the import to a saved person's name like a named input; Me's name is rejected with a pointer to Mine. Notices about dropped tokens or extra roster classes show under the box after a successful import. An error or an open prompt keeps the typed text; editing the box or pressing Import again dismisses the prompt.

After an import that adds or updates a person, that person is selected and the current page stays. The message offers a "View" button that opens Builds when the current page is not Builds. Escape and the Close button close the panel and return focus to the Import button; closing discards a pending prompt. This is how you restore your build on another device: paste your own link or code.

## Team

The Team page holds one team with an editable name and up to 8 members, and below it the Players panel: Me, then every saved person, with their class and level and their number of passive sets. The panel has no paste form and no Remove buttons; its empty state points to the Import button. Delete a person from their card on Builds.

Only people who have a name and own at least one class can be added to the team, with the "+" column listing them; a hint under the team names the others and why they are missing. Me can join once named. Deleting a person removes them from the team. Renaming keeps them on it, and Me's name is needed while Me is on the team.

All app data is stored in the browser entry `dtec:people`, version 1: `{v, seq, people, team, selected, unlockedOnly}`, where `people` holds the records (Me has id `me`, everyone else a stable id such as `p3`), `team` holds the name and the members as `{id, base}`, `selected` is the selected person, and `unlockedOnly` is the passive picker preference, one setting for all people. The first load starts with one unnamed Me with no classes.

The team is a table. Columns run left to right: the effect with its scope tag, one column per member in team order, a narrow "+" column, then Team total. Each member header shows the person's name ("(you)" for Me), a class select limited to the classes that person owns, and a Remove button that takes them off the team. The "+" header adds a person with their saved class. Each row is one effect tagged self, team or nearby, with that member's summed contribution at their level and saved passives; a member who does not contribute has an empty cell, and sources are not shown. Rows are grouped as in Combined effects: categories, then Conditional per situation, Flags, Nearby and Uncertain per open question; a stat with both self and team contributions has two rows. Team total sums the member cells of team-scope rows with a number; self, nearby and uncertain rows have no total, and a flag shows a check mark. A row is marked "rounded" or "stacking unconfirmed" by the same rules as Combined effects, and the Recruit level 5 scaling note shows under the table when it applies. A row with two or more contributing members is marked ×N and has the accessible name "shared by N players". Passives are never edited on the Team page. With no members the table shows the "+" column and a line explaining how to add players. The header row stays visible while the table scrolls, and on a phone the table scrolls sideways inside its panel with the effect column pinned.

A team link is `/team/ann.c5-sc1sal23~bob.mi3-rec1?n=Raid%20night`: members separated by `~`, each `<name>.<build code>` with the selected class, its level, and that class's passives only, and the team name in `n` (at most 40 characters). The Team page address bar is `/team`; "Copy team link" in the team panel header copies the team's link and is disabled with "Add players to share" while the team is empty. Opening a team link shows the linked team as the same table, read-only (class as text, no Remove, no "+"), with "Replace my team" and "Copy link". Replace asks for confirmation when your team has members or when the link includes players already saved, whose base level and passives it would update. It sets your team's name and members from the link, adds players that are not in the library, updates saved players with the link's class, level and passives for that class, maps your own name to Me, and opens `/team`. A link that matches your team shows "This is your team". A repeated member name (case-insensitive) is dropped with a notice. Links never import anything on their own.

## Help

The Help page at `/help` is reached from the "Help" button in the header and from the "New here? See Help" link in the first-run empty states on the Builds and Team pages. It explains getting started, the people cards, sharing a build and saving a build URL, importing from the header, the team and its table, how to read a code (with a table of class codes generated from `data/classes.json`), and where your data is stored. It is handled before build-code parsing, so `help` is never read as a class code.

## Local development

```
npm run serve   # http://localhost:8080 (env PORT, BASE_PATH)
npm test        # node --test
npm run check   # validate data/classes.json against scripts/codes.lock.json
npm run build   # static site into dist/ (env BASE_PATH, default /)
```

Node only, no dependencies. `BASE_PATH` is the sub-path the site is served under, e.g. `BASE_PATH=/dtec-tools/ npm run build`.

## Deploy

Cloudflare Workers static assets, configured in `wrangler.jsonc`: `dist/` served at the domain root, with unknown paths answered by `index.html` (status 200) so build and team links open directly. Every push to `main` runs the CI workflow (`.github/workflows/ci.yml`): data check, tests, and build, then a `deploy` job that runs `wrangler deploy` once they pass. It needs two repository secrets: `CLOUDFLARE_API_TOKEN` (a token from the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`. To deploy by hand, run `npm run build && npx wrangler deploy`.

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
