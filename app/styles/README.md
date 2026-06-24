# CSS Layer Map

`app/globals.css` is the only global stylesheet imported by the root layout. It is a manifest of ordered imports.

Keep the order stable. Later files intentionally override earlier files, especially the `80-*` through `91-*` repair layers.

Current shape:

- `00-foundation-legacy.css`: base tokens, shared shell, and the older broad app styles.
- `10-*` through `30-*`: visual repair, publishing pages, and library polish.
- `40-*`: Fiber-specific surfaces.
- `50-*` through `60-*`: theme, library, and Atlas styles.
- `70-*`: reader, Fiber, and admin creation styles.
- `80-*` through `85-*`: final override stack split by repair pass.
- `90-*` through `91-*`: former late-fixes layer, including layout fixes and Arena/factory styles.
- `92-*`: final atmosphere layer for material texture, room identity, and artifact cues.

When cleaning further, remove or consolidate rules inside a layer first, then run `npm run build` before moving rules across layer boundaries.
