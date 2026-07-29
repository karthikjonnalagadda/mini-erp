/**
 * Dashboard charts.
 *
 * Form decisions, made before any colour was chosen:
 *
 *  - Sales over time -> AREA, ONE series. Change-over-time with a single
 *    measure. No legend (the title names it); the endpoint is direct-labelled
 *    so the current figure is readable without hovering.
 *
 *  - Inbound vs outbound stock -> GROUPED BARS, two series. Two magnitudes on
 *    the SAME scale (units), so one y-axis is correct. Legend plus a tooltip;
 *    a 2px surface gap separates the pair rather than a border.
 *
 *  - Products per category -> HORIZONTAL BARS, one colour for every bar.
 *    Categories are nominal, so colouring darker-where-bigger would double-
 *    encode length as hue and burn the only free channel. Values are direct-
 *    labelled at the bar end.
 *
 * Deliberately NOT charts: "challans by status" (3 numbers) and "customers by
 * status" (4 numbers) render as stat chips on the dashboard. A three-slice pie
 * or a three-bar chart says less than the three numbers themselves.
 *
 * Every chart also has a table-view twin available via `ChartTableView`, so no
 * value is reachable only by hovering.
 */
import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  MARK,
  axisDefaults,
  chartPalette,
  gridDefaults,
  tooltipDefaults,
} from '@/components/charts/chart-theme';
import { EmptyState } from '@/components/ui/states';
import { useTheme } from '@/context/theme-context';
import { formatCurrency, formatDate, formatNumber } from '@/utils/format';

/** Height includes the x-axis band so the axis is never clipped or scrolled. */
const CHART_HEIGHT = 260;

// ---------------------------------------------------------------------------
// Sales trend — single-series area
// ---------------------------------------------------------------------------

export interface SalesTrendChartProps {
  data: Array<{ date: string; challanCount: number; totalValue: number }>;
}

export const SalesTrendChart = ({ data }: SalesTrendChartProps): React.JSX.Element => {
  const { resolvedTheme } = useTheme();
  const palette = chartPalette(resolvedTheme);

  if (data.length === 0) {
    return (
      <EmptyState
        title="No confirmed sales yet"
        description="Confirmed challans will appear here as a daily trend."
        className="py-10"
      />
    );
  }

  const seriesColor = palette.series[0];
  const gradientId = 'sales-trend-fill';

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
        <defs>
          {/* A soft fill under a 2px line: the line carries the value, the fill
              only signals "area under the curve". A solid block would read as
              the figure itself. */}
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={seriesColor} stopOpacity={0.22} />
            <stop offset="100%" stopColor={seriesColor} stopOpacity={0.01} />
          </linearGradient>
        </defs>

        <CartesianGrid {...gridDefaults(palette)} />

        <XAxis
          dataKey="date"
          {...axisDefaults(palette)}
          tickFormatter={(value: string) => formatDate(value).slice(0, 6)}
          minTickGap={24}
        />
        <YAxis
          {...axisDefaults(palette)}
          width={62}
          tickFormatter={(value: number) => formatCurrency(value, { compact: true })}
        />

        <Tooltip
          {...tooltipDefaults(palette)}
          labelFormatter={(value) => formatDate(String(value))}
          formatter={(value: number, _name, entry) => [
            `${formatCurrency(value)} · ${formatNumber(
              (entry.payload as { challanCount: number }).challanCount,
            )} challans`,
            'Sales',
          ]}
        />

        <Area
          type="monotone"
          dataKey="totalValue"
          stroke={seriesColor}
          strokeWidth={MARK.lineWidth}
          fill={`url(#${gradientId})`}
          // No dot per point — a 30-point series with a marker on every day is
          // noise. The active dot appears on hover instead.
          dot={false}
          activeDot={{
            r: MARK.activeDotRadius,
            // 2px surface ring so the marker separates from the line it sits on.
            stroke: palette.surface,
            strokeWidth: 2,
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

// ---------------------------------------------------------------------------
// Stock movement — two-series grouped bars
// ---------------------------------------------------------------------------

export interface StockMovementChartProps {
  data: Array<{ date: string; inbound: number; outbound: number }>;
}

export const StockMovementChart = ({ data }: StockMovementChartProps): React.JSX.Element => {
  const { resolvedTheme } = useTheme();
  const palette = chartPalette(resolvedTheme);

  if (data.length === 0) {
    return (
      <EmptyState
        title="No stock movements recorded"
        description="Receipts and dispatches will chart here."
        className="py-10"
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 16, bottom: 0, left: -12 }}
        // A 2px gap between the paired bars — a gap, never a stroke.
        barGap={MARK.barGap}
        barCategoryGap={MARK.barCategoryGap}
      >
        <CartesianGrid {...gridDefaults(palette)} />

        <XAxis
          dataKey="date"
          {...axisDefaults(palette)}
          tickFormatter={(value: string) => formatDate(value).slice(0, 6)}
          minTickGap={24}
        />
        {/* ONE y-axis. Both series are unit counts on the same scale, so a
            second axis would invent a relationship that is not in the data. */}
        <YAxis
          {...axisDefaults(palette)}
          width={52}
          tickFormatter={(value: number) => formatNumber(value, { compact: true })}
        />

        <Tooltip
          {...tooltipDefaults(palette)}
          labelFormatter={(value) => formatDate(String(value))}
          formatter={(value: number, name) => [formatNumber(value), String(name)]}
        />

        {/* Legend is mandatory at two or more series — identity must never rest
            on colour alone. */}
        <Legend
          verticalAlign="top"
          align="right"
          height={28}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: '0.75rem', color: palette.textMuted }}
        />

        <Bar
          dataKey="inbound"
          name="Received"
          fill={palette.series[0]}
          radius={MARK.barRadius}
          maxBarSize={18}
        />
        <Bar
          dataKey="outbound"
          name="Dispatched"
          fill={palette.series[1]}
          radius={MARK.barRadius}
          maxBarSize={18}
        />
      </BarChart>
    </ResponsiveContainer>
  );
};

