# Noesis Browser Capture

**Capture to Noesis** is the user-facing Firefox add-on in this standalone repository.

Firefox 142+ desktop extension for the BROWSE-CAPTURE project. The browser
collects an explicitly reviewed payload; Noesis stores sources and research
requests; optional Modulo routing stores a session reference linked to work.

## Install and connect

1. Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**,
   and select `manifest.json` from this directory. Temporary installation lasts
   until Firefox restarts. Permanent release installation requires Mozilla signing.
2. Open **Connection settings**. Set the Knowledge Engine MCP endpoint, namespace,
   and dedicated caller token. On the configured desktop, load the private file
   `~/.config/noesis-capture/connection.json`, then click **Save connection** and
   grant endpoint access. The local service listens at `http://127.0.0.1:8129/mcp`.
3. Optional: configure the Oracle Modulo origin and your Modulo access token.
   Credentials stay in Firefox extension-local storage and are never injected
   into a web page. Expired Modulo tokens need replacement.
4. Visit a public HTTPS page, open the toolbar popup, choose a capture unit and
   action, review/redact the exact URL, title, text, question, and note, confirm
   it is public content, and save. Only **Save source** is a completed operation;
   the other eight actions save structured research requests, not research results.

## Capture units

- **Page:** URL/title by default. Article text is read only when requested from
  `article` or `main`; the preview is editable. Forms, password pages, hidden
  content, and editable controls are excluded from article extraction.
- **Selection:** explicitly select this unit to read selected text. Review or
  redact it before saving. A selected claim is required for Verify claim.
- **PDF:** public HTTPS PDF **link reference**. No authenticated download, local
  file, PDF bytes, OCR, or PDF viewer DOM is uploaded.
- **Tabs:** highlight tabs using Firefox's tab selection, click **Choose from
  highlighted tabs**, grant optional tab permission, and confirm the individual
  title/URL entries. Alternatively choose **Choose tabs in current group** to
  preview the active tab’s native Firefox group. Only checked tabs are sent,
  with no article bodies; group membership is snapshotted at preview time.

Text is capped at 100,000 characters per source with a visible truncation message.
A batch contains at most 20 sources. Query parameters and fragments are stripped
by default; queries can be retained explicitly after reviewing them for secrets.
Local URLs, IP literals, credential-bearing URLs and private browsing are excluded.
Authenticated/private material must not be confirmed as public. The extension
cannot infer authentication from all websites, so it never uploads a page body
merely because the popup opened. Referrers, cookies, form values and browsing
history are not collected.

## Modulo context and routing

Choose a project, area or task using **Load Modulo projects, areas, and tasks**,
or enter a project/area/note/task ID, version and return URL manually. These are
stored in the Noesis session's `inputs.capture.context` along with the question,
action and capture timestamp. Project, note and task references also use Noesis
`workspace_links`; areas remain explicit input context because the existing
handoff contract has no area link type.

With **Add a linked reference in Modulo after capture** enabled, the extension
adds a deterministic resource to `workspace-para/data`, linked to the selected
project/area or the target task's project/area. Note targets retain `noteId`.
The resource contains the Noesis namespace/session/revision, action, question
and original target ID/version, but no copied source text. Existing notes/tasks
are never overwritten. A deleted/archived target or concurrent edit fails safely.
Retry rereads current state, preserves all other fields, and uses optimistic
version checks. A lost response cannot duplicate the resource.

The receipt can be downloaded and the saved return URL reopened. The current
Modulo PARA views may open the relevant list rather than selecting the exact
object; its stable ID remains in the resource and receipt. Later research
execution/result refresh is a separate workflow, not performed by this extension.

## Queue, credentials, and recovery

The event page persists a request before sending it and continues after popup
closure. Each capture and each batch source has a fixed retry key. A server write
whose response is lost is replayed with that same key and original revision.
A Modulo routing failure retains the request; retry replays Noesis safely before
routing again. Token changes block queued retries to prevent switching callers;
restore the original token, or deliberately discard the old capture and recapture.
Endpoint/namespace/Modulo-origin changes are similarly checked.

