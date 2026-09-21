# BROWSE-CAPTURE verification — 2026-09-21

## Evidence

- Connector diagnosis: Codex's Modulo MCP already used SSH to Oracle and
  `https://modulo.141.147.5.114.sslip.io`. Empty `para-tasks`/`para-core` results
  were the wrong namespaces. The app stores Life/PARA data in
  `workspace-para/data`; all eight BROWSE-CAPTURE tasks were retrieved there.
- Connector repair: added explicit workspace read/list helpers, corrected tool
  descriptions and documented the shared namespace on Oracle. Seven client
  tests pass. Before-change copies are under
  `/srv/modulo/tools/modulo_mcp/backups/browse-capture-namespace/`.
- Extension tests: 14 Node tests pass with the real Noesis HTTP test enabled.
  The separately enabled live Oracle integration test also passes. It creates
  exactly one synthetic resource, verifies idempotent replay, and deletes only
  that resource using a fresh optimistic version. No access token leaves Oracle.
- Real Noesis test: temporary isolated DuckDB and actual Knowledge Engine MCP
  handlers, bearer auth, initialization, SSE replies, page/selection/PDF-link/
  multi-tab captures, deterministic retries, context preservation, wrong-token
  denial and private/unconfirmed/local-URL exclusions.
- Real Firefox test: fresh temporary profile and unsigned add-on, synthetic
  public page data, background event-page messaging, extension-local queue,
  source receipts, stopped endpoint, retained payload and successful retry after
  endpoint restart. Native tab-group membership is queried through Firefox.
  Article/selection extraction is checked against visible text, excluded forms,
  hidden/editable content and a synthetic password-entry page. The fixture grants
  localhost/example.org host access and tabs permission in the test manifest;
  production asks for optional permissions through user gestures.
- `web-ext lint` reports zero errors, notices or warnings.
- Desktop runtime is active and enabled as `noesis-capture.service`, bound only
  to 127.0.0.1:8129. An authenticated public example.org capture and replay returned
  session `intake:acbb74eb5e41362294236853e306f1eb`, revision 2, namespace `browser`.
  The source is an explicitly labelled acceptance fixture, not research evidence.

## Scope and acceptance

1. **Surface/deployment:** Firefox desktop toolbar; isolated desktop Knowledge
   Engine intake service; optional Oracle Modulo resource routing. Chosen in
   response to the user's explicit Firefox implementation request.
2. **Privacy:** public content only, explicit preview/confirmation, private
   browsing excluded, URL minimization, no cookies/referrer/history, body read
   only on request, seven-day queue retention, least-privilege dedicated caller.
3. **Actions:** all nine actions have explicit identifiers, required inputs and
   capability mappings. Save source executes; other actions persist requests.
   Automatic research execution is not implemented or represented as complete.
4. **Capture units:** page metadata/optional article text, selected text, public
   PDF link references, highlighted tabs and the active tab's native group.
   PDF file bytes, OCR and authenticated PDF downloads are not supported.
5. **Context/routing:** project/area/note/task/question preserved; Noesis stable
   session references are linked into Modulo PARA resources without copying the
   source body. Area references use inputs because the current Noesis direct
   handoff enum lacks area. Modulo's current PARA views may return to the list
   rather than auto-selecting the supplied record ID. Research-result refresh
   and automatic execution remain separate integration work.
6. **Hardening:** optional host/tab access, private exclusion, no page-context
   credentials, redirect/cookie denial, timeouts, bounded retained data, token/
   endpoint identity checks and optimistic Modulo writes.
7. **Tests:** automated evidence covers the supported capture units, replay,
   outage, auth failure, privacy exclusions and real Oracle reference routing.
8. **Owner acceptance remains Waiting:** review the supported-unit limits,
   install/configure on the laptop, verify desktop/laptop usability and decide
   signed distribution. The broad goal of one-interaction completed research
   also requires a research executor/result-refresh path beyond request capture.

These checks do not establish that an arbitrary authenticated website can be
classified automatically. Confirmation is deliberate; a password field is an
additional exclusion, not a universal login detector. No private browsing
profile, real authenticated page content or stored browser cookie was inspected.

## Standalone repository

The extension, tests and deployment examples have been copied to
`/home/ik/noesis-browser-capture`. The original implementation and runtime evidence
above was recorded before this extraction. The Noesis backend remains in its
separate checkout, and integration tests select it with `NOESIS_SOURCE_DIR`.
The existing desktop service and its private credentials have not been moved.
Build the standalone extension with `npm run build`; the unsigned package is in
`dist/`. No credential files or warehouse data are part of this repository.

The operating/recovery procedure is [README.md](README.md); the bounded action
specification is [ACTIONS.md](ACTIONS.md). Modulo project note #142 links the
results and remaining acceptance conditions.
