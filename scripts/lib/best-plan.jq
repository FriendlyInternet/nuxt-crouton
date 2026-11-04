# best-plan.jq — pick the plan to revise (#3341). Input: all issue comments (slurped+added).
# --argjson fb <feedback comment id>. `<=` not `<`: the feedback IS usually the review of the
# plan just posted, so excluding it would drop that plan's score.
map(select(.id <= $fb)) as $c
| [$c[] | select(.body | test("\\A(?:[ \\t]*<!--[^\\n]*-->[ \\t]*\\r?\\n)*[ \\t]*<!-- pipeline-plan:v1 -->[ \\t]*(\\r?\\n|\\z)"))] as $plans
| [$plans[] | . as $p
    | ([$c[] | select(.id > $p.id and (.body | test("\\A(?:[ \\t]*<!--[^\\n]*-->[ \\t]*\\r?\\n)*[ \\t]*<!-- plan-review-verdict:[^\\n]*-->[ \\t]*(\\r?\\n|\\z)")))] | first // {body: ""}) as $v
    | {id: $p.id, body: $p.body, score: ($v.body | [scan("✅")] | length)}]
| sort_by([.score, .id]) | last | .body // ""
