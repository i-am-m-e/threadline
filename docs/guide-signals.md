# Signals: a one-page guide

**Threadline notices, drafts and routes. People decide.**

Signals watches approved operational records (flow exports, permit logs, incident reports,
complaints, near-miss reports and policies) for patterns in flows, queues and capacity. It
never tracks, scores or names individuals, and nothing it drafts is ever applied automatically.

## How a Thread starts

When records cross a domain's trigger (for example bed occupancy above 90% **and**
room-to-physician time above 45 minutes), Threadline drafts a **Thread**: a possible pattern,
a short card for the front line, a brief for the manager, and a map. Each time window where the
trigger fires is one **occasion**.

## What you see

**The list** (left): each Thread with its status and, for example, *"Medium confidence, seen on
2 occasions"*. Threads seen on more occasions (10+, 20+, …) move up the list.

**The front-line review card**: what Threadline noticed, why it may matter, possible options,
how many records support it, and one question: *"Does this match what you see on shift?"*

**The manager brief**: the pattern, **What the records say** (each finding with the exact words
or figures from the record it came from), contributing factors, the gap between policy and
practice, a pressure map (which roles carry pressure, and where it may shift), other
explanations, open questions, the options and a suggested recommendation.

**The Thread map**: the same reasoning as a picture. Shape shows the kind of thing (record,
policy, condition, role, effect, option); colour shows its trust label; dashed means unconfirmed.

## Who does what

Choose your role at the top (**Acting as**). Buttons only work for the right role, at the right
step; a greyed-out button says why.

| Step | Who | Buttons |
| --- | --- | --- |
| Threadline drafts a Thread | (automatic) | Status **Inferred**, or **Flagged** if it's Medium+ confidence with a safety-relevant condition, or it keeps recurring (10+ occasions) |
| Send it to the front line | Manager | **Send for front-line validation** → *Under review* |
| Say whether it's real | Front-line lead | **Confirm pattern** → *Validated pattern*; **Doesn't match what I see** → *Not confirmed*. Either role: **Add context** (saved as Experiential, with your role) |
| Decide | Manager | **Accept recommendation** or **Choose another option** (or none) → *Decision recorded*. Only after a front-line lead has confirmed. Nothing is applied: carrying it out is up to the team. |
| Look back | Manager | **Start outcome review** (usually on or after the review date shown) → *Outcome review due*; **Record outcome** (what happened, did it help) → *Closed* |
| Any time | Manager | **Request more information**; **Not a real pattern** (the reason is saved to tune the trigger); **Discuss in a thread** (opens the records in a chat) |

## What the labels mean

| Label | Means |
| --- | --- |
| **Authoritative** | From an approved policy, guideline or SOP |
| **Observed** | From a record of what happened: flow data, an incident, a complaint, a near miss |
| **Experiential** | Context a front-line lead added (only people can add this) |
| **Historical** | Past decisions or outcomes (only people can add this) |
| **Inferred** | Proposed by Threadline and not confirmed: treat it as a question |
| **Suggested** | An option or recommendation: a person decides |

**Confidence** (Low, Medium, High) is worked out by a fixed rule: High needs two or more kinds of
record agreeing in more than one time window. *"Low confidence, seen on 5 occasions"* means: this
keeps happening, and nobody has confirmed why yet. Recurrence never changes the confidence label.

## How Threadline keeps itself honest

Before you see anything, code checks what the AI wrote against the records:

- every finding must quote its record exactly, or give the record's own figures;
- every number in the text must be in the records it describes;
- trust labels must match what's cited;
- a claim that can't be checked gets one chance to be fixed; if it still fails, it's **removed or
  replaced**, never kept quietly. The brief lists everything under **Removed or replaced as
  unverified**, and its one-line summary says how many things were checked.

What isn't checked yet: whether the *wording* of a claim matches the record (only its numbers and
labels are). Read **Inferred** items, and anything that sounds more certain than the records, as
questions for the people who know the work.

All records in this prototype are synthetic.
