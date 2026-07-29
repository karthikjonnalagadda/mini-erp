import * as React from 'react';

import { cn } from '@/utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Renders the invalid state and wires `aria-invalid` for screen readers. */
  hasError?: boolean;
}

/**
 * Text input.
 *
 * `text-base` on mobile (not `text-sm`) is deliberate: iOS Safari zooms the
 * viewport when a focused input has a font size below 16px, which is jarring
 * mid-form. The smaller size is applied from `md:` upward.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', hasError = false, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      aria-invalid={hasError || undefined}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-base shadow-sm transition-colors md:text-sm',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        hasError && 'border-destructive focus-visible:ring-destructive',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, hasError = false, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={hasError || undefined}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-sm transition-colors md:text-sm',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        hasError && 'border-destructive focus-visible:ring-destructive',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Input, Textarea };
