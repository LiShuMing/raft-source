# Claude configuration on execution Computers

Choose the Computer before configuring Claude Code. All native settings refer
to that execution Computer, never the admin server.

| Configuration | Connection and credentials | Model |
| --- | --- | --- |
| Machine settings (recommended) | Native Claude settings on the selected Computer | Resolved by Claude; no `--model`, effort or fast-mode override |
| Override model | Native Claude connection on the selected Computer | Explicit listed or typed model ID |
| Custom connection | URL/key explicitly stored by Raft | Explicit listed or typed model ID |

New Claude Agents use machine settings. Existing Agents retain their explicit
models and providers when opened or saved. Native credentials are not fetched
into the form. Custom connection credentials remain platform-managed and are
omitted from the edit form's values.

Machine settings delegates to Claude's normal settings resolution, including
`~/.claude/settings.json` and applicable project/local settings. It does not copy
the admin server's settings. For example, when `model` and
`env.ANTHROPIC_MODEL` disagree, Claude determines their precedence. The form
does not present either value as a verified runtime model. Advanced environment
variables and a custom executable remain explicit overrides.

The persisted model policy is `{ "kind": "machine" }`. Its flat launch
projection is an empty model string, while the structured configuration remains
authoritative. Legacy model and effort columns cannot overwrite that policy.

## Runner compatibility

The execution Computer must advertise `claude:machine-settings-v1`. The server
refuses to launch this policy on an offline or older Computer instead of letting
an old Runner silently substitute Sonnet. Upgrade the selected Computer's
Runner before choosing inheritance, or use Override model in the meantime.
The admin service and every remote Runner must run the updated code; rebuilding
this checkout alone does not upgrade an installed remote package.

## Validation

Focused tests cover configuration persistence, legacy compatibility, hidden
field removal, native launch arguments, old-Runner rejection, and the three
form modes. Browser fixture checks cover desktop/mobile rendering without
model calls or access to native credentials. They do not verify a real model
response or deploy updated services.
