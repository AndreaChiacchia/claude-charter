# Claude-Charter

![version](https://img.shields.io/badge/version-0.3.0-blue)

A mod for the Claude Code CLI for long orchestrated sessions. It draws the plan of a milestone as a one-line progress route under the prompt, right under the hint line, with its stages and parts ticked off as they finish, so you always know where this session is and what its agents are doing. When you split the work across sessions it also shows where the others are. The slot under the prompt reads, top to bottom: the hint line, the route, the [claudepeeker](https://github.com/AndreaChiacchia/claude-peeker) status line, claudespotter's rows, then the row of [claudeticker](https://github.com/AndreaChiacchia/claude-ticker). You can also put the route above the prompt, or keep it only in the `/charter` pane (setting `placement`).

```
╭──────────────────────────────────────────────────────────────────────────────────────╮
│ >                                                                                    │
╰──────────────────────────────────────────────────────────────────────────────────────╯
  ? for shortcuts
  ◖━━━◆━━►━◇━━━◇►━━━◇━━━━◗  28%  M1.6 › 2/5 Planet catalogue › 2/3 Catalogue UI › ● implement  ◐ coverage matrix
  [Opus 5.5 ·high] · mods/main · ctx (1M) ▰▰▱▱▱ 29% · 5h (2h13m) █░░░░ 10% · wk (6d17h) █░░░░ 1%

  Σ $3.21 │ ● FIX │ ███████████████████░░░░░░░ │ $0.42 ▲0.31 │ 312K↓ 2.1K↑
```

Left to right: the start cap `◖`, the track with a marker per stage (`◆` passed, `◇` to come), this session's head `►`, another session's `►` in its own color (a stage another session holds is tinted in its color), the end cap `◗`, the percent, the breadcrumb of the current step (the route, the stage, the part) with the phase it is in (`● implement`), and the signal beside it: here a subagent at work, and at the right end the `⋯` that opens `/charter`.

## Features

- **The route row**, by default under the prompt as the first row after the hint line: one row that never wraps, with no blank line above or below it. The track is a bold teal line on a dim track between two end caps and fills as work finishes; ten styles are available in the `track` setting (`heavy`, `line`, `smooth`, `blocks`, `shade`, `parallelogram`, `squares`, `dots`, `braille`, `ascii`). The end caps are the `trackEnds` setting, the same in every style: by default a capsule `◖ ◗` whose ends are coloured like the bar beside them (the start like the fill, the end like the empty track), or `◉ ◎`, `╺ ╸`, `▐ ▌`, `[ ]`, `｢ ｣`, or `auto` for each style's own (`┣ ┫`, `┠ ┨`, `▐ ▌`, `[ ]`). A finished route turns both caps gold, whatever the choice. The head `►` stands where this session is; every other live session shows as a `►` in its own color (amber, steel blue, pink, green), and a stage another session holds is tinted in that session's color. A dim `⋯` at the right end of the row opens the `/charter` checklist on a click; with placement `above` it reads `c: ⋯`, and `c` opens it once the band holds the focus (a click or ctrl+x tab). On a narrow window the row shrinks in this order: the signal loses its detail, the track shrinks to 10 cells, the route and ancestor titles go, the signal goes, only then does the track go, then the titles, and last the row is cut with `…`. Under 20 columns nothing is drawn. When no step is current it names the next one (`next 3/5 Orbit view`); when the route is complete it rests on a gold `✓ Complete · M1.6 · 5/5`.
- **Placement** (setting `placement`): `under` the prompt (the default; the first row under the hint, so list claudecharter first), `above` the prompt (the band where surveys draw; it yields to them, and `[-]` or ctrl+x ctrl+a collapses it), or `panel` only (no row anywhere; the pane shows the route and moves as the row would, its Signals topped by the running checks and subagents, a toast says when a route is charted, and `/charter demo` plays in the pane). With setting `gapBelow` (on by default) one blank line separates the row from what is drawn under it: the other mods' rows under the prompt (no blank line when nothing is drawn after the row), or the prompt box when the row is above it.
- **Hard signals, seen by the mod itself:**
  - **Subagents** with their description: `◐ coverage matrix`, `+2` when more run.
  - **Test, build and lint commands** run through Bash or PowerShell: a braille spinner while it runs, then `✓` or `✗` with its label for 6 seconds.
  - **Git commits** are attached to the current step (`◈ 1a2b3c4` flashes on the band, the hash stays beside the step in `/charter`).
- **Four effects**, each on or off (all on by default):
  - `glide`: when the route moves forward the head glides to its new place in about 0.8 s with a short bright trail behind it; the fill brightens toward the head like a comet; a move back (parts added under the current step) glides back without the trail. In the /charter pane the track glides too, and a phase pill that is reached fills in.
  - `roll`: the percent and the stage number roll like an odometer, the digits that change flashing. The pane's percent rolls too.
  - `activity`: while a subagent or a check runs its spinner turns and the current step shimmers; the phase dot breathes while Claude works, and the next stage marker ahead of the head softly pulses. In the /charter pane your current step breathes while Claude works, the running checks and subagents are listed with the row's spinners, and an item that turns blocked pulses its ⊘ three times.
  - `celebrate`: a finished part twinkles and shows `✦ Catalogue UI done`; a finished stage sends a gold glint along the track with `✦ Stage 2/5 done ✦` and a twinkling marker; completing the route pulses both caps; a commit flashes its hash. In the /charter pane a finished step twinkles before it settles to ✓, the track shows the same badges, glint and pulse, and a new signal flashes.
- **Stage toasts** (setting `toast`): one when a top-level stage is done and one when the whole route is complete, only in the session that made the change. No toast for subagents or checks: claudespotter owns those.
- **A nudge** (setting `nudge`): when the main conversation starts its first subagent and the session has no open route, that call's result carries one fixed line asking Claude to chart one if the subagent is a step of multi-stage work. Once per session, again after `/charter clear` or once a route is complete; never for subagents, teammates or workflow agents.
- **A checklist** (`/charter`): the whole route as a tree with commit hashes beside finished steps and phase pills on active ones (teal for passed phases, lavender for the current one, gray for later ones), the sessions working on it, the latest signals and the project's other routes with `Join` and `Adopt` buttons.
- **`/charter init`:** rebuilds a route from the conversation for a session that started before the mod was installed.
- **A markdown mirror** (setting `mirror`): `PROGRESS.md` kept in the project, rewritten on every change.
- **`/charter demo`:** a 26 second showcase under the prompt with a made-up route and a made-up second session, so you can see every effect. `/charter demo pane` also shows it in the pane with the pane's motion (the made-up route, its second session, the pills advancing and the signals growing); when the demo ends, or `/charter demo stop` runs, the pane switches back to your own route.

## For orchestrators

The mod registers one tool, listed to the model as `mcp__claudecharter__progress`. Its description is a fixed text; the route reaches the model only as the tool's result, so the prompt cache is never invalidated by progress.

| Action | What it does |
|---|---|
| `plan` | Declare the route: `title` and `items`, each `{id, title, phases?, items?}`, nested up to 4 levels. Declaring it again keeps the progress of ids that already exist. |
| `add` | Append `items` under `parent`, or at the top level. |
| `start` | Make `id` the current step; its parents become active. `phase` sets or changes the phase the item is in. Starting a step also claims it for this session. |
| `done` | Mark `id` (default: the current step) done, with `commit` when a commit finished it. Unfinished children are done too; a parent with no phases is done when all its children are. |
| `skip`, `block` | Mark `id` skipped or blocked, with an optional `note`. |
| `claim`, `release` | Hold or let go of `id` (and everything under it) for this session. |
| `get` | Read the route. Useful after a `/clear`, a resume or a compaction. |

An example call sequence:

1. `plan` with title `M1.6 Planet catalogue` and the stages `S1`, `S2` (parts `S2.P1`, `S2.P2`, `S2.P3`, each with phases `plan, approve, implement, checks, accept, commit`) and `S3`.
2. `start S2.P1` with phase `plan`.
3. `start S2.P1` with phase `implement`.
4. `done S2.P1` with commit `abc1234`.

Skill authors or any other orchestrator: call the tool whenever a stage, part or phase changes. Subagents, test/build commands and git commits are seen by the mod itself, so report only what it cannot see: the plan, where you are, what is finished. A call from a subagent changes nothing.

Chart what you know: call `plan` before the first stage starts, even with a single item, and when planning splits a step into parts, add them under it. While the route is a single item with no parts, every result ends with a reminder line (`If planning splits T1 into parts, add them under it ...`). When the main conversation starts its first subagent and the session has no open route, that call's result carries one fixed line suggesting a route (setting `nudge`); it is a hidden reminder for Claude, worded so it can be ignored when the work is not multi-stage, and it comes back only after the route is cleared or complete.

Every call returns the route as it stands:

```
Route "M1.6": 1/5 done, 28%.
Now: S2 Planet catalogue › S2.P2 Catalogue UI · phase implement (3/6)
Next: S2.P3 Search
✓ S1 Scaffolding · a1b2c3d
▹ S2 Planet catalogue
  ✓ S2.P1 Data model
  ▸ S2.P2 Catalogue UI · [plan ✓ · approve ✓ · ▸implement · checks · accept · commit]
  ○ S2.P3 Search
```

When another session shares the route the result adds a `Sessions:` block (who is live, what each is on and holds) and an `Unclaimed:` line. A part another live session holds is refused, with the name of the session and the parts that are free.

## Sessions and sharing

- **Each session has its own route.** `claude --resume` and `claude --continue` bring it back; `/clear` keeps it; a forked session starts without one.
- **`/charter join`** lists the other routes of this project and shares one. Each session keeps its own current step. Starting a step claims it (its whole stage when no other session holds part of it), or claim one with `/charter claim <id>`. Claude is refused on parts another live session holds, and told which parts are free; your own `/charter` commands always go through. A claim lapses 10 minutes after its session was last seen, or at once when it ends.
- Other sessions' progress appears within about 2 seconds while one of them is live (16 seconds otherwise).
- **`/charter adopt`** takes a route over: the other sessions drop it, each with a toast. **`/charter leave`** detaches this session. **`/charter clear`** leaves a shared route, or discards your own.
- A finished route leaves the band 10 minutes after it completes and stays in `/charter`. Routes not touched for 30 days are no longer offered.

## Rebuilding a route

For a session started before the mod was installed and resumed with `claude --resume <id>`, run `/charter init`. The mod puts a fixed request in your prompt box, asking Claude to rebuild the route from the conversation and `git log`; press Enter to send it (you can edit it first). Finished items are marked done with their commits and the current step is set. It only charts what the conversation and history show. The pane opens on the result. The command is refused when the session already has a route.

## Install

**Claude Code CLI only.** You need Claude Code 2.1.301 or later. The desktop app draws the band and the pane without motion.

Load it in every session by adding the folder to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (separate several folders with `;` on Windows, `:` elsewhere):

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\<you>\\projects\\mods\\claudecharter;C:\\Users\\<you>\\projects\\mods\\claudeticker;C:\\Users\\<you>\\projects\\mods\\claudepeeker;C:\\Users\\<you>\\projects\\mods\\claudespotter;C:\\Users\\<you>\\projects\\mods\\claude-code-filetree"
  }
}
```

Or load it for a single session with `claude --plugin-dir <path to this folder>`.

**List claudecharter first** (this applies to the default placement only). Claude Code nests the mods of `CLAUDE_CODE_PLUGIN_DIRS` in list order, the first outermost, and the route row goes right after the hint line only when claudecharter is outside the other mods that draw under the prompt. Listed after claudepeeker, claudepeeker's status line lands above the route. The mod raises one toast per load when another mod sits outside it. The pane has the id `charter` and tabs with the filetree pane when both are open.

## Usage

| Command | What it does |
|---|---|
| `/charter` | Open the checklist |
| `/charter init` | Put a request to rebuild this session's route from the conversation and git history in your prompt box; press Enter to send it |
| `/charter clear` | Discard this session's route, or leave a shared one |
| `/charter done <id>` | Mark a step done |
| `/charter start <id> [phase]` | Make a step current, optionally in a phase |
| `/charter skip <id>` | Skip a step |
| `/charter reset <id>` | Make a step pending again |
| `/charter claim <id>` / `release <id>` | Hold or let go of a step for this session |
| `/charter join [n]` | List the project's other routes, or share the nth |
| `/charter adopt [n]` | List them, or take the nth over |
| `/charter leave` | Detach this session from its route |
| `/charter mirror claim` | Take over a PROGRESS.md another route owns |
| `/charter demo` | Play the 26 second demo where the route shows (in the pane with placement `panel`) |
| `/charter demo pane` | Play it where the route shows and in the pane |
| `/charter demo stop` | End it |

Clicking the `⋯` at the end of the route row does the same as `/charter`.

## Settings

Set them in `/config`, or in settings under `pluginConfigs.claudecharter`. A change applies at once.

| Setting | Values (default first) | Example |
|---|---|---|
| `placement` | `under`, `above`, `panel` | under the hint line / a band above the prompt / only in `/charter` |
| `track` | `heavy`, `line`, `smooth`, `blocks`, `shade`, `parallelogram`, `squares`, `dots`, `braille`, `ascii` | `┣━━━◆━━►━◇━━━┫` / `▐███◆██►░◇░░░▌` / `[###+##>-+---]` |
| `trackEnds` | `capsule`, `auto`, `start-finish`, `tapered`, `half-blocks`, `brackets`, `corners`, `shells` | `◖━━━◆━━►━◇━━━◗` / `◉━━━◆━━►━◇━━━◎` / `╺━━━◆━━►━◇━━━╸` / `▐━━━◆━━►━◇━━━▌` / `[━━━◆━━►━◇━━━]` / `｢━━━◆━━►━◇━━━｣` / `❲━━━◆━━►━◇━━━❳` / `auto`: each style's own |
| `gapBelow` | `on`, `off` | one blank line under the route row / the next line sits right under it |
| `glide` | `on`, `off` | the head glides to its new place / jumps, comet fill |
| `roll` | `on`, `off` | `28%` rolls to `33%`, the changed digits flashing |
| `activity` | `on`, `off` | spinners turn, the current step shimmers, the phase dot breathes, the next marker pulses |
| `celebrate` | `on`, `off` | `✦ Stage 2/5 done ✦`, the gold glint, both caps pulse |
| `toast` | `on`, `off` | `Claude-Charter: stage 2/5 "Planet catalogue" done` |
| `nudge` | `on`, `off` | the first subagent of a session with no open route suggests charting one / nothing |
| `mirror` | `off`, `on` | no file / a markdown checklist kept in the project |
| `mirrorFile` | `PROGRESS.md`, any relative path ending in `.md` | an absolute path or one with `..` falls back to `PROGRESS.md` |

A change applies at once: Claude Code reloads the mod with the new settings. All four effects off gives a still band that still updates.

## How it works

- **The route model:** items with ids (at most 24 characters, no spaces), titles, optional phases, nested up to 4 levels and 200 items. A parent with no phases is done when all its children are (roll-up); the route is complete when every top-level item is closed.
- **Progress:** a done or skipped item counts 1; an item with children is the mean of its children, its own phases (when it has any) counting as one more share beside them; an active leaf with phases counts the share of phases passed. The route is the mean of its stages; the percent never shows 100 before the route is complete.
- **Storage:** one folder per route under `~/.claude/claudecharter/<project>/` (or under `CLAUDE_CONFIG_DIR`), with one file per session. Each file is written only by its own session and holds that session's log of actions, its current step, its claims and its last sighting. Every session reads all the files and replays all the actions in time order (corrected for causality), so two sessions never overwrite each other and all of them see the same route. A session that cannot find a configuration folder uses `.claude/charter` in the project, with its own `.gitignore`.
- **Row width:** under the prompt the row spans the footer, docked pane or not: a zero-height probe measures the slot and the row is sized from it; until the first measurement it uses the conversation's width, with the `⋯` kept at the right edge.
- **Polling and heartbeat:** a session writes its sighting every minute; other sessions are re-read every 2 seconds while one of them is live, otherwise every 16 seconds.
- **Claims:** a claim covers a step and everything under it. First come, first served; a person's claim (`/charter claim`) overrides, the latest one winning. Claims of sessions not seen for 10 minutes, or that ended, do not count.
- **Signals:** subagents come from the spawn and turn events; checks are recognized by the shape of the Bash or PowerShell command; commits from the command's own record or its `[branch hash]` line.
- **Painting:** the band is one cell grid, repainted in place 20 times a second only while something moves, a subagent or check runs, or Claude works. Nothing is repainted while it rests. The frame timer runs only while a row is drawn (never with placement `panel`). The pane's moving pieces (the track, the current step's marker, a twinkling ✓, a pulsing ⊘, a phase pill filling in, a new signal, the running rows' spinners) are small cell grids repainted the same way, by a timer of their own that runs only while the pane is open and something in it moves or runs. Nothing moves when the pane is first drawn.
- **The mirror:** off by default. One session writes the file for a shared route (the live one with the smallest session id). The first line names the route; the mod never overwrites a file it did not write, nor one another live route owns, and says so with one toast. `/charter mirror claim` takes the file over.

## Limitations

- The route is only as current as the orchestrator's calls.
- Checks are recognized by the shape of the command: `npm`/`pnpm`/`yarn`/`bun` test, build, lint, check and typecheck tasks, `npx` runs of `tsc`, `jest`, `vitest`, `mocha`, `eslint`, `playwright`, `biome` and `prettier --check`, `tsc`, `jest`, `vitest`, `mocha`, `eslint`, `pytest`, `ruff`, `mypy`, `ctest`, `gradle`, `mvn`, `make`, `cargo`, `go`, `dotnet`, `swift` and `deno` test/build/check/lint forms, `python -m pytest|unittest|mypy`, and `claude plugin test|validate`.
- Other sessions show up after up to 2 seconds (16 seconds when none of them is live).
- The clocks of machines sharing a route should agree: the merge orders by time, corrected for causality.
- Old route folders are not deleted (the API has no delete); they are only ignored after 30 days.
- With the default placement, claudecharter must be listed first in `CLAUDE_CODE_PLUGIN_DIRS` for the route to sit right under the hint line, above claudepeeker (Claude Code has no priority option).
- The pane moves only on the terminal; with all four effects off it is drawn still, its running checks and subagents listed with the row's still glyphs.
- The desktop app draws the band without motion.
- Under the prompt the `⋯` answers a click only: that slot never holds the keyboard focus, so it has no hotkey.
- A mirrored file shows up in `git status` unless you ignore it.
- A subagent cannot change the route.

## Development

```
claude plugin validate .
claude plugin test .
npx -y -p typescript@5.6.3 tsc -p .
```

| Path | Contents |
|---|---|
| `hooks/register.tsx` | the mod: the tool and its signals, the band and its timer, the pane, `/charter`, the route files and their sync, the mirror, the demo (row and pane) |
| `hooks/texts.ts` | the fixed texts: the tool description and schema, the init message, the usage line |
| `hooks/route.ts` | the pure route model: actions, progress, replay, the model's view |
| `hooks/share.ts` | the pure sharing model: participant files, the merge, claims |
| `hooks/signals.ts` | command recognition, commit detection, small formatters |
| `hooks/cells.ts` | colors, glyphs, the track styles, the cell encoding |
| `hooks/anim.ts` | the animation state: glides, odometers, badges, sparkles, glint, pulse |
| `hooks/row.ts` | the settings, the track and its styles, the width rules of the row |
| `hooks/pane.ts` | the pane's motion: finished and blocked steps, phase pills, signals, running rows, the track line |
| `hooks/probe.ts` | the width probe: a surface module that measures the slot under the prompt |
| `hooks/mirror.ts` | the PROGRESS.md text and its ownership rules |
| `hooks/demo.ts` | the demo timeline |
| `types/index.d.ts` | the mod's state contract and shared types |
| `tests/` | tests for the route, the sharing, the signals, the row, the animation, the mirror, the demo, and the whole mod against a stubbed engine |

## License

MIT, see [LICENSE](LICENSE).
