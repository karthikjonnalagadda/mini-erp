/**
 * Page header.
 *
 * Consistent title / description / action arrangement across every screen, with
 * responsive behaviour handled once: actions stack under the title on mobile and
 * sit inline from `sm` upward.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/utils/cn';

export interface Breadcrumb {
  label: string;
  /** Omit on the final crumb — the current page is not a link to itself. */
  to?: string;
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: Breadcrumb[];
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader = ({
  title,
  description,
  breadcrumbs,
  actions,
  className,
}: PageHeaderProps): React.JSX.Element => (
  <div className={cn('mb-5 space-y-3', className)}>
    {breadcrumbs && breadcrumbs.length > 0 && (
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {breadcrumbs.map((crumb, index) => (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {index > 0 && <ChevronRight className="size-3" aria-hidden="true" />}
              {crumb.to ? (
                <Link to={crumb.to} className="transition-colors hover:text-foreground">
                  {crumb.label}
                </Link>
              ) : (
                <span className="font-medium text-foreground" aria-current="page">
                  {crumb.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    )}

    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>

      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  </div>
);
