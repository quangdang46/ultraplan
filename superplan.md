# Web Parity Superplan

## Goal

Bring `web/` closer to the core UX of the CLI by fixing the highest-impact UI/UX gaps first:

1. Preserve conversation structure instead of flattening everything to plain text.
2. Render permission flows with the right interaction model.
3. Eliminate misleading UI that looks actionable but is not wired.
4. Improve session lifecycle clarity for first-run and `/new` flows.
5. Expose enough runtime state that the web app feels trustworthy.

## Non-Goals

- No `RCS` scope in this plan.
- No redesign of unrelated visual system.
- No speculative features that do not exist in the CLI mental model.

## Acceptance Standard

A gap is only considered fixed when:

- the UI no longer lies about capability,
- the underlying state model can represent the interaction correctly,
- the resulting flow is testable in code,
- and the web app still passes validation.

## Gap Checklist

| Status | Gap | Why it matters | Acceptance |
|---|---|---|---|
| `[~]` | Transcript fidelity | History currently loses tool and block structure | Session history preserves enough text/tool block structure to reopen sessions without flattening everything to plain text |
| `[x]` | Tool result hydration from history | Re-opened sessions drop tool context | Historical tool uses/results show in conversation instead of vanishing |
| `[x]` | Generic permission UI only | All approvals look the same, even when they are not | Permission surface routes to tool-specific views where needed |
| `[x]` | Missing ask-user flow | CLI can ask structured questions; web cannot | Ask-user requests can be answered in web and return `updatedInput` |
| `[x]` | Weak plan approval surface | Plans are treated like generic approvals | Exit-plan approvals show plan content and support approval/revision feedback |
| `[x]` | False affordances in action bar | Buttons imply workflows that do not exist | Non-functional action buttons are removed or made truthful |
| `[x]` | False affordances in sidebar | Sidebar composer/footer controls are misleading | Sidebar only contains working controls |
| `[x]` | False affordances in panel header | Caret and static status imply behaviors that are fake | Header shows real state only |
| `[x]` | False affordance in selection tooltip | Diagram action is not backed by real conversation-derived output | Tooltip only offers actions that are actually supported |
| `[x]` | New session routing ambiguity | Sending from `/new` does not clearly adopt the new session route | New sessions navigate into canonical `/chat/:id` flow automatically |
| `[x]` | Empty-state clarity | First-run state is underspecified | Empty states explain what happens next and how to start |
| `[x]` | Runtime state visibility | Model, permission mode, cwd are hidden despite being available | Action surface shows key runtime state, not just git branch |
| `[x]` | Session status visibility | Top bar shows static fake status text | Top bar reflects actual session status and recency |
| `[x]` | Fake branch/default chips in sidebar | Static chips reduce trust | Sidebar metadata uses real session data or stays hidden |
| `[x]` | Regression coverage | These fixes touch contracts and hydration logic | Add/update focused tests for history hydration and UI flows where practical |

## Execution Order

### Phase 1: Foundation

- Upgrade session/contracts so history can carry structured blocks.
- Add a history hydration layer in `web/`.
- Upgrade permission response plumbing to support `updatedInput` and feedback.

### Phase 2: Core Interaction Fixes

- Implement ask-user permission UI.
- Implement plan-specific approval UI.
- Fix `/new` session adoption flow.

### Phase 3: Trust Surface Cleanup

- Remove or replace fake controls in action bar, sidebar, tooltip, and header.
- Replace placeholder state with real status metadata.

### Phase 4: Validation

- Run repo typecheck.
- Run web build/tests.
- Update this checklist to reflect actual completion state.

## Remaining Follow-Up Work

- Finish full transcript parity beyond tool history:
  preserve richer assistant/user block variants instead of only the subset currently reconstructed.
- Add advanced ask-user parity:
  previews rendered more faithfully, richer annotations, and image attachments.
- Add deeper plan-mode parity:
  expose more of the CLI approval branches instead of simple approve/request-changes.
- Restore expert controls:
  model switching, thinking toggle, history search, and codebase/global search in the web UI.
- Add attachment parity:
  paste/upload images and richer multi-line composer behavior.
