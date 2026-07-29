/**
 * Confirmation dialog.
 *
 * Two behaviours worth noting:
 *
 *  1. `requireReason` turns the dialog into a small form. Cancelling a challan
 *     is a financial correction and the API requires a reason — collecting it
 *     here keeps the caller from needing a bespoke dialog.
 *
 *  2. The confirm button is disabled while the action is in flight. Confirming a
 *     challan twice would attempt to deduct stock twice; the second call is
 *     rejected server-side, but not offering the click at all is better UX than
 *     explaining the rejection.
 */
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/input';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  isLoading?: boolean;
  /** Collects a mandatory free-text reason and passes it to `onConfirm`. */
  requireReason?: boolean;
  reasonLabel?: string;
  /**
   * Return value is ignored. Typed as `unknown` so a call site can be the
   * concise `() => mutation.mutate(id)` — `mutate` returns void, but guarded
   * forms like `() => target && mutation.mutate(target.id)` widen the type.
   */
  onConfirm: (reason?: string) => unknown;
}

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  isLoading = false,
  requireReason = false,
  reasonLabel = 'Reason',
  onConfirm,
}: ConfirmDialogProps): React.JSX.Element => {
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);

  // Reset when the dialog reopens, so a previous attempt's text does not
  // reappear pre-filled.
  React.useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);

  const reasonError =
    requireReason && touched && reason.trim().length === 0 ? `${reasonLabel} is required` : undefined;

  const handleConfirm = (): void => {
    if (requireReason) {
      setTouched(true);
      if (reason.trim().length === 0) return;
    }
    void onConfirm(requireReason ? reason.trim() : undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>

        {requireReason && (
          <DialogBody>
            <FormField label={reasonLabel} htmlFor="confirm-reason" required error={reasonError}>
              <Textarea
                id="confirm-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="This is recorded on the document and in the audit trail."
                rows={3}
                hasError={Boolean(reasonError)}
                autoFocus
              />
            </FormField>
          </DialogBody>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={handleConfirm}
            loading={isLoading}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
