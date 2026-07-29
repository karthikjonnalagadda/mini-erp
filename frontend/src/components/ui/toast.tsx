/**
 * Toast notifications.
 *
 * Built on Radix Toast for the accessibility behaviour that matters: an ARIA
 * live region so screen readers announce the message, swipe-to-dismiss, and a
 * timer that pauses when the window loses focus (so a toast is not missed while
 * the user is in another tab).
 *
 * The `useToast` hook and provider live in `hooks/use-toast.tsx`; this file is
 * presentation only.
 */
import * as React from 'react';
import * as ToastPrimitives from '@radix-ui/react-toast';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

import { cn } from '@/utils/cn';

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      // Bottom on mobile (thumb reach, clear of the header), top-right on
      // desktop where it will not cover a form the user is filling in.
      'fixed bottom-0 left-1/2 z-[100] flex max-h-screen w-full -translate-x-1/2 flex-col-reverse gap-2 p-4 sm:bottom-auto sm:left-auto sm:right-0 sm:top-0 sm:translate-x-0 sm:flex-col md:max-w-[26rem]',
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-lg border p-4 pr-8 shadow-popover transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:slide-in-from-top-full data-[state=closed]:slide-out-to-right-full sm:data-[state=open]:slide-in-from-bottom-full',
  {
    variants: {
      variant: {
        default: 'border-border bg-card text-card-foreground',
        success: 'border-success/25 bg-success/8 text-foreground',
        destructive: 'border-destructive/25 bg-destructive/8 text-foreground',
        warning: 'border-warning/25 bg-warning/8 text-foreground',
        info: 'border-info/25 bg-info/8 text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> & VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => (
  <ToastPrimitives.Root ref={ref} className={cn(toastVariants({ variant }), className)} {...props} />
));
Toast.displayName = ToastPrimitives.Root.displayName;

/** Icon paired with each variant — colour alone must not carry the meaning. */
export const ToastIcon = ({
  variant,
}: {
  variant: VariantProps<typeof toastVariants>['variant'];
}): React.JSX.Element => {
  const config = {
    success: { Icon: CheckCircle2, className: 'text-success' },
    destructive: { Icon: XCircle, className: 'text-destructive' },
    warning: { Icon: AlertTriangle, className: 'text-warning' },
    info: { Icon: Info, className: 'text-info' },
    default: { Icon: Info, className: 'text-muted-foreground' },
  }[variant ?? 'default'];

  return <config.Icon className={cn('mt-0.5 size-4 shrink-0', config.className)} aria-hidden="true" />;
};

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      'inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-border bg-transparent px-3 text-xs font-medium transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring',
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      'absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring group-hover:opacity-100',
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="size-4" aria-hidden="true" />
    <span className="sr-only">Dismiss</span>
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title ref={ref} className={cn('text-sm font-semibold', className)} {...props} />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

export type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;
export type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
  toastVariants,
};
