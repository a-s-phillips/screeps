---
name: cost-benefit
description: Rigorous cost-benefit analysis of one specific proposed strategy for the Screeps bot in ~/screeps/bot - grounds a named idea (e.g. "aggressively contest reservation of W58N24," "station standing attackers in W56N26 to enable remote mining," "prepare a ground assault on W60N23") in live game state, models the costs/benefits/probable future states, and returns a plain go/no-go/conditional verdict. Use this when the user proposes a specific strategic move and wants to know if it's worth it - not for open-ended "what should we do next" surveys (that's command-center) or session recaps (that's state-of-play).
---

# Cost-Benefit

A decision-analysis skill for one named strategic idea at a time. `command-center` surveys the whole colony and is deliberately biased toward finding an expansion opportunity; `state-of-play` looks backward at what already happened. This skill does neither - it takes a single proposed action, grounds it in real current state, models what plausibly happens next under it, and returns an honest verdict. A "don't do this" or "not yet, here's what's missing" is just as valid an output here as a "go."

## Doctrine: no thumb on the scale

`command-center`'s doctrine is to default toward proactive expansion unless a named blocker exists - that bias is deliberate there, because its job is surfacing opportunities. This skill's job is the opposite: **weigh a specific idea honestly, including the possibility it's a bad one.** Do not let excitement about a bold plan ("ground assault!") or a desire to be useful inflate the benefit side or discount the cost side. If the intel needed to judge a proposal doesn't exist yet, the correct verdict is "insufficient intel" plus what's missing - not a guess dressed up as analysis, and not silent invention of numbers that weren't actually measured.

## Step 1: Pin down the idea

Restate the proposal precisely before doing anything else - room name(s), the concrete mechanism (what creeps/structures/behavior this actually requires), and the time horizon implied (a one-off action vs. a standing commitment that runs indefinitely). "Contest the reservation of W58N24" and "station a standing defender in W58N24 forever" have completely different cost shapes even if they're about the same room - don't let a vague idea produce a vague analysis. If the user's phrasing is ambiguous on scope or horizon, ask before modeling rather than guessing.

## Step 2: Ground it in current state

Don't re-derive live queries the desks already know how to run - dispatch them, reframed around this specific idea the same way `state-of-play` reframes them around a session recap:

- **`g2-intelligence`**, prompted specifically about the room(s) in the proposal: current owner/reservation status, rival presence and armament, hostile history, terrain/exit layout, and whether it's already in `remoteRooms`/scouted at all. If the idea targets a room G2's normal scope doesn't cover in depth (e.g. a specific enemy-owned room's tower count, rampart HP, wall layout for an assault), it's fine to pull that yourself directly via `GET /api/game/room-objects?room=<X>&shard=shard3` (token in `screeps.json`'s `main` entry) rather than inventing a new desk for a one-off lookup - same "handle it inline" allowance `command-center` gives itself for concerns outside the skeleton crew's scope.
- **`g4-logistics`**, prompted specifically about affordability of this idea: current spare energy/CPU capacity (its normal "can we afford to do more than we're doing" bottom line, now applied to this proposal's specific cost rather than left general), and what's currently unstaffed/unbuilt that this proposal would compete with for that same capacity.

Read both reports before modeling anything - don't let one desk's numbers anchor your read of the other's.

## Step 3: Model the cost side

Every proposal has some subset of these; name which apply and give a real number or an explicit "unknown, would need X to find out" - never a placeholder number:

- **Upfront cost**: energy cost of the creep body/bodies required, and spawn ticks consumed (which is itself a cost - that spawn queue slot is unavailable for anything else while it's building).
- **Recurring cost**: if the idea is a standing commitment (a permanent defender, an ongoing reservation contest), the steady-state energy/tick and CPU/tick to sustain it indefinitely - a creep's 1500-tick lifetime means "one creep" is really "one spawn cycle forever," not a one-time cost. Compare this rate against G4's reported spare capacity directly.
- **Risk cost**: expected value of losses - probability of a creep dying (grounded in G2's read of rival strength/armament for that room, not a made-up number) times the cost to replace it. If G2 couldn't establish rival strength, say the risk is unquantified rather than assuming either extreme.
- **Escalation cost**: qualitative, but don't skip it - does this action provoke a response from a rival player that wouldn't otherwise happen, and what's the realistic downside if it does (lost creeps beyond this action, a longer-running conflict, retaliation against an existing remote room)?
- **Opportunity cost**: what G4-confirmed spare capacity would otherwise fund. If G4's bottom line was "no spare capacity," this cost is severe - the proposal isn't just competing against idle capacity, it's displacing something else already planned.

## Step 4: Model the benefit side

Same rigor as costs - a real number or an honest "unknown":

- **Direct yield**: energy/tick gained (a secured remote source), resource/territory denied to a rival, or a standing threat removed - quantify against the room's actual source count/regen rate where that's knowable from G2's report, not a generic assumption.
- **Strategic value**: what this unlocks - a GCL-gated second room becomes viable, an already-unstaffed remote slot (per G2's normal "unstaffed capacity" reporting) gets filled, a previously contested lane becomes safe for other creeps to path through.
- **Optionality**: does succeeding open doors beyond the immediate ask - e.g. does contesting one reservation make an adjacent unscouted room's viability easier to judge next.

## Step 5: Model probable future states

Give at least three scenarios, each with a plain-language confidence level (high/medium/low) tied to how much real intel backs it - not invented probabilities:

1. **Baseline (do nothing)** - what happens if this proposal isn't acted on. Status quo isn't always neutral: a rival may secure the reservation anyway, a threat may keep growing, an opportunity may close (another player claims first).
2. **Attempt and succeed** - the realistic best case given the numbers gathered in steps 2-4, not an idealized one.
3. **Attempt and fail / partial** - the realistic downside given rival strength, terrain, and defenses as actually reported, including what's lost (creeps, energy, tempo) if it goes wrong.

## Step 6: Present the verdict

```
## Idea
[the proposal, restated precisely - room(s), mechanism, time horizon]

## Current state
[grounded facts from G2/G4/direct queries, cited with ticks/numbers - flag anything that's an assumption rather than a measurement]

## Cost model
[upfront / recurring / risk / escalation / opportunity - each with a number or an explicit unknown]

## Benefit model
[direct yield / strategic value / optionality - same rigor]

## Modeled futures
[baseline / succeed / fail, each with a confidence level and why]

## Verdict
[Go / No-go / Conditional on <X> / Insufficient intel - one plain recommendation, not a menu]

## What would change this verdict
[the single most valuable missing piece of intel or condition, if the verdict isn't a clean go/no-go]
```

## What this doesn't do

This skill only analyzes - it doesn't implement. A "Go" verdict is the start of a separate task (writing the code, adjusting targeting logic, spawning the creeps), not something this skill does itself. If the verdict amounts to a real strategic decision worth preserving, say so and offer to record it in `~/secondbrain` the way `state-of-play`'s "Decision: `<topic>`" sections do - don't write the note unprompted, since this skill may run mid-session before a state-of-play writeup.
