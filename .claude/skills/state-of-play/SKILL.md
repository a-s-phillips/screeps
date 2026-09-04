---
name: state-of-play
description: Compiles a "Screeps bot: state of play" secondbrain note - reviews what's shipped/discovered since the most recent such note (git history in both repos), major live game-world occurrences, and folds in a command-center brief if one ran earlier in the session. Use this whenever the user asks to "write up a state-of-play note," "compile the session," "log what happened," or otherwise wants a session recap saved to secondbrain in the established format - not for a forward-looking decision brief (that's command-center) or a narrow single-note edit.
---

# State of Play

Compiles a retrospective session note in the exact format the "Screeps bot: state of play, `<date>`" note series already uses in `~/secondbrain` - see `c7bl.md`/`ae7t.md`/`bxy2.md`/`p9ae.md`/`j438.md`/`x9he.md`/`hpqe.md`/`14k5.md` for the established voice and structure before writing a new one. This is a **retrospective** ("what happened, what's still open"), not the `command-center` skill's forward-looking decision brief - if the user wants "what should we do next," redirect to `command-center` instead (or, if one already ran this session, summarize its output here rather than re-deriving it).

## Process

1. **Find the most recent state-of-play note.** `zk list -t screeps` (or `grep -rl "^# Screeps bot: state of play" ~/secondbrain/*.md`), then pick the latest by date in the title, not file mtime - same-day notes get a "(continued)" suffix and sort after their base note. Read it in full; this is both your "Follow-up to [[...]]" link target and your priority-list baseline (what needs to be carried forward, struck through, or added to).

2. **Establish the time boundary.** Get that note's authoring commit date in the secondbrain repo (`git log --follow --format=%ai -- <file> | tail -1`, or just its most recent commit touching the file) - this is your cutoff for "since the last report," not today's date, since sessions don't align with calendar days.

3. **Gather what shipped, in both repos, since that boundary:**
   - Bot repo: `git log --oneline --since=<cutoff>` for commits, `git log --oneline origin/main..HEAD` for push status. Read commit messages, not just subjects, for the "why" - this project's commit bodies carry the same found-live/root-cause detail the notes themselves use.
   - secondbrain repo: `git log --oneline --since=<cutoff>` for what notes/decisions were made in the meantime (separate from the note you're about to write).
   - Don't just list commits - group them the way the existing notes do: what shipped (with root cause / why, not just what), what was found-but-not-fixed, any strategic pivots ("Decision: ..." sections in prior notes are exactly this).

4. **Get current live-game-world ground truth.** Two paths, pick whichever applies:
   - **A command-center brief already ran earlier in this same conversation**: don't re-dispatch the desks - summarize its executive summary and top recommendation under a `## Command-center recap` section instead. Re-running the same live queries minutes later is wasted work and risks a spuriously different read.
   - **No command-center brief ran this session**: dispatch `g2-intelligence`, `g4-logistics`, and `watch-officer` yourself, the same way `command-center` does (parallel, one message, read `.claude/skills/command-center/SKILL.md` if you need the exact dispatch shape) - but frame their prompt around *this* skill's purpose ("recapping a session for a state-of-play note, not forward planning") so their reports emphasize what changed/happened rather than what to do next. Fold their findings into the narrative (hostile encounters, RCL/GCL movement, deploy/error health) rather than reproducing their SITREP format verbatim - this note is prose, not a decision brief.

5. **Write the note**, matching the established structure exactly (every existing note follows this shape - deviate only if a section genuinely doesn't apply, and say so rather than omitting silently):

   ```markdown
   # Screeps bot: state of play, <date>

   #screeps

   Follow-up to [[<previous note title>]] - <1-2 sentences: what this session covered, in relation to what the last note left open>.

   ## Shipped this session

   - **<Bold lead phrase>** (`<commit hash>`) - <what, root cause/why, verification status>
   - ...

   ## Found, not fixed / Discovered live
   [only if applicable - things noticed but not acted on, same as ae7t.md's "Found, not fixed" or c7bl.md's pattern]

   ## Decision: <topic>
   [only if a strategic pivot happened - a change in how the project approaches something, not just a bug fix]

   ## Command-center recap
   [only if a command-center brief ran this session - condensed executive summary + top recommendation, with a note on which parts were acted on]

   ## Reference notes brought current
   [only if housekeeping happened - which notes, why they'd drifted]

   ## Updated priority list

   Per [[<previous note>]]'s list:
   1. ~~<completed item>~~ - done, <how/where>
   2. <carried-forward item, unchanged if still accurate>
   3. **New**: <anything this session surfaced that isn't resolved>

   ## Repo state

   Bot repo: <N commits this session>, <ahead/behind origin status>. secondbrain: <N commits>.
   ```

6. **Save via `zk`**, not hand-rolled file creation: `zk new --title "Screeps bot: state of play, <date>" --no-input --print-path` (append " (continued)" to the title if a note with today's date already exists), then write the body via Edit/Write into the path it prints. Tag `#screeps` in the body (zk hashtags, not frontmatter).

7. **Report back** what you wrote and its note ID/path - don't just say "done," since the user will likely want to `zk edit` it themselves later.

## What this is not

Not a live audit (`command-center` does that - dispatch it first, or note that this session had none, if the user actually wants fresh ground-truth intelligence rather than a recap of what already happened). Not a place to make new decisions or recommendations - if analysis while compiling this surfaces something worth doing, note it in the priority list as a candidate, the same restrained way existing notes do ("worth a real fix... but not urgent"), not as a pitch.
