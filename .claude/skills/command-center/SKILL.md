---
name: command-center
description: Forward-planning status update for the Screeps bot in ~/code/screeps/bot - pulls live game state, telemetry, and repo/notes health via dedicated desk subagents (G2 Intelligence, G4 Logistics, Watch Officer), then synthesizes a decision brief biased toward proactive expansion. Use this whenever the user asks for a Screeps bot status update, wants to "look at game state and ideate next steps," asks "what's next" for the bot, or wants a forward-planning / strategic review of the colony - not for narrow single-question checks (e.g. "is pserver still running") that don't need a full staff.
---

# Command Center

A forward-planning skill for the Screeps bot, organized as a military command-center LARP: narrow-scope desk subagents each report a slice of ground truth, and you - the commander - synthesize their reports into a ranked decision brief. See `~/secondbrain`'s "Screeps bot: command-center forward-planning skill (future consideration)" note for the full design rationale and why the staff below is a skeleton crew, not the full roster.

You do not gather intelligence yourself. Each desk exists precisely so its report is independently reproducible and doesn't inherit your assumptions - if you find yourself running the queries a desk should run instead of dispatching to it, stop and dispatch.

## Doctrine: default to proactive expansion, not comfortable maintenance

This is the one thing that makes this skill different from just "run some status checks." The default conclusion of a forward-planning session must never be "things are stable, nothing to do" unless a **named, concrete blocker** is preventing expansion right now. Screeps rewards continuous territorial and economic growth - an unstaffed remote-mining slot, an unscouted neighbor, an unbuilt structure the current RCL already unlocks, or a rival's contested claim are all standing opportunities, and a colony that isn't visibly pursuing at least one of them is coasting, not thriving.

This is a bias about **posture**, not about rushing the clock. Screeps ticks take real wall-clock time and RCL/GCL progress is a grind that cannot be sped up by wanting it faster - waiting for a spawn queue or a controller upgrade to finish is just the game, not a failure of ambition. The doctrine is: never let the colony sit *idle* while a concrete next expansion step is available and affordable, not "be impatient with progress that's already correctly in motion." If G4 reports the room is already fully committed to funding its current growth (every spare cycle already going toward RCL5, no idle capacity, nothing sitting unbuilt or unstaffed), that itself is a legitimate "yes, we're expanding, here's the evidence" - it is not the same as "nothing to report."

When your synthesis does conclude "hold," it must name the specific blocker (a GCL gate, a genuine energy/CPU ceiling with numbers from G4, an unresolved bug from Watch) - "seems fine as-is" is not an acceptable reason on its own.

## Staff (skeleton crew)

Three desks exist today, defined as subagents in `.claude/agents/`:

- **`g2-intelligence`** - the map picture: owned/remote/keeper rooms, unstaffed remote slots, unscouted neighbors, rival activity, hostile trends. Read `.claude/agents/g2-intelligence.md` for its full brief before dispatching if you need to remind yourself what it covers.
- **`g4-logistics`** - economy throughput: RCL/GCL progress rate, energy/CPU trends, population health, unbuilt structures the current RCL already unlocks, and a plain capacity verdict.
- **`watch-officer`** - operational health: errors, deploy sync, unpushed commits, unverified fixes, stale reference notes, orphaned ephemeral pserver instances.

G3 Operations, Engineering/T&E, and Adjutant/Records are deliberately not built yet - see the secondbrain note for why. If one of their concerns becomes relevant mid-session (e.g. an active hostile encounter needs Operations-style judgment, or a proposed change needs Engineering's verification-rigor framing), handle it yourself inline rather than inventing an ad hoc subagent - and consider whether it's a signal that desk is now worth building for real.

## Process

1. **Dispatch all three desks in parallel, in one message** - they're independent and read-only, there's no reason to serialize them. Give each a one-line prompt pointing it at "today" (pass the current date/tick context you have) and reminding it this is for a forward-planning synthesis, not a narrow lookup.
2. **Read all three reports before forming any opinion.** Don't let G2's opportunities anchor your read of G4's numbers or vice versa - each desk's report should be able to stand alone.
3. **Synthesize**, don't summarize. A decision brief is more than the three reports concatenated - your job is to find where they intersect (an unstaffed remote slot from G2 that G4 confirms there's energy/CPU to staff; a stale note from Watch that changes how much you trust a G2 or G4 claim) and produce a ranked recommendation.
4. **Present using this structure** every time:

   ```
   ## Executive summary
   [2-3 sentences: overall posture, healthiest signal, biggest opportunity]

   ## Current posture
   [what's actually running, current RCL/GCL, population, health - grounded in G4 + Watch]

   ## Opportunities
   [at least one, per doctrine above - each with which desk's evidence supports it]

   ## Constraints
   [named blockers, if any, with the specific evidence from whichever desk found them]

   ## Recommendation
   [ranked list, same style as prior ad hoc sessions - a clear top pick with reasoning, not just a menu]
   ```

5. **Invite redirection.** End by asking which direction the user wants to take, the same way you would after any exploratory analysis - this brief is a recommendation, not a decided plan.

## What this replaces

Before this skill existed, a forward-planning ask ("look at the official server's game state and telemetry, give me a status update" / "ideate some next steps") was done by hand each time: live API calls, telemetry queries, and secondbrain reads, all interleaved with the analysis in one continuous pass. That worked but didn't scale as a repeatable habit - see the 2026-09-04 session that prompted this skill for what that looked like in practice. The desks here are that same set of queries, formalized so they're reproducible and so the synthesis step is explicitly separated from the fact-finding.
