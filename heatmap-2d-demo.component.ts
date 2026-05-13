import { Component, signal } from '@angular/core';
import { HeatmapTwoDComponent, HeatmapData } from './heatmap-2d.component';

@Component({
  selector: 'app-heatmap-demo',
  standalone: true,
  imports: [HeatmapTwoDComponent],
  styles: [`
    :host { display: block; width: 100vw; height: 100vh; }
    .demo-wrap {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    app-heatmap-2d { flex: 1; min-height: 0; }
  `],
  template: `
<div class="demo-wrap">
  <app-heatmap-2d [data]="heatmapData()" />
</div>
  `,
})
export class HeatmapDemoComponent {
  readonly heatmapData = signal<HeatmapData>(generateSyntheticData());
}

// ─── Synthetic 1024 × 800 dataset ─────────────────────────────────────────────

function generateSyntheticData(): HeatmapData {
  const COLS = 1024;
  const ROWS = 800;
  const values = new Float32Array(COLS * ROWS);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      // Simulated seismic-like pattern: sinusoidal + noise
      const x = c / COLS;
      const y = r / ROWS;
      values[r * COLS + c] =
        Math.sin(x * 20 + y * 8) * 500 +
        Math.cos(x * 5  - y * 15) * 300 +
        (Math.random() - 0.5) * 100;
    }
  }

  return {
    values,
    rows: ROWS,
    title: 'Synthetic 1024 × 800 Heatmap',
  };
}
