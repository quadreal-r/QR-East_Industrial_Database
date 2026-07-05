# Map feature

Google Maps panel with building markers, detail layers, hover tooltips, info windows, and imagery cycling.

| File | Role |
|------|------|
| `MapPanel.tsx` | Top bar, map container, placeholder when no API key |
| `useMapMarkers.ts` | Marker lifecycle, selection, layers, imagery |
| `MapPanel.module.css` | Map-specific layout overrides |

## Behaviour

- **No Google key:** shows a placeholder; sidebar and cost banner still work.
- **Layers:** RTU/tenant/utility markers appear at zoom ≥ 16 when the layer toggle is on.
- **Imagery:** cycles Google hybrid → Esri tiles.
- **Selection:** clicking a building in the list or on the map pans, zooms, and opens an info window.

Styles come from `src/styles/legacy.css`; this folder only adds minimal layout overrides.