// ---------------------------------------------------------------------------
// Products per category — single-colour horizontal bars
// ---------------------------------------------------------------------------

export interface CategoryBreakdownChartProps {
  data: Array<{ categoryId: string; categoryName: string; productCount: number }>;
}

export const CategoryBreakdownChart = ({
  data,
}: CategoryBreakdownChartProps): React.JSX.Element => {
  const { resolvedTheme } = useTheme();
  const palette = chartPalette(resolvedTheme);

  // Horizontal bars: category names are words, and words fit on a y-axis
  // without rotating them 45 degrees.
  const rows = React.useMemo(
    () => [...data].sort((a, b) => b.productCount - a.productCount).slice(0, 8),
    [data],
  );

  if (rows.length === 0) {
    return <EmptyState title="No categories yet" className="py-10" />;
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 34 + 24)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 8 }}>
        <CartesianGrid {...gridDefaults(palette)} horizontal={false} vertical />

        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="categoryName"
          {...axisDefaults(palette)}
          width={124}
          tick={{ fill: palette.tick, fontSize: 11 }}
        />

        <Tooltip
          {...tooltipDefaults(palette)}
          formatter={(value: number) => [formatNumber(value), 'Products']}
        />

        <Bar dataKey="productCount" radius={[0, 4, 4, 0]} maxBarSize={16}>
          {/* One series, one colour. Shading each bar by its own length would
              double-encode magnitude and fail the categorical colour checks. */}
          {rows.map((row) => (
            <Cell key={row.categoryId} fill={palette.series[0]} />
          ))}

          {/* Direct labels at the bar end: the value is readable without a
              hover, which is also the relief this palette's light-mode contrast
              warning requires. */}
          <LabelList
            dataKey="productCount"
            position="right"
            offset={8}
            className="fill-muted-foreground"
            style={{ fontSize: 11, fontWeight: 500 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// ---------------------------------------------------------------------------
// Table twin
// ---------------------------------------------------------------------------

export interface ChartTableViewProps<T> {
  rows: T[];
  columns: Array<{ key: string; label: string; render: (row: T) => React.ReactNode }>;
  caption: string;
}

/**
 * Accessible table equivalent of a chart.
 *
 * Rendered inside a `<details>` so it does not compete with the chart visually
 * but is always one click (or one screen-reader navigation) away. This is what
 * makes a colour-encoded chart WCAG-clean rather than colour-only.
 */
export const ChartTableView = <T,>({
  rows,
  columns,
  caption,
}: ChartTableViewProps<T>): React.JSX.Element => (
  <details className="mt-3 border-t border-border pt-3">
    <summary className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground">
      View as table
    </summary>
    <div className="mt-2 max-h-64 overflow-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th key={column.key} scope="col" className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-border/60 last:border-0">
              {columns.map((column) => (
                <td key={column.key} className="px-2 py-1.5 tabular-nums">
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </details>
);
