# Layouts on playlists, layout versions, and campaigns

A **layout** splits a screen into zones (a menu on the left, a promo on the right, a ticker along
the bottom). Until 3.0 a layout belonged to a **screen** only: a group of twenty screens playing a
zoned playlist needed the layout set on each of the twenty by hand, and a new screen joining the
group played the zoned items squeezed into whatever layout it happened to have.

3.0 adds three things:

1. **A layout on a playlist.** Pick it once, on the playlist; every screen that plays the playlist
   draws it.
2. **Portrait and 4:3 versions of a layout.** The same zones, arranged for a different screen
   shape, so one playlist layout works on landscape and portrait screens in the same group.
3. **Campaigns** — see the second half of this page (added with the campaigns feature).

---

## 1. A layout on a playlist

### For everyone

Open a playlist. Under its name there is a **Layout** row:

- **Each screen's own layout** (the default) — nothing changes: each screen uses the layout set on
  the screen, exactly as before.
- **Any layout** (yours or a built-in template) — every screen playing this playlist uses it,
  whether the playlist reached the screen through the screen itself, a group, or a schedule.

When a playlist has a layout, every item row gets a **Zone** picker. **Main zone** means "no zone of
its own": the item plays in the layout's main zone. Items added from anywhere that does not ask
for a zone — the Simple view's "Show on screen", **Make a sign**, approved content requests, an
experiment's variants, the API — all land in the main zone automatically.

Changing a layout is a **draft** like any other playlist edit: screens keep what they have until
you **Publish**, and then get the new layout and the moved items together. **Discard changes**
puts the old layout back too.

#### Changing to a different layout

If the playlist's items already sit in zones of another layout, ScreenTinker shows where it
suggests each group of items goes:

1. a zone with the **same name** ("Ticker" → "ticker"),
2. otherwise the zone covering **the same part of the screen** best,
3. otherwise the **main zone**.

Change any row, then **Change layout**. Nothing moves until you confirm. Choosing **Each screen's
own layout** again keeps every item's zone as it is.

#### The main zone

In the layout editor, select a zone and tick **Main zone**. If no zone is ticked, the **largest**
zone is the main zone (the first of equal ones) — the same rule every player already used for an
item whose zone it could not find, so old and new players agree.

### Which layout does a screen draw? (precedence)

Decided in one place on the server (the `device_resolved_playlist` view), highest first:

| # | Source | Notes |
|---|--------|-------|
| 1 | **Head office mandate** | Its own layout, or full screen. A store's playlist layout never shrinks head office's content. |
| 2 | **An active schedule's layout** | Only when the schedule itself names a layout. |
| 3 | **The playlist's layout** | The *published* layout of the playlist the screen resolved to (screen, group or schedule). |
| 4 | **The screen's own layout** | Unchanged from 2.x. |
| — | Full screen | When none of the above applies. |

Special cases:

- **Nested playlists:** only the TOP-LEVEL playlist's layout counts. A playlist used inside another
  playlist has its own layout ignored there; its items follow the parent item's zone, or the
  parent's main zone.
- **Video walls** keep their wall layout (**Walls → Layout**). A wall member never takes a playlist
  layout: the wall is the canvas.
- **Emergency alerts, CAP feeds and automation overrides** play full screen, as before.
- A schedule that names no layout plays its playlist's own layout (if it has one), else the
  screen's.

The screen's page (**Displays → a screen**) says which layout is on screen and who chose it
("chosen by this screen's playlist"), and **What will this screen show?** names the tier too. The
zone picker on the screen's page offers the zones of the layout actually on screen.

### For admins

- Head office playlists take their layout from the mandate, not the playlist (refused with
  `CORPORATE_LAYOUT`); content for a head office slot plays inside head office's layout
  (`FILL_LAYOUT`).
- A layout from another workspace can never be chosen (403); a zone map can only point into the new
  layout (400). Built-in templates are allowed everywhere.
- Deleting a layout clears it from every playlist that chose it (they go back to "each screen's own
  layout") and pushes the affected screens.
- Export/import carries the playlist's layout when the layout is in the same export (or is a
  built-in template).
