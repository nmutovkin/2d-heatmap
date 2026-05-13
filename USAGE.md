# 2D Heatmap Component — Usage Notes

## Install dependencies

```bash
npm install echarts
npm install --save-dev @types/echarts   # optional, echarts ships its own types
```

## Bootstrap (Angular 21 standalone, no NgModule needed)

```ts
// main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { HeatmapDemoComponent } from './heatmap-2d-demo.component';

bootstrapApplication(HeatmapDemoComponent);
```

## Feed real data

```ts
import { HeatmapData } from './heatmap-2d.component';

const data: HeatmapData = {
  // Flat Float32Array, row-major: index = row * 1024 + col
  values: myFloat32Array,   // length must be rows × 1024
  rows: 2000,               // 1 – 2000
  colLabels: [...],         // optional, length 1024
  rowLabels: [...],         // optional, length = rows
  title: 'My Log Track',
};
```

## Performance note — 1024 × 2000 (≈ 2 M points)

ECharts heatmap handles ~2 M points via its internal canvas renderer, but the
JS-side `[col, row, value][]` array construction takes ~200–500 ms.  For real-time
or very frequent updates consider:

1. **Web Worker** — build the `[col, row, value][]` array off the main thread
   and `postMessage` a `SharedArrayBuffer` to the component.

2. **echarts-gl** — the WebGL heatmap (`series.type: 'heatmap'` + `coordinateSystem: 'cartesian2d'` inside `echartsgl`) renders 2 M+ points in tens of
   milliseconds.  Drop-in replacement; same `HeatmapData` interface.

3. **Down-sampling** — if the viewport is narrower than 1024 px you can
   average adjacent columns without visible loss of information.

## Colormap panel features (Techlog-style)

| Feature | Implementation |
|---|---|
| Palette selector | 7 built-in palettes (Rainbow, Spectrum, Viridis, Grayscale, Hot, Seismic, Cool/Warm) |
| Reverse toggle | Flips the colour gradient direction |
| Log scale | Warps palette mapping with `t_warped = log10(1 + 9t)` |
| Draggable min/max handles | Canvas mouse drag on triangular arrows |
| Clip overlays | Semi-transparent black mask outside clip range on the gradient strip |
| Histogram overlay | Horizontal normalised-count bars mirroring value distribution |
| Exact value inputs | Number inputs stay in sync with handle positions |
| P5 / P95 auto-clip | One-click outlier rejection via cumulative histogram |
| Reset | Restores full data min/max |
