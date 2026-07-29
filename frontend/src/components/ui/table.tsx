/**
 * Data table primitives.
 *
 * Semantic `<table>` markup, not a grid of divs: screen readers announce row
 * and column position, and users can select and copy a column. The horizontal
 * scroll wrapper keeps wide tables usable on a phone without the page itself
 * scrolling sideways.
 */
import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { cn } from '@/utils/cn';

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-x-auto">
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  ),
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Adds pointer affordance for rows that navigate on click. */
  clickable?: boolean;
}

const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, clickable = false, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b border-border transition-colors hover:bg-muted/45 data-[state=selected]:bg-muted',
        clickable && 'cursor-pointer',
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn('px-3 py-2.5 align-middle', className)} {...props} />
));
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

export interface SortableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Column key sent to the API as `sortBy`. */
  field: string;
  activeField?: string | undefined;
  direction?: 'asc' | 'desc' | undefined;
  onSort: (field: string) => void;
  align?: 'left' | 'right';
}

/**
 * Sortable column header.
 *
 * `aria-sort` is set so assistive technology announces the current sort state —
 * a chevron icon alone is invisible to a screen reader.
 */
const SortableHead = ({
  field,
  activeField,
  direction,
  onSort,
  align = 'left',
  className,
  children,
  ...props
}: SortableHeadProps): React.JSX.Element => {
  const isActive = activeField === field;
  const Icon = !isActive ? ChevronsUpDown : direction === 'asc' ? ArrowUp : ArrowDown;

  return (
    <TableHead
      aria-sort={isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('p-0', className)}
      {...props}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          'flex h-10 w-full items-center gap-1.5 px-3 text-xs font-semibold uppercase tracking-wide transition-colors hover:text-foreground',
          isActive ? 'text-foreground' : 'text-muted-foreground',
          align === 'right' && 'justify-end',
        )}
      >
        <span>{children}</span>
        <Icon className={cn('size-3.5', isActive ? 'opacity-100' : 'opacity-40')} aria-hidden="true" />
      </button>
    </TableHead>
  );
};

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  SortableHead,
};
