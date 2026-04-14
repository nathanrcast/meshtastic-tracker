# Date Range Picker for Position History

## Context

The map currently shows the last 24 hours of position history for all displayed nodes (hardcoded). There's no way to view older trails or narrow the window. This adds a date range control to the map UI so the user can select a custom time window for trail data.

## Current State

- **Backend**: `get_node_positions(db, node_id, hours=24)` filters by `timestamp >= now - hours`. API endpoint accepts `?hours=` param, constrained to 1–168 (7 days).
- **Frontend**: `MapView.jsx:69` passes hardcoded `24` to `api.nodePositions(id, 24)`. Trails refetch whenever `displayNodeIds` changes.
- **Data retention**: Positions auto-pruned after `PRUNE_DAYS` (default 30 days), so up to 30 days of history may exist.

## Implementation Plan

### Backend

**1. Add `start`/`end` params to position endpoint** (`src/api.py:149-155`)
- Add optional `start` and `end` query params (ISO 8601 datetime strings)
- If `start`/`end` provided, use them directly; otherwise fall back to `hours` param
- Raise `le` constraint on `hours` from 168 to 720 (30 days) to match `PRUNE_DAYS`

**2. Update `get_node_positions`** (`src/queries.py:115-131`)
- Add optional `start: datetime | None` and `end: datetime | None` params
- If `start`/`end` provided, filter `timestamp >= start AND timestamp <= end`
- Otherwise keep existing `hours`-based cutoff logic
- No schema changes needed (response shape unchanged)

### Frontend

**3. Add `trailHours` state + preset buttons** (`web/src/pages/MapView.jsx`)
- New state: `const [trailHours, setTrailHours] = useState(24)`
- Preset buttons row below the My Nodes / All Nodes filter bar: `1h`, `6h`, `24h`, `3d`, `7d`, `30d`
- Styled to match the existing filter bar (same `bg-th-surface/90 backdrop-blur border...` pattern)
- Active preset gets accent ring, same as the "My Nodes" / "All Nodes" buttons
- `trailHours` added as dependency to the trail-fetching `useEffect` (line 61) so changing it triggers a refetch

**4. Add custom date range mode** (`web/src/pages/MapView.jsx`)
- A "Custom" button at the end of the presets row
- When active, shows two `<input type="datetime-local">` fields (start/end) in a small dropdown below
- Custom range passes `start`/`end` ISO strings to the API instead of `hours`
- Native HTML datetime-local inputs — no external library needed, matches the minimal dependency approach

**5. Update `api.nodePositions`** (`web/src/api.js:47-48`)
- Accept optional `{ start, end }` object in addition to `hours`
- Build query string accordingly: `?hours=N` or `?start=X&end=Y`

**6. Wire trail refetch to new state** (`web/src/pages/MapView.jsx:61-78`)
- Replace hardcoded `24` with `trailHours` in the `api.nodePositions()` call
- For custom mode, pass `start`/`end` instead
- Add `trailHours` (and custom range state) to the `useEffect` dependency array
- Real-time WebSocket position updates continue appending to trails regardless of range

### Files to Modify

| File | Changes |
|---|---|
| `src/queries.py` | `get_node_positions` gains optional `start`/`end` datetime params |
| `src/api.py` | Position endpoint accepts `start`/`end` query params, raise `hours` max to 720 |
| `web/src/api.js` | `nodePositions` accepts `start`/`end` option |
| `web/src/pages/MapView.jsx` | `trailHours` state, preset buttons, custom date range inputs, refetch wiring |

### UI Layout

```
[ My Nodes ] [ All Nodes (200) ]      ← existing filter bar
[ 1h  6h  24h  3d  7d  30d  Custom ]  ← new trail range bar (below filter)
    [ 2026-03-20 08:00 ] → [ 2026-03-24 12:00 ]  ← only shown when "Custom" active
```

### Edge Cases

- **Custom range with no data**: trails will be empty, no special handling needed (polylines just won't render)
- **Custom end in the future**: fine, query returns everything up to now
- **Real-time updates during custom range**: WebSocket position events still append to trails. This is correct — you want to see new positions arrive even if viewing a historical window
- **30-day preset with many nodes**: could return large datasets. The existing 500-point cap per node in the WebSocket handler doesn't apply to API fetches, but SQLite + the composite index handles this efficiently

## Verification

1. Load the map — verify default `24h` button is active, trails show as before
2. Click `1h` — verify trails shrink to last hour only
3. Click `7d` — verify trails extend to a week of history
4. Click `Custom` — verify date inputs appear, set a range, verify trails update
5. Switch back to a preset — verify custom inputs hide and trails refetch
6. Reload page — verify default 24h is restored (no persistence needed)
