/**
 * Toast state.
 *
 * A small reducer store rather than Context alone, so that `toast()` can be
 * called from anywhere — including a React Query `onError` handler or an Axios
 * interceptor, neither of which sits inside a component and therefore cannot
 * call a hook.
 */
import * as React from 'react';

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastIcon,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast';
import type { ToastActionElement, ToastProps } from '@/components/ui/toast';
import { ApiRequestError } from '@/api/client';

/** Cap on simultaneously visible toasts — more than three is a wall of noise. */
const TOAST_LIMIT = 3;
const DEFAULT_DURATION_MS = 5_000;
/** Errors stay longer: the user may need to read a stock shortage list. */
const ERROR_DURATION_MS = 8_000;

/**
 * `title` is omitted from ToastProps before being redeclared: the underlying
 * element carries the HTML `title` attribute (a string), and we need a
 * ReactNode so a toast can render an icon or emphasis inside its heading.
 */
type ToasterToast = Omit<ToastProps, 'title'> & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
};

type Action =
  | { type: 'ADD'; toast: ToasterToast }
  | { type: 'DISMISS'; id?: string }
  | { type: 'REMOVE'; id?: string };

interface State {
  toasts: ToasterToast[];
}

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'ADD':
      return { toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT) };

    case 'DISMISS':
      // Sets `open: false` so Radix runs the exit animation; REMOVE follows.
      return {
        toasts: state.toasts.map((toast) =>
          action.id === undefined || toast.id === action.id ? { ...toast, open: false } : toast,
        ),
      };

    case 'REMOVE':
      return {
        toasts: action.id === undefined ? [] : state.toasts.filter((toast) => toast.id !== action.id),
      };

    default:
      return state;
  }
};

// Module-level store so `toast()` works outside the React tree.
let memoryState: State = { toasts: [] };
const listeners: Array<(state: State) => void> = [];

const dispatch = (action: Action): void => {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => listener(memoryState));
};

let counter = 0;
const nextId = (): string => {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return counter.toString();
};

export interface ToastOptions {
  title: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastProps['variant'];
  duration?: number;
  action?: ToastActionElement;
}

export const toast = ({ duration, ...options }: ToastOptions): { id: string; dismiss: () => void } => {
  const id = nextId();

  dispatch({
    type: 'ADD',
    toast: {
      ...options,
      id,
      open: true,
      duration: duration ?? (options.variant === 'destructive' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS),
      onOpenChange: (open) => {
        if (!open) dispatch({ type: 'REMOVE', id });
      },
    },
  });

  return { id, dismiss: () => dispatch({ type: 'DISMISS', id }) };
};

/** Convenience wrappers so call sites read as intent, not configuration. */
toast.success = (title: React.ReactNode, description?: React.ReactNode) =>
  toast({ title, description, variant: 'success' });

toast.error = (title: React.ReactNode, description?: React.ReactNode) =>
  toast({ title, description, variant: 'destructive' });

toast.warning = (title: React.ReactNode, description?: React.ReactNode) =>
  toast({ title, description, variant: 'warning' });

toast.info = (title: React.ReactNode, description?: React.ReactNode) =>
  toast({ title, description, variant: 'info' });

/**
 * Renders an API failure as a toast.
 *
 * Validation errors (422) are deliberately NOT toasted: they belong inline on
 * the offending field, and a toast saying "validation failed" while the field
 * already shows the reason is redundant noise. Everything else gets a toast.
 */
export const toastApiError = (error: unknown, fallbackTitle = 'Request failed'): void => {
  if (error instanceof ApiRequestError) {
    if (error.code === 'VALIDATION_ERROR') return;

    // Stock shortages carry structured detail worth surfacing verbatim.
    if (error.code === 'INSUFFICIENT_STOCK') {
      toast.error('Insufficient stock', error.message);
      return;
    }

    toast.error(
      error.status >= 500 ? 'Server error' : fallbackTitle,
      error.requestId ? `${error.message} (ref: ${error.requestId})` : error.message,
    );
    return;
  }

  toast.error(fallbackTitle, error instanceof Error ? error.message : undefined);
};

export const useToast = (): State & { dismiss: (id?: string) => void } => {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  return { ...state, dismiss: (id?: string) => dispatch({ type: 'DISMISS', id }) };
};

/** Mounted once near the root of the app. */
export const Toaster = (): React.JSX.Element => {
  const { toasts } = useToast();

  return (
    <ToastProvider swipeDirection="right">
      {toasts.map(({ id, title, description, action, variant, ...props }) => (
        <Toast key={id} variant={variant} {...props}>
          <ToastIcon variant={variant} />
          <div className="flex-1 space-y-1">
            {title && <ToastTitle>{title}</ToastTitle>}
            {description && <ToastDescription>{description}</ToastDescription>}
          </div>
          {action}
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
};