- Version history and approvals include the playlist's layout: a layout change needs approval like
  any other playlist change when approvals are on.
- Activity log: `playlist.layout_changed`.

### API

| Call | What it does |
|---|---|
| `PUT /api/playlists/:id` `{ layout_id }` | Choose a layout (`null` = each screen's own). Draft until publish. |
| `PUT /api/playlists/:id` `{ layout_id, zone_map: { oldZoneId: newZoneId } }` | Choose and move items in one transaction. |
| `GET /api/playlists/:id/layout-zone-map?layout_id=` | The zones in use, item counts, and a suggested target for each. Read-only. |
| `GET /api/playlists/:id` | `layout` is the chosen layout with `explicit: true` and `main_zone_id`, else #104's derived one. |
| `PUT /api/layouts/:id` | Zones may carry `is_main: 1`. |

Database: `playlists.layout_id` (draft) and `playlists.published_layout_id` (on screens), both
`REFERENCES layouts ON DELETE SET NULL`; `layout_zones.is_main`. All NULL/0 = exactly the 2.x
behaviour — the test suite proves every existing screen's payload is byte-identical
(`test/playlist-layout.test.js`).

---

## 2. Portrait and 4:3 versions of a layout

Zones are percentages, so a layout already fits any **resolution**. What it cannot survive is a
different **shape**: three side-by-side columns drawn on a portrait screen become slivers.

A layout can now have a **portrait version** and a **4:3 version**: the **same zones** (same ids,
so every item bound to a zone plays in that zone in every version), each with its own position and
size.

### For everyone

In the layout editor there is a **Landscape | Portrait | 4:3** switch.

- Switch to **Portrait** and press **Create portrait version**: ScreenTinker arranges the zones for
  you as a starting point — side-by-side zones are stacked top to bottom in the same order, and a
  full-width banner (a ticker, a header) stays full width at the same end of the screen, with the
  same height in pixels. Adjust it, then **Save**.
- **Remove this version** goes back to "portrait screens use the landscape zones".
- The canvas previews at 9:16 (portrait) or 4:3.

### Which version a screen gets

Decided when the playlist is sent to the screen, from the screen's real shape:

- the **orientation** set on the screen (a portrait setting turns a landscape panel), and
- the **resolution the player reported** (a natively portrait panel; a 4:3 or 5:4 monitor).

| Screen shape (width ÷ height) | Version |
|---|---|
| below 0.8 (9:16, 3:4) | portrait |
| 0.8 – 1.45 (1:1, 5:4, 4:3) | 4:3 |
| wider (16:10, 16:9, ultrawide) | landscape (the default) |

A screen whose version the layout does not have gets the landscape zones — exactly what it got
before (byte-for-byte). Players need no update: they still just receive zone rectangles.

Versions apply wherever a layout reaches a screen: the screen's own layout, a schedule's layout,
a playlist's layout and a campaign's layout items. **What will this screen show?** builds the same
payload and shows the same version; the playlist preview's **Portrait** toggle shows the portrait
version. Video walls are not affected (a wall is its own canvas).

### For admins / API

- Stored in `layout_zone_variants (zone_id, layout_id, variant, x/y/width/height_percent)`,
  `variant` ∈ `portrait`, `square` (= the 4:3 version). A side table rather than columns on
  `layout_zones`, because every payload is built with `SELECT * FROM layout_zones`: new columns
  would add fields to every zoned screen's payload, rows in a side table change nothing for a layout
  without versions.
- `GET /api/layouts/:id`: each zone has `variants: { portrait: {...}, square: {...} }` when set.
  `GET /api/layouts`: each layout lists `variants: ['portrait']`.
- `PUT /api/layouts/:id`: send `variants` on a zone to set them; `{ portrait: null }` removes one;
  a zone without `variants` keeps its versions (an older editor never erases them). Versions are
  only ever written for that layout's own zones.
- `POST /api/layouts/auto-variant` `{ variant, zones, width, height }` returns the starting
  arrangement (pure arithmetic, nothing stored).
- In the payload a version adds `layout.variant` and swaps `layout.width`/`height` to the version's
  canvas; zone ids, order and every other field are unchanged.
