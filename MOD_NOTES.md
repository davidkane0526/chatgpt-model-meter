# Modification notes

Upstream: `pfz14/chatgpt-model-meter`

Upstream base commit: `cf5501bc0991b78adae9d5fb45e194f9d85fddce` (main, 2026-09-06)
Upstream manifest version: `0.7.4`
Modified manifest version: `0.8.2-mod`

## UI changes

1. The normal card can be dragged from its header.
2. The header has a minimize button.
3. Minimized mode becomes a 98×48 compact quota capsule showing 5h / 7d remaining percentages plus a 5h progress ring; the capsule itself remains draggable.
4. Tap restoration no longer depends on a browser-generated `click`: `pointerup` directly resolves tap vs drag, fixing Chromium cases where pointer capture suppressed the click.
5. Position and minimized state are persisted in `chrome.storage.local`, avoiding cross-device pixel-position sync.
6. Display settings adds “Reset position”.
7. Custom drag position disables automatic sidebar-follow repositioning; reset position restores sidebar-follow behavior.
8. Settings panel flips above the card when there is insufficient space below.

## Model-detection changes

1. Removed the old “any single STE hint means STE” behavior.
2. Explicit `server_ste_metadata` event/type/path remains the primary execution evidence.
3. A compatibility fallback only activates when an unnamed object contains a model identifier plus at least three STE signature fields and is not ordinary `message.metadata`.
4. Execution evidence is prioritized:
   - explicit STE `model_slug`: 100
   - explicit STE `resolved_model_slug`: 94
   - other explicit execution keys: 90
   - strong unnamed STE fallback: lower priority
5. Lower-confidence execution evidence cannot overwrite later higher-confidence explicit STE evidence.
6. Ordinary message `model_slug` / `resolved_model_slug` remains in the echo bucket and is not promoted to execution evidence.
7. Turn association now propagates `conversation_id`, `turn_exchange_id`, `working_turn_id` / `turn_id`, and `parent_id` across SSE / WebSocket structures.
8. `auto`-style requests are shown as routed (`→`) rather than a misleading hard mismatch.
9. The model detail panel exposes execution-evidence source and priority.

## Validation

`tests/model.test.cjs` uses synthetic SSE/WebSocket data and covers:

- explicit STE metadata
- event-name-only STE
- legacy nested STE
- false-positive ordinary message metadata
- strong unnamed STE fallback
- priority replacement by explicit STE
- explicit STE `resolved_model_slug`
- Work handoff + WebSocket association
- delta patch model identifiers
- noise endpoint isolation


## v0.8.1 regression coverage

`tests/widget-gesture.test.cjs` additionally verifies:

- minimized tap restores directly on pointerup
- minimized drag remains minimized
- pointer cancel does not accidentally restore
- compact 5h / 7d values use the same remaining-percentage semantics as the full card


## v0.8.2 model label layer

- Added `model-labels.js` as a presentation-only translation layer.
- Standard Chat can infer GPT-5.6 Sol for eligible paid plans and Luna for Free/Go when no Work/Codex signal is present.
- Work/Codex generic GPT-5.6 slugs remain family-neutral unless the raw slug or UI label explicitly identifies Sol/Terra/Luna.
- Raw request and execution slugs remain available in tooltips and expanded details.
- Routing verdicts continue comparing untouched raw slugs.
- Added `tests/model-labels.test.cjs`.
