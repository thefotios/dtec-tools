# DTTEC Tools

Class and passive combo viewer for Drill to Earth's Core. Pick a base class and up to three passives (levels 1 to 3) to see the combined effects. Client-side only: static ES modules, no framework, data in `data/classes.json`, hosted on GitHub Pages.

## URL format

A build is a path: `/scout/sal2sal3prie3` is base class Scout with passives Salvager 2, Salvager 3, Priest 3. The first segment is the base class, the second is the passive run: class code plus one level digit (1 to 3), repeated, at most three groups.

Class tokens are lenient: an exact code, an exact slug, or any slug prefix that matches exactly one class (`scou` is Scout; `pr` is ambiguous and rejected). Tokens are case-insensitive. Invalid tokens are dropped with a notice. The app rewrites the address bar to the canonical form (base slug, then codes plus levels), so `/scou/sal2` becomes `/scout/sal2`.

Class codes:

$table

## My classes and roster code

My classes lists the classes you own as rows with a pill showing the level (`L3`). Expanding a row lists the five levels with their effects; tapping a level unlocks every level up to it (levels are cumulative), and tapping your current top level steps back one level. "Remove class" returns it to unowned. Marks persist in the browser.

"Edit" in the My classes panel lists every class, with a "+" pill that buys level 1 of an unowned class; "Done" returns to the owned list. Edit mode is not saved and is not part of any URL. The filter box applies in both modes.

The build page lists only the classes you own, plus the selected base, and its passive picker lists only owned classes and levels, plus selected passives. A selected base or passive you don't own is flagged "Not owned". With no classes marked, the class list says so and links to My classes. A team card with an imported roster is filtered the same way by that roster.

The roster code encodes your marks as a short string you can paste in Roblox chat. It has one symbol per class, in the order of `data/classes.json`, giving the highest owned level: `X` is 0, `B` is 1, `C` is 2, `D` is 3, `F` is 4, `G` is 5. The symbols are consonants only, so codes can't spell words. Like FEN notation, a run of three or more identical symbols is written as a count plus the symbol (`16X`), while runs of one or two stay literal (`XX`). Trailing unowned classes are trimmed, and an empty roster is `X`. For example, `16XF5XD` is level 4 on the 17th class and level 3 on the 23rd, and `31D` is every class at level 3.

Decoding is case-insensitive, ignores spaces and hyphens, and maps `O` to `0` and `I`/`L` to `1`. Classes past the end of a code count as unowned, so codes stay valid when classes are added. Old codes starting with `A` still import. Invalid text shows an inline error and leaves your marks unchanged.

A team lead imports a player's code in the team view to see what that player owns.

## Team view

`/team/scout.sal2~miner.rec1` is a team plan: builds separated by `~`, each `<base>.<passive run>`, up to 8 players. `_` is an empty card. The URL carries builds only. Player labels and roster codes stay in the lead's browser.

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

1. Copy an existing entry and append it at the END of `classes` in `data/classes.json`. Never reorder or insert: file order drives roster codes, and the check fails if it differs from the order of `scripts/codes.lock.json`.
2. Fill every field: `code`, `slug` (lowercase letters only), `name`, `tier` (a key of `tiers`), `event`, `gear`, five `levels` (level 4 has `"tag": "team"`, level 5 has `"tag": "master"`, levels 1 to 3 have no tag), `source`. Use any placeholder for `code` for now.
3. Run `npm run check`. It fails with the expected code: `cannoneer: not in the registry; expected code "ca"`, with ` (has "...")` appended when your code differs.
4. Set `code` on the entry to the expected value.
5. Append `"<code>": "<slug>"` to the END of `scripts/codes.lock.json`, e.g. `"ca": "cannoneer"`.
6. Run `npm run check` again. It prints `data ok`. Run `npm test`.

The code is the shortest prefix of the slug that is not an existing code and is a prefix of no other slug; if none qualifies, it is the full slug. Examples: `cannoneer` gets `ca` (`c` is taken by Crafter); `prince` beside `princess` gets `prince`, since `prince` is a prefix of `princess` and no shorter prefix is free. Registered codes never change, even when later classes would have produced a shorter one. Merging to `main` deploys.
