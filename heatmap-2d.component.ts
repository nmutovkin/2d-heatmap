import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  afterNextRender,
  ChangeDetectionStrategy,
  effect,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

// ─── Public types ─────────────────────────────────────────────────────────────

/** Flat row-major array: values[row * 1024 + col]. NaN is treated as missing. */
export interface HeatmapData {
  values: Float32Array | number[];
  rows: number;           // 1 – 2000
  colLabels?: string[];   // length 1024 (optional axis tick labels)
  rowLabels?: string[];   // length = rows
  title?: string;
}

// ─── Colour palettes ──────────────────────────────────────────────────────────

interface ColorStop {
  t: number;               // 0–1
  rgb: [number, number, number];
}

interface ColorPalette {
  id: string;
  label: string;
  stops: ColorStop[];
}

const PALETTES: ColorPalette[] = [
  {
    id: 'rainbow',
    label: 'Rainbow',
    stops: [
      { t: 0.000, rgb: [0,   0,   191] },
      { t: 0.125, rgb: [0,   63,  255] },
      { t: 0.250, rgb: [0,   191, 255] },
      { t: 0.375, rgb: [0,   255, 127] },
      { t: 0.500, rgb: [127, 255, 0  ] },
      { t: 0.625, rgb: [255, 191, 0  ] },
      { t: 0.750, rgb: [255, 63,  0  ] },
      { t: 0.875, rgb: [191, 0,   0  ] },
      { t: 1.000, rgb: [127, 0,   0  ] },
    ],
  },
  {
    id: 'spectrum',
    label: 'Spectrum',
    stops: [
      { t: 0.000, rgb: [148, 0,   211] },
      { t: 0.167, rgb: [0,   0,   255] },
      { t: 0.333, rgb: [0,   255, 255] },
      { t: 0.500, rgb: [0,   255, 0  ] },
      { t: 0.667, rgb: [255, 255, 0  ] },
      { t: 0.833, rgb: [255, 127, 0  ] },
      { t: 1.000, rgb: [255, 0,   0  ] },
    ],
  },
  {
    id: 'viridis',
    label: 'Viridis',
    stops: [
      { t: 0.000, rgb: [68,  1,   84 ] },
      { t: 0.250, rgb: [59,  82,  139] },
      { t: 0.500, rgb: [33,  145, 140] },
      { t: 0.750, rgb: [94,  201, 98 ] },
      { t: 1.000, rgb: [253, 231, 37 ] },
    ],
  },
  {
    id: 'grayscale',
    label: 'Grayscale',
    stops: [
      { t: 0, rgb: [0,   0,   0  ] },
      { t: 1, rgb: [255, 255, 255] },
    ],
  },
  {
    id: 'hot',
    label: 'Hot',
    stops: [
      { t: 0.000, rgb: [0,   0,   0  ] },
      { t: 0.333, rgb: [255, 0,   0  ] },
      { t: 0.667, rgb: [255, 255, 0  ] },
      { t: 1.000, rgb: [255, 255, 255] },
    ],
  },
  {
    id: 'seismic',
    label: 'Seismic',
    stops: [
      { t: 0.000, rgb: [0,   0,   139] },
      { t: 0.250, rgb: [100, 149, 237] },
      { t: 0.500, rgb: [255, 255, 255] },
      { t: 0.750, rgb: [255, 99,  71 ] },
      { t: 1.000, rgb: [139, 0,   0  ] },
    ],
  },
  {
    id: 'cool_warm',
    label: 'Cool / Warm',
    stops: [
      { t: 0.000, rgb: [59,  76,  192] },
      { t: 0.250, rgb: [144, 178, 254] },
      { t: 0.500, rgb: [220, 220, 220] },
      { t: 0.750, rgb: [245, 156, 125] },
      { t: 1.000, rgb: [180, 4,   38 ] },
    ],
  },
];

// ─── Colour helpers ───────────────────────────────────────────────────────────

