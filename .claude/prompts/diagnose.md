# Fix-bot — diagnose mode (#3667)

The same check is red again on this pipeline PR after one fix-bot try. A second fix started from
the log rarely works, so this run does NOT fix anything. You write ONE diagnosis comment: where the
job stopped, why, since when, the proof, and whether we knew about it before.

Your inputs (PR number, head sha, check name, run URL, linked issue, the failing-lines file) are in
the prompt that pointed you here.

## Hard rules

- Do NOT edit, create or delete any tracked file. Scratch files go in `$RUNNER_TEMP` only.
- Do NOT run `git commit` or `git push` (both are disallowed anyway). Nothing is committed in this mode.
- Do NOT add or remove labels on the PR or the issue, and do NOT apply `status:blocked`.
- Post exactly ONE PR comment, with `gh pr comment <pr> --body-file <file>`. Never a second one.
- Do not @mention anyone.

## How to work

1. Read the failing-lines file first — it is the failing job's own log digest. Then the run itself
   (`gh run view <run id> --log-failed`) if you need more, and the PR diff (`gh pr diff <pr>`).
2. Find the line where the job stopped and trace it to the code that produces it. Reproduce it
   locally (the failing command) when that is cheap; otherwise read it in the code.
3. Look back: `gh run list --workflow "<check>" --branch <base> --limit 30` and the head branch's
   earlier runs, to find the last green run and the first red run / commit for that line.
4. Only AFTER steps 1–3, check whether this was known before (section 5 below).

## The comment

The first line is exactly `🩺 **Diagnosis**`. The next line is the hidden marker, with the head
sha, the URL-encoded check name (e.g. `Deploy%20Apps%20(Cloudflare%20Workers)`) and the round
your prompt gives (`1`, or `2` on a redo):

```
🩺 **Diagnosis**
<!-- diagnosis:v1 sha=<head sha> check=<url-encoded check> round=<n> -->
```

Then these five sections, in this order, each a `####` heading:

#### Stopped at

The failing line, quoted (a fenced block), with the link to the failing job.

#### Cause

`file:line` and one sentence saying why that line fails.

#### Since when

The last green run and the first red run (or commit) for this line, as links. Say "first red on
this PR" when it never passed here.

#### Proof

The code line that produces the error, or a reproduction command and its output. Label it
**observed** (you ran it) or **read in code** (you didn't).

#### Known before?

Write this only after the four sections above. Search open AND closed issues, including ones closed
as not planned (`gh issue list --state all --search "<key words of the failing line>"`), and earlier
`diagnosis:v1` comments (`gh search issues "diagnosis:v1" --repo <repo>` / the PR's own comments).

- Say **same issue** only when the failing line AND the cause both match; link it.
- Otherwise say **looks similar, different cause**, with the difference in one line.
- For a matching CLOSED ticket, say why its fix didn't hold and propose reopening it.
- Nothing found → "No earlier report found" plus the searches you ran.

## Redo (round 2)

When your prompt says round 2, a reviewer rejected your round-1 diagnosis and a reviewer's points
file is given. Address EACH point: re-check the claim it names against the log and the code, and
change the section it belongs to. Do not edit the round-1 comment — post a NEW comment whose marker
carries `round=2`. Keep the same five sections.

End with: `<sub>🤖 fix-bot · diagnose mode (#3667, #3668) — a second agent reviews this before any fix.</sub>`
