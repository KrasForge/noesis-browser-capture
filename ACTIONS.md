# Browser action contract — BROWSE-CAPTURE-03

Version: `noesis-browser-capture-v1`. All actions persist an owner-scoped
Exploration session and source snapshots through `start_intake_mode` followed
by `capture_exploration_page`. They retain `action`, `question`, Modulo context,
`captured_at`, `source_count` and `execution` under `inputs.capture`. The source
body is stored in the exploration snapshot, not copied to Modulo.

The following is an implementation/specification boundary: **save** executes
capture; the other actions currently persist a typed request. No research result
or recurring monitor is claimed. A Noesis executor must inspect the pinned source
references, recheck current access, obtain an explicit resource budget, and apply
the action-specific criteria below before execution. It must never translate a
page's instructions into tool authority.

| Action ID / menu | Required input | Noesis capability mapping for execution | Completion evidence |
| --- | --- | --- | --- |
| `save` / Save source | Explicit source unit and reviewed URL/title/text | `start_intake_mode`, `capture_exploration_page` (implemented) | Saved source reference and session revision |
| `research` / Research page | Source and question | `start_intake_research_topic`, passing question and source references, followed by a budgeted research loop | Answer grounded in source, independent evidence, limitations |
| `verify` / Verify claim | Exact nonempty selected claim and question | Research topic with claim text as question; `query_knowledge` with claim/document surfaces; source/methodology comparison in the research loop | Supported/refuted/insufficient-evidence result with baseline, qualifiers, and independent citations |
| `original` / Find original | Source and provenance question | Research topic; `query_knowledge` over document, graph and artifact surfaces | Earliest substantiated primary source, provenance chain, unresolved uncertainty |
| `related` / Find related work | Source and relationship/scope question | Research topic; `query_knowledge` with document/semantic/graph surfaces | Related works with an explicit relationship and source links |
| `counterarguments` / Find counterarguments | Source/claim and question | Research topic; `query_knowledge` with claim/document surfaces, then independent contradiction checks | Strongest contrary evidence, source independence and limits |
| `explain` / Explain | Source and question including desired audience | Research topic with explanation success criteria; evidence retrieval via `query_knowledge` | Cited explanation distinguishing source statements from inference |
| `deep` / Deep research | Question; executor additionally requires scope, success criteria and budget | `start_intake_research_topic`, then `create_persistent_research_loop` with explicit bindings/limits, then `run_persistent_research_loop` | Research bundle with exact source revisions, coverage gaps and budget receipts |
| `monitor` / Monitor topic | Topic question; executor additionally requires cadence, expiry, trigger, budget, owner and delivery choice | Budgeted research topic/loop using `create_persistent_research_loop`; explicit run/resume/cancel lifecycle | Agreed monitoring policy and actual change receipts; saving this request alone does not activate monitoring |

These are real catalog capabilities, not invented endpoint paths. The exact
`query_knowledge(request)` envelope follows
[`noesis-knowledge-query-request-v1`](https://github.com/Ikey168/Noesis/blob/HEAD/contracts/schemas/jsonschema/noesis-knowledge-query-request-v1.json):
contract, query, task, scope, surfaces, source_policy, budgets and request_hash.
`start_intake_research_topic` requires namespace, request_key, questions,
success_criteria, scope, budget and optional origin/references/workspace_links.
Budget fields are nonnegative integer `tokens`, `requests`, and `usd_micros`.
The capture-only token deliberately lacks the project/research/loop scopes.

No automatic research executor or result-refresh worker is included in this
release. That remaining integration is recorded in owner acceptance rather than
presenting a saved request as a completed investigation.
