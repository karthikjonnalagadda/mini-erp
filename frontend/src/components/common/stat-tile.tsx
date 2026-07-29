/**
 * Stat tile.
 *
 * The right form when the story is ONE number. A one-bar bar chart or a
 * two-slice pie says less than the figure itself; these tiles carry the
 * headline metrics and leave the charts for change-over-time and comparison.
 *
 * Figures use PROPORTIONAL digits, not `tabular-nums`: equal-width digits make
 * a large standalone number look loosely spaced. Tabular figures are reserved
 * for table columns that must align vertically.
 */
import * as React from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/utils/cn';
import { formatPercent } from '@/utils/format';

export type StatIntent = 'neutral' | 'positive' | 'warning' | 'danger';

export interface StatTileProps {
  label: string;
  value: string;
  /** Percentage change vs. the previous period. `null` when there is no baseline. */
  changePercent?: number | null;
  /** What the change is measured against, e.g. "vs previous 30 days". */
  changeLabel?: string;
  icon?: React.ComponentType<{ className?: string }>;
  intent?: StatIntent;
  /** Inverts delta colouring where a rise is bad (e.g. out-of-stock count). */
  invertDelta?: boolean;
  className?: string;
}

const ICON_INTENT: Record<StatIntent, string> = {
  neutral: 'bg-muted text-muted-foreground',
  positive: 'bg-success/12 text-success',
  warning: 'bg-warning/14 text-warning',
  danger: 'bg-destructive/12 text-destructive',
};

export const StatTile = ({
  label,
  value,
  changePercent,
  changeLabel = 'vs previous period',
  icon: Icon,
  intent = 'neutral',
  invertDelta = false,
  className,
}: StatTileProps): React.JSX.Element => {
  const hasDelta = changePercent !== null && changePercent !== undefined;
  const isFlat = hasDelta && Math.abs(changePercent) < 0.05;
  const isUp = hasDelta && changePercent > 0;

  // "Good" is not always "up": rising out-of-stock counts are bad.
  const isGood = invertDelta ? !isUp : isUp;

  const DeltaIcon = isFlat ? Minus : isUp ? TrendingUp : TrendingDown;

  return (
    <Card className={cn('transition-shadow hover:shadow-card-hover', className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
          </div>

          {Icon && (
            <span
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg',
                ICON_INTENT[intent],
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </span>
          )}
        </div>

        {hasDelta && (
          <div className="mt-3 flex items-center gap-1.5 text-xs">
            {/* The arrow is the redundant cue: direction never rests on colour
                alone, which is what keeps this readable under CVD. */}
            <DeltaIcon
              className={cn(
                'size-3.5',
                isFlat ? 'text-muted-foreground' : isGood ? 'text-success' : 'text-destructive',
              )}
              aria-hidden="true"
            />
            <span
              className={cn(
                'font-medium tabular-nums',
                isFlat ? 'text-muted-foreground' : isGood ? 'text-success' : 'text-destructive',
              )}
            >
              {formatPercent(Math.abs(changePercent))}
            </span>
            <span className="truncate text-muted-foreground">{changeLabel}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export interface StatChipProps {
  label: string;
  value: number | string;
  intent?: StatIntent;
}

/**
 * Compact status counter.
 *
 * Used where a distribution has only three or four members — challans by
 * status, customers by stage. A pie chart of three slices communicates less
 * than the three numbers side by side, and costs a colour scale to do it.
 */
export const StatChip = ({ label, value, intent = 'neutral' }: StatChipProps): React.JSX.Element => {
  const dotClass: Record<StatIntent, string> = {
    neutral: 'bg-muted-foreground/50',
    positive: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-destructive',
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn('size-1.5 shrink-0 rounded-full', dotClass[intent])} aria-hidden="true" />
        <span className="truncate text-xs text-muted-foreground">{label}</span>
      </span>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
};
