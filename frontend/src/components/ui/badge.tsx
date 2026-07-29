import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/utils/cn';
import type {
  ChallanStatus,
  CustomerStatus,
  FollowUpStatus,
  MovementType,
  StockStatus,
} from '@/types/api.types';

/**
 * Badge.
 *
 * The "soft" variants (tinted background, saturated text) are used for status
 * pills. A grid of solid, fully saturated badges turns a data table into a
 * traffic light — the tinted treatment stays legible at a glance without
 * competing with the data.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'border-border text-foreground',

        /* Soft/tinted — the default for status indicators. */
        'soft-neutral': 'border-transparent bg-muted text-muted-foreground',
        'soft-primary': 'border-transparent bg-primary/10 text-primary',
        'soft-success': 'border-transparent bg-success/12 text-success',
        'soft-warning': 'border-transparent bg-warning/14 text-warning',
        'soft-danger': 'border-transparent bg-destructive/12 text-destructive',
        'soft-info': 'border-transparent bg-info/12 text-info',
      },
    },
    defaultVariants: { variant: 'soft-neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = ({ className, variant, ...props }: BadgeProps): React.JSX.Element => (
  <span className={cn(badgeVariants({ variant }), className)} {...props} />
);

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

/**
 * Status -> variant maps.
 *
 * Defined once here so a CONFIRMED challan is the same green everywhere. The
 * `satisfies Record<...>` makes adding a new enum member a compile error until
 * its colour is chosen deliberately.
 */
const CHALLAN_STATUS_VARIANT = {
  DRAFT: 'soft-neutral',
  CONFIRMED: 'soft-success',
  CANCELLED: 'soft-danger',
} satisfies Record<ChallanStatus, BadgeVariant>;

const CUSTOMER_STATUS_VARIANT = {
  LEAD: 'soft-info',
  ACTIVE: 'soft-success',
  INACTIVE: 'soft-neutral',
  BLACKLISTED: 'soft-danger',
} satisfies Record<CustomerStatus, BadgeVariant>;

const STOCK_STATUS_VARIANT = {
  IN_STOCK: 'soft-success',
  LOW_STOCK: 'soft-warning',
  OUT_OF_STOCK: 'soft-danger',
} satisfies Record<StockStatus, BadgeVariant>;

const FOLLOW_UP_STATUS_VARIANT = {
  PENDING: 'soft-info',
  COMPLETED: 'soft-success',
  OVERDUE: 'soft-warning',
  CANCELLED: 'soft-neutral',
} satisfies Record<FollowUpStatus, BadgeVariant>;

const MOVEMENT_TYPE_VARIANT = {
  IN: 'soft-success',
  OUT: 'soft-danger',
  ADJUSTMENT: 'soft-info',
  RETURN: 'soft-primary',
  DAMAGE: 'soft-warning',
} satisfies Record<MovementType, BadgeVariant>;

export const statusVariant = {
  challan: (status: ChallanStatus): BadgeVariant => CHALLAN_STATUS_VARIANT[status],
  customer: (status: CustomerStatus): BadgeVariant => CUSTOMER_STATUS_VARIANT[status],
  stock: (status: StockStatus): BadgeVariant => STOCK_STATUS_VARIANT[status],
  followUp: (status: FollowUpStatus): BadgeVariant => FOLLOW_UP_STATUS_VARIANT[status],
  movement: (type: MovementType): BadgeVariant => MOVEMENT_TYPE_VARIANT[type],
};

export { Badge, badgeVariants };