function lerpRGB(
  stops: ColorStop[],
  t: number,
): [number, number, number] {
  if (t <= stops[0].t) return stops[0].rgb;
  const last = stops[stops.length - 1];
  if (t >= last.t) return last.rgb;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t);
      return [
        Math.round(a.rgb[0] + f * (b.rgb[0] - a.rgb[0])),
        Math.round(a.rgb[1] + f * (b.rgb[1] - a.rgb[1])),
        Math.round(a.rgb[2] + f * (b.rgb[2] - a.rgb[2])),
      ];
    }
  }
  return last.rgb;
}

function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('');
}

/** Generate an N-step colour array from a palette, respecting the reverse flag. */
function paletteToECharts(palette: ColorPalette, reversed: boolean, steps = 64): string[] {
  return Array.from({ length: steps }, (_, i) => {
    const t = reversed ? 1 - i / (steps - 1) : i / (steps - 1);
    return toHex(lerpRGB(palette.stops, t));
  });
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLS = 1024;
const HIST_BINS = 100;
const CB_H = 280;      // colorbar canvas height (px)
const HIST_W = 72;     // histogram area width
const STRIP_W = 22;    // colour gradient strip width
const HANDLE_AREA = 14; // handle triangle area width

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-heatmap-2d',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  styles: [`
    :host {
      display: flex;
      width: 100%;
      height: 100%;
      min-height: 0;
      background: #1e1e2e;
      color: #cdd6f4;
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 12px;
      box-sizing: border-box;
    }

    /* ── chart ───────────────────────────────────────────── */
    .chart-area {
      flex: 1;
      min-width: 0;
      min-height: 0;
    }

    /* ── sidebar ─────────────────────────────────────────── */
    .colormap-panel {
      width: 186px;
      flex-shrink: 0;
      background: #181825;
      border-left: 1px solid #313244;
      padding: 8px 6px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      overflow: hidden;
      user-select: none;
    }

    .panel-title {
      font-weight: 600;
      font-size: 13px;
      color: #89b4fa;
      padding-bottom: 4px;
      border-bottom: 1px solid #313244;
      letter-spacing: 0.5px;
    }

    select {
      width: 100%;
      background: #313244;
      color: #cdd6f4;
      border: 1px solid #45475a;
      border-radius: 4px;
      padding: 3px 4px;
      font-size: 12px;
      cursor: pointer;
    }
    select:focus { outline: none; border-color: #89b4fa; }

    .options-row {
      display: flex;
      gap: 12px;
    }
    .options-row label {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      font-size: 11px;
      color: #a6adc8;
    }
    .options-row input[type=checkbox] { cursor: pointer; accent-color: #89b4fa; }

    /* ── clip inputs ─────────────────────────────────────── */
    .clip-row {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .clip-lbl {
      font-size: 10px;
      color: #6c7086;
      width: 26px;
      flex-shrink: 0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .clip-input {
      flex: 1;
      min-width: 0;
      background: #313244;
      color: #cdd6f4;
      border: 1px solid #45475a;
      border-radius: 4px;
      padding: 2px 4px;
      font-size: 11px;
    }
    .clip-input:focus { outline: none; border-color: #89b4fa; }

    /* ── colorbar canvas ─────────────────────────────────── */
    .canvas-wrap {
      display: flex;
      justify-content: center;
      cursor: ns-resize;
      flex-shrink: 0;
    }
    canvas { image-rendering: pixelated; display: block; }

    /* ── data range / actions ────────────────────────────── */
    .data-range {
      font-size: 10px;
      color: #6c7086;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .actions-row {
      display: flex;
      gap: 4px;
    }
    .actions-row button {
      flex: 1;
      background: #313244;
      color: #cdd6f4;
      border: 1px solid #45475a;
      border-radius: 4px;
      padding: 4px 0;
      font-size: 11px;
      cursor: pointer;
    }
    .actions-row button:hover { background: #45475a; }
    .btn-reset { border-color: #f38ba8 !important; }
    .btn-auto  { border-color: #a6e3a1 !important; }
  `],
  template: `
<div class="chart-area" #chartEl></div>

<div class="colormap-panel">
  <div class="panel-title">Color Map</div>

  <!-- Palette selector -->
  <select [(ngModel)]="selectedPaletteId" (ngModelChange)="applyColormap()">
    @for (p of palettes; track p.id) {
      <option [value]="p.id">{{ p.label }}</option>
    }
  </select>

  <!-- Options -->
  <div class="options-row">
    <label>
      <input type="checkbox" [(ngModel)]="reversed" (ngModelChange)="applyColormap()">
      Reverse
    </label>
    <label>
      <input type="checkbox" [(ngModel)]="logScale" (ngModelChange)="applyColormap()">
      Log
    </label>
  </div>

  <!-- Max clip -->
  <div class="clip-row">
    <span class="clip-lbl">Max</span>
    <input type="number" class="clip-input"
      [value]="clipMax() | number:'1.0-4'"
      (change)="onMaxChange($event)" (blur)="onMaxChange($event)">
  </div>

  <!-- Colorbar canvas: gradient strip + histogram + handles -->
  <div class="canvas-wrap">
    <canvas #cbCanvas
      [width]="CANVAS_W"
      [height]="CB_H"
      (mousedown)="onCanvasDown($event)"
      (mousemove)="onCanvasMoveLocal($event)">
    </canvas>
  </div>

  <!-- Min clip -->
  <div class="clip-row">
    <span class="clip-lbl">Min</span>
    <input type="number" class="clip-input"
      [value]="clipMin() | number:'1.0-4'"
      (change)="onMinChange($event)" (blur)="onMinChange($event)">
  </div>

  <!-- Stats -->
  <div class="data-range">
    Data: {{ dataMin() | number:'1.0-4' }} – {{ dataMax() | number:'1.0-4' }}
  </div>

  <!-- Actions -->
  <div class="actions-row">
    <button class="btn-reset" (click)="resetClip()">Reset</button>
    <button class="btn-auto"  (click)="autoClip()">P5 / P95</button>
  </div>
</div>
  `,
})
export class HeatmapTwoDComponent implements OnDestroy {

  // ── inputs ──────────────────────────────────────────────────────────────────

  readonly data = input<HeatmapData | null>(null);

  // ── view refs ───────────────────────────────────────────────────────────────

  @ViewChild('chartEl') private chartElRef!: ElementRef<HTMLDivElement>;
  @ViewChild('cbCanvas') private cbCanvasRef!: ElementRef<HTMLCanvasElement>;

  // ── public constants (template-visible) ─────────────────────────────────────

  readonly palettes = PALETTES;
  readonly CB_H = CB_H;
  readonly CANVAS_W = HIST_W + STRIP_W + HANDLE_AREA;

  // ── state ───────────────────────────────────────────────────────────────────

  selectedPaletteId = 'rainbow';
  reversed = false;
  logScale = false;

  readonly dataMin = signal(0);
  readonly dataMax = signal(1);
  readonly clipMin = signal(0);
  readonly clipMax = signal(1);

  // ── private ─────────────────────────────────────────────────────────────────

  private chart: echarts.ECharts | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;

  /** Normalised histogram counts [0..1], index 0 = lowest value bucket. */
  private histBins: number[] = new Array(HIST_BINS).fill(0);

  /** P5 / P95 values computed from data. */
  private p5 = 0;
  private p95 = 1;

  /** Active drag handle: 'min' | 'max' | null */
  private dragging: 'min' | 'max' | null = null;

  // Stable bound references for add/removeEventListener
  private readonly onWindowMove = (e: MouseEvent) => {
    if (!this.dragging) return;
    const rect = this.cbCanvasRef.nativeElement.getBoundingClientRect();
    this.applyDrag(e.clientY - rect.top);
  };
  private readonly boundMouseUp = () => this.onDocumentMouseUp();

  // ── lifecycle ───────────────────────────────────────────────────────────────

  constructor() {
    afterNextRender(() => {
      this.initChart();
      this.ctx = this.cbCanvasRef.nativeElement.getContext('2d');
      this.setupResize();
      // Data may have arrived before the chart was ready (effect fires first).
      const d = this.data();
      if (d) this.processData(d);
      else this.drawColorbar();
    });

    effect(() => {
      const d = this.data();
      // Guard: if the chart isn't initialised yet, afterNextRender handles it.
      if (d && this.chart) this.processData(d);
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
    window.removeEventListener('mousemove', this.onWindowMove);
    window.removeEventListener('mouseup',   this.boundMouseUp);
  }

  // ── initialisation ──────────────────────────────────────────────────────────

  private initChart(): void {
    this.chart = echarts.init(this.chartElRef.nativeElement, null, {
      renderer: 'canvas',
    });
    this.chart.setOption(this.buildOption());
  }

  private setupResize(): void {
    this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
    this.resizeObserver.observe(this.chartElRef.nativeElement);
  }

  // ── data processing ─────────────────────────────────────────────────────────

  private processData(d: HeatmapData): void {
    const { values } = d;
    const len = values.length;

    // Compute min / max, skipping NaN / ±Inf
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < len; i++) {
      const v = values[i];
      if (isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; }
    }
    if (!isFinite(mn)) { mn = 0; mx = 1; }

    this.dataMin.set(mn);
    this.dataMax.set(mx);

    // Histogram (value → normalised count)
    const range = mx - mn || 1;
    const rawBins = new Array<number>(HIST_BINS).fill(0);
    for (let i = 0; i < len; i++) {
      const v = values[i];
      if (!isFinite(v)) continue;
      const b = Math.floor(((v - mn) / range) * (HIST_BINS - 1));
      rawBins[Math.max(0, Math.min(HIST_BINS - 1, b))]++;
    }
    const maxBin = Math.max(...rawBins) || 1;
    this.histBins = rawBins.map(b => b / maxBin);

    // P5 / P95 via cumulative histogram
    const total = rawBins.reduce((s, b) => s + b, 0);
    let cumul = 0, p5bin = 0, p95bin = HIST_BINS - 1;
    for (let i = 0; i < HIST_BINS; i++) {
      cumul += rawBins[i];
      if (cumul / total < 0.05) p5bin = i;
      if (cumul / total < 0.95) p95bin = i;
    }
    this.p5  = mn + (p5bin  / (HIST_BINS - 1)) * range;
    this.p95 = mn + (p95bin / (HIST_BINS - 1)) * range;

    this.clipMin.set(mn);
    this.clipMax.set(mx);

    // Rebuild chart
    this.chart?.setOption(this.buildOption(d), { notMerge: true });
    this.drawColorbar();
  }

  // ── ECharts option builder ──────────────────────────────────────────────────

  private buildOption(d?: HeatmapData): EChartsOption {
    const palette = PALETTES.find(p => p.id === this.selectedPaletteId) ?? PALETTES[0];
    const colors  = this.effectivePaletteColors(palette);
    const rows    = d?.rows ?? 0;

    return {
      backgroundColor: '#1e1e2e',
      animation: false,
      // Disable progressive (chunked) rendering — the default causes the
      // "line by line" appearance on large datasets (>3 000 points).
      progressive: 0,
      ...(d?.title ? {
        title: {
          text: d.title,
          left: 'center',
          textStyle: { color: '#cdd6f4', fontSize: 14 },
        },
      } : {}),
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (params: any) => {
          const [col, row, val] = params.data as [number, number, number];
          const colLbl = d?.colLabels?.[col] ?? col;
          const rowLbl = d?.rowLabels?.[row] ?? row;
          const label  = isFinite(val) ? val.toPrecision(6) : 'NaN';
          return `Col: ${colLbl} &nbsp; Row: ${rowLbl}<br/>Value: <b>${label}</b>`;
        },
      },
      grid: { left: 60, right: 10, top: d?.title ? 44 : 10, bottom: 50 },
      xAxis: {
        type: 'category',
        data: d?.colLabels ?? colRange(COLS),
        name: 'Column',
        nameLocation: 'middle',
        nameGap: 28,
        nameTextStyle: { color: '#a6adc8' },
        axisLabel: { color: '#a6adc8', interval: Math.floor(COLS / 8) - 1 },
        axisTick: { alignWithLabel: true },
        axisLine: { lineStyle: { color: '#45475a' } },
        splitArea: { show: false },
      },
      yAxis: {
        type: 'category',
        data: d?.rowLabels ?? colRange(rows),
        name: 'Row',
        nameLocation: 'middle',
        nameGap: 40,
        nameTextStyle: { color: '#a6adc8' },
        axisLabel: { color: '#a6adc8' },
        axisLine: { lineStyle: { color: '#45475a' } },
        splitArea: { show: false },
      },
      visualMap: {
        type: 'continuous',
        min: this.effectiveMin(),
        max: this.effectiveMax(),
        show: false,
        inRange: { color: colors },
        outOfRange: {
          // values outside clip range → edge palette colour (same as Techlog)
          color: [colors[0], colors[colors.length - 1]],
        },
      },
      series: [{
        type: 'heatmap',
        data: d ? this.flatToECharts(d) : [],
        emphasis: { disabled: true },
      }],
    };
  }

  /** Convert flat row-major array → ECharts [[col, row, val], …]. */
  private flatToECharts(d: HeatmapData): [number, number, number][] {
    const { values, rows } = d;
    const out: [number, number, number][] = new Array(rows * COLS);
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      const base = r * COLS;
      for (let c = 0; c < COLS; c++) {
        out[idx++] = [c, r, values[base + c] as number];
      }
    }
    return out;
  }

  // ── colormap helpers ────────────────────────────────────────────────────────

  private effectivePaletteColors(palette: ColorPalette): string[] {
    if (!this.logScale) return paletteToECharts(palette, this.reversed);

    // Log-scale: warp t so more colours are devoted to low values.
    // t_warped = log10(1 + 9*t) keeps the palette range [0..1] but
    // compresses the high end, matching Techlog's log-curve display.
    const steps = 64;
    return Array.from({ length: steps }, (_, i) => {
      const tLin  = i / (steps - 1);
      const tWarp = Math.log10(1 + 9 * tLin);   // maps 0→0, 1→1
      const tFin  = this.reversed ? 1 - tWarp : tWarp;
      return toHex(lerpRGB(palette.stops, tFin));
    });
  }

  private effectiveMin(): number {
    if (this.logScale && this.clipMin() > 0) return Math.log10(this.clipMin());
    return this.clipMin();
  }

  private effectiveMax(): number {
    if (this.logScale && this.clipMax() > 0) return Math.log10(this.clipMax());
    return this.clipMax();
  }

  // ── colormap panel interactions ─────────────────────────────────────────────

  applyColormap(): void {
    if (!this.chart) return;
    const palette = PALETTES.find(p => p.id === this.selectedPaletteId) ?? PALETTES[0];
    const colors  = this.effectivePaletteColors(palette);
    this.chart.setOption({
      visualMap: {
        min: this.effectiveMin(),
        max: this.effectiveMax(),
        inRange: { color: colors },
        outOfRange: { color: [colors[0], colors[colors.length - 1]] },
      },
    });
    this.drawColorbar();
  }

  resetClip(): void {
    this.clipMin.set(this.dataMin());
    this.clipMax.set(this.dataMax());
    this.applyColormap();
  }

  autoClip(): void {
    this.clipMin.set(this.p5);
    this.clipMax.set(this.p95);
    this.applyColormap();
  }

  onMaxChange(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (isFinite(v) && v > this.clipMin()) {
      this.clipMax.set(v);
      this.applyColormap();
    }
  }

  onMinChange(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (isFinite(v) && v < this.clipMax()) {
      this.clipMin.set(v);
      this.applyColormap();
    }
  }

  // ── colorbar canvas rendering ────────────────────────────────────────────────
  //
  // Layout (left → right):
  //   [HIST_W px: horizontal histogram bars]
  //   [STRIP_W px: vertical colour gradient]
  //   [HANDLE_AREA px: triangular drag handles]
  //
  // Vertical axis: y=0 → clipMax (top), y=CB_H → clipMin (bottom)

  private drawColorbar(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const W = this.CANVAS_W;
    ctx.clearRect(0, 0, W, CB_H);

    const palette = PALETTES.find(p => p.id === this.selectedPaletteId) ?? PALETTES[0];

    // ① Colour gradient strip
    for (let y = 0; y < CB_H; y++) {
      // t=1 (top) → max palette colour; t=0 (bottom) → min palette colour
      const tRaw = 1 - y / (CB_H - 1);
      const t    = this.reversed ? 1 - tRaw : tRaw;
      const rgb  = lerpRGB(palette.stops, t);
      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      ctx.fillRect(HIST_W, y, STRIP_W, 1);
    }

    // ② Clip overlay: darken the out-of-range areas
    const dRange = this.dataMax() - this.dataMin() || 1;
    const maxFrac = (this.clipMax() - this.dataMin()) / dRange;   // 0..1
    const minFrac = (this.clipMin() - this.dataMin()) / dRange;   // 0..1
    const maxY   = Math.round((1 - maxFrac) * CB_H);
    const minY   = Math.round((1 - minFrac) * CB_H);

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(HIST_W, 0,    STRIP_W, maxY);          // above max clip
    ctx.fillRect(HIST_W, minY, STRIP_W, CB_H - minY);   // below min clip

    // ③ Dashed clip lines across the strip
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1;

    ctx.strokeStyle = '#f38ba8';
    ctx.beginPath();
    ctx.moveTo(HIST_W, maxY); ctx.lineTo(HIST_W + STRIP_W, maxY);
    ctx.stroke();

    ctx.strokeStyle = '#89b4fa';
    ctx.beginPath();
    ctx.moveTo(HIST_W, minY); ctx.lineTo(HIST_W + STRIP_W, minY);
    ctx.stroke();
    ctx.restore();

    // ④ Horizontal histogram bars
    //    bin i corresponds to value dataMin + (i/(HIST_BINS-1))*dataRange
    const binH = CB_H / HIST_BINS;
    ctx.fillStyle = 'rgba(200,215,255,0.55)';
    for (let i = 0; i < HIST_BINS; i++) {
      const barLen = this.histBins[i] * HIST_W;
      // bin 0 → bottom, bin HIST_BINS-1 → top
      const y = CB_H - (i + 1) * binH;
      ctx.fillRect(HIST_W - barLen, y, barLen, binH - 0.5);
    }

    // ⑤ Handle triangles (pointing left, sitting on right edge of strip)
    this.drawHandle(ctx, HIST_W + STRIP_W, maxY, '#f38ba8'); // max handle
    this.drawHandle(ctx, HIST_W + STRIP_W, minY, '#89b4fa'); // min handle
  }

  private drawHandle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
  ): void {
    const S = 7;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + S * 1.4, y - S);
    ctx.lineTo(x + S * 1.4, y + S);
    ctx.closePath();
    ctx.fill();
  }

  // ── canvas drag logic ────────────────────────────────────────────────────────

  onCanvasDown(e: MouseEvent): void {
    const y      = e.offsetY;
    const dRange = this.dataMax() - this.dataMin() || 1;
    const maxY   = Math.round((1 - (this.clipMax() - this.dataMin()) / dRange) * CB_H);
    const minY   = Math.round((1 - (this.clipMin() - this.dataMin()) / dRange) * CB_H);
    const TOL    = 12;

    if (Math.abs(y - maxY) < TOL) {
      this.dragging = 'max';
    } else if (Math.abs(y - minY) < TOL) {
      this.dragging = 'min';
    }

    if (this.dragging) {
      window.addEventListener('mousemove', this.onWindowMove);
      window.addEventListener('mouseup',   this.boundMouseUp);
    }
  }

  onCanvasMoveLocal(e: MouseEvent): void {
    if (this.dragging) this.applyDrag(e.offsetY);
  }

  @HostListener('document:mouseup')
  onDocumentMouseUp(): void {
    if (!this.dragging) return;
    this.dragging = null;
    window.removeEventListener('mousemove', this.onWindowMove);
    window.removeEventListener('mouseup',   this.boundMouseUp);
  }

  private applyDrag(offsetY: number): void {
    const t       = 1 - Math.max(0, Math.min(1, offsetY / CB_H));
    const dRange  = this.dataMax() - this.dataMin();
    const value   = this.dataMin() + t * dRange;

    if (this.dragging === 'max' && value > this.clipMin()) {
      this.clipMax.set(value);
      this.applyColormap();
    } else if (this.dragging === 'min' && value < this.clipMax()) {
      this.clipMin.set(value);
      this.applyColormap();
    }
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function colRange(n: number): string[] {
  return Array.from({ length: n }, (_, i) => String(i));
}
