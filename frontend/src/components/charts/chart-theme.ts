/**
 * Chart colour system.
 *
 * These are NOT arbitrary picks. The categorical slots below were run through a
 * palette validator against this application's actual chart surfaces (white in
 * light mode, `hsl(222 44% 12%)` in dark) and clear every gate:
 *
 *   light  — lightness band PASS, chroma floor PASS,
 *            worst adjacent CVD ΔE 9.1 (protan), normal-vision ΔE 22.9,
 *            contrast WARN on aqua (2.82:1) and yellow (2.17:1)
 *   dark   — all checks PASS, worst adjacent CVD ΔE 8.4, contrast all ≥ 3:1
 *
 * The light-mode contrast warning carries an obligation, met throughout these
 * charts: every series is identified by a legend AND a direct label or axis
 * label, never by colour alone. That is also why the dark values are a separate
 * *selected* set rather than a programmatic lightening — a colour that passes on
 * white does not automatically pass on near-black.
 *
 * Slot order is fixed and assigned by entity, never by rank. Filtering a series
 * out must not repaint the survivors: a reader who learned "inbound is blue"
 * would otherwise be misled.
 */

export interface ChartPalette {
  /** Categorical slots, in fixed assignment order. */
  series: readonly [string, string, string, string];
  /** Chart chrome. Recessive by design — the data is the figure, not the grid. */
  grid: string;
  axis: string;
  tick: string;
  surface: string;
  tooltipBg: string;
  tooltipBorder: string;
  text: string;
  textMuted: string;
}

const LIGHT: ChartPalette = {
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'],
  grid: '#e2e8f0',
  axis: '#cbd5e1',
  tick: '#64748b',
  surface: '#ffffff',
  tooltipBg: '#ffffff',
  tooltipBorder: '#e2e8f0',
  text: '#0f172a',
  textMuted: '#64748b',
};

const DARK: ChartPalette = {
  series: ['#3987e5', '#d95926', '#199e70', '#c98500'],
  grid: '#1e293b',
  axis: '#334155',
  tick: '#94a3b8',
  surface: '#111928',
  tooltipBg: '#111928',
  tooltipBorder: '#1e293b',
  text: '#f1f5f9',
  textMuted: '#94a3b8',
};

export const chartPalette = (mode: 'light' | 'dark'): ChartPalette =>
  mode === 'dark' ? DARK : LIGHT;

/**
 * Shared axis/grid props.
 *
 * Gridlines are SOLID hairlines one shade off the surface — never dashed.
 * Dashing reads as "projection" or "threshold" when it is only a grid.
 * The y-grid is drawn and the x-grid suppressed: horizontal rules help compare
 * magnitudes; vertical ones only add noise on a time axis.
 */
export const axisDefaults = (palette: ChartPalette) => ({
  stroke: palette.axis,
  tick: { fill: palette.tick, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: palette.axis },
});

export const gridDefaults = (palette: ChartPalette) => ({
  stroke: palette.grid,
  strokeWidth: 1,
  vertical: false,
});

/** Tooltip container styling, matched to the app's popover surface. */
export const tooltipDefaults = (palette: ChartPalette) => ({
  contentStyle: {
    backgroundColor: palette.tooltipBg,
    border: `1px solid ${palette.tooltipBorder}`,
    borderRadius: '0.5rem',
    fontSize: '0.75rem',
    padding: '0.5rem 0.75rem',
    boxShadow: '0 10px 30px -8px rgb(15 23 42 / 0.18)',
  },
  labelStyle: { color: palette.text, fontWeight: 600, marginBottom: '0.25rem' },
  itemStyle: { color: palette.textMuted, padding: 0 },
  // Hover highlight must not obscure the mark it is describing.
  cursor: { fill: palette.grid, fillOpacity: 0.35 },
});

/** Mark geometry constants — thin marks, rounded data-ends, 2px separation. */
export const MARK = {
  /** Line stroke. 2px reads clearly without becoming a block. */
  lineWidth: 2,
  /** Minimum interactive marker size; hover targets are larger still. */
  dotRadius: 4,
  activeDotRadius: 5,
  /** Rounded top corners on bars, anchored to the baseline. */
  barRadius: [4, 4, 0, 0] as [number, number, number, number],
  /** Surface gap between adjacent bars in a group — a gap, not a border. */
  barGap: 2,
  barCategoryGap: '28%',
} as const;