At most 20 pending captures (4 MB total) and 20 receipts are retained. Pending content and
receipts expire after seven days, checked on use, browser startup and hourly.
A closed Firefox cannot run cleanup until the next startup. Success atomically
removes pending content and saves a receipt. **Clear local captures and receipts**
removes them immediately; **Forget connection** removes stored credentials.
Version 0.1 pending captures have a separate retry action preserving old keys.

There is no browser-sync storage, analytics, automatic retry loop or scheduled
research/monitoring. All cross-origin requests omit cookies, reject redirects,
and time out. Remote origins require HTTPS; HTTP is limited to loopback. Local
extension storage is not an encrypted credential vault: use a dedicated profile
and least-privilege tokens. Do not share the private connection file or package
it with the add-on. Source retention in Noesis is independent of local cleanup.

## Runtime and ownership

The configured desktop service is `systemctl --user status noesis-capture`.
It runs the Knowledge Engine from a separate Noesis backend checkout, using
`~/.local/share/noesis-capture/intake.duckdb`, with credentials in
`~/.config/noesis-capture/callers.json` (mode 0600). It is loopback-only and starts
with the user's service manager. The browser caller has intake read/write and
namespace `browser` read/write; it cannot fetch web content or launch research.
This is a separate desktop Noesis intake warehouse, not Oracle's older REST
Noesis container or a migration of that container's corpus.

[Deployment files](deploy/) contain a systemd template and exact dependency lock.
For another Linux device, install those requirements in an isolated Python 3.13
venv, initialize a DuckDB database, generate a private caller map as described in
[Noesis server setup](https://github.com/Ikey168/Noesis/blob/HEAD/docs/integration/mcp-and-api.md#remote-access-streamable-http--auth),
and adapt the service paths. Do not reuse another person's caller identity.
Alternatively use a deliberately configured SSH tunnel to the desktop's loopback
service; do not expose port 8129 publicly. Laptop installation/parity and a signed
release remain part of owner acceptance, not claimed by desktop automation.

The owning Browsing & Information Hygiene area maintains the browser install,
credentials and weekly queue review. Check service health and token validity
when capture fails. Before runtime upgrades or warehouse backup, stop the service,
copy the database with mode 0600 to approved backup custody, then restart it.
To roll back the local runtime: `systemctl --user disable --now noesis-capture`;
keep the warehouse for recovery. Removing the add-on removes its local queue;
export necessary receipts first.

## Validation and build

Use Node.js 22+ and npm. The browser extension has no runtime npm dependencies.
The optional integration tests require a compatible Noesis backend checkout;
this repository does not bundle the Knowledge Engine. Unit tests run independently.
The dependency override pins the linter’s image parser to patched version 2.0.4;
none of the development dependencies are bundled with the extension.

```sh
npm ci
npm test
npm run lint
npm run build  # unsigned ZIP in dist/

# Optional real Noesis HTTP suite:
# Python env needs deploy/requirements.lock; backend is a separate checkout.
NOESIS_SOURCE_DIR=/path/to/Noesis NOESIS_TEST_PYTHON=/path/to/venv/bin/python npm test

# Real Firefox event-page test; add selenium to a separate test venv:
NOESIS_SOURCE_DIR=/path/to/Noesis FIREFOX_BINARY=/path/to/firefox /path/to/test-venv/bin/python tests/browser-smoke.py

# Explicit live Oracle test: adds then removes one synthetic resource.
# Requires the configured oracle SSH alias and server-side Modulo MCP credentials.
MODULO_ORACLE_TEST=1 node --test tests/oracle-routing.test.js
```

No publication or signing occurs during build. See [action contract](ACTIONS.md)
and [verification evidence and remaining acceptance](VERIFICATION.md).

## License notices

The repository's existing [LICENSE](LICENSE) is retained. The original Noesis
MIT notice is included in [LICENSE.noesis](LICENSE.noesis) for the copied code.
