/**
 * Form field wrapper.
 *
 * Bundles label + control + help text + error message with the ARIA wiring that
 * is easy to forget and invisible when missing:
 *   - `htmlFor`/`id` pairing so clicking the label focuses the control,
 *   - `aria-describedby` pointing at the help/error text,
 *   - `role="alert"` on the error so screen readers announce it on appearance.
 *
 * Consumers pass the control as a child and spread the ids we generate, which
 * keeps this component agnostic of react-hook-form.
 */
import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { AlertCircle } from 'lucide-react';

import { cn } from '@/utils/cn';

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(({ className, required = false, children, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
      className,
    )}
    {...props}
  >
    {children}
    {required && (
      <span className="ml-0.5 text-destructive" aria-hidden="true">
        *
      </span>
    )}
  </LabelPrimitive.Root>
));
Label.displayName = 'Label';

export interface FormFieldProps {
  label: string;
  /** Stable id; the control receives `id`, the messages receive derived ids. */
  htmlFor: string;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

const FormField = ({
  label,
  htmlFor,
  error,
  hint,
  required = false,
  className,
  children,
}: FormFieldProps): React.JSX.Element => {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>

      {children}

      {/* Hint is hidden once an error is present — showing both is noise at the
          moment the user most needs a single clear instruction. */}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}

      {error && (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1 text-xs font-medium text-destructive"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
};

/**
 * Builds the aria props for a control inside a FormField.
 * Used as `{...fieldAria('email', errors.email?.message, 'We never share this')}`.
 */
export const fieldAria = (
  htmlFor: string,
  error?: string,
  hint?: string,
): { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true } => {
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;

  return {
    id: htmlFor,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(error ? { 'aria-invalid': true as const } : {}),
  };
};

export { FormField, Label };
