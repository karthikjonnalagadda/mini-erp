/**
 * Follow-up dialog — schedules a new activity or completes an existing one.
 *
 * The two modes share a dialog because they are the same conversation with a
 * customer, one step apart: "I will call them on Thursday" and "I called them,
 * here is what happened."
 */
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiRequestError } from '@/api/client';
import { invalidateGroup, queryKeys } from '@/api/query-client';
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
import { FormField, fieldAria } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast, toastApiError } from '@/hooks/use-toast';
import { customerService } from '@/services/customer.service';
import type { FollowUp, FollowUpType } from '@/types/api.types';
import { toDateTimeInputValue } from '@/utils/format';

const FOLLOW_UP_TYPES: Array<{ value: FollowUpType; label: string }> = [
  { value: 'CALL', label: 'Phone call' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'SITE_VISIT', label: 'Site visit' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'OTHER', label: 'Other' },
];

const scheduleSchema = z.object({
  type: z.enum(['CALL', 'EMAIL', 'MEETING', 'SITE_VISIT', 'WHATSAPP', 'OTHER']),
  subject: z.string().trim().min(1, 'Subject is required').max(180),
  notes: z.union([z.string().trim().max(5000), z.literal('')]).optional(),
  scheduledAt: z
    .string()
    .min(1, 'Pick a date and time')
    // The server rejects a past date for a NEW follow-up (that is a log entry,
    // not a reminder), so catch it here rather than round-tripping a 422.
    .refine((value) => new Date(value).getTime() > Date.now(), 'Choose a future date and time'),
});

type ScheduleForm = z.infer<typeof scheduleSchema>;

const completeSchema = z.object({
  outcome: z.string().trim().min(1, 'Record what happened').max(5000),
});

type CompleteForm = z.infer<typeof completeSchema>;

/** Default: tomorrow at 10:00 — the most common real-world choice. */
const defaultScheduledAt = (): string => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  return toDateTimeInputValue(tomorrow);
};

export interface FollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName: string;
  /** Present -> completion mode. Absent -> scheduling mode. */
  completing?: FollowUp;
  isSubmitting?: boolean;
  onComplete?: (outcome: string) => void;
}

export const FollowUpDialog = ({
  open,
  onOpenChange,
  customerId,
  customerName,
  completing,
  isSubmitting = false,
  onComplete,
}: FollowUpDialogProps): React.JSX.Element => {
  const queryClient = useQueryClient();
  const isCompleteMode = completing !== undefined;

  const scheduleForm = useForm<ScheduleForm>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: { type: 'CALL', subject: '', notes: '', scheduledAt: defaultScheduledAt() },
  });

  const completeForm = useForm<CompleteForm>({
    resolver: zodResolver(completeSchema),
    defaultValues: { outcome: '' },
  });

  React.useEffect(() => {
    if (!open) return;
    scheduleForm.reset({
      type: 'CALL',
      subject: '',
      notes: '',
      scheduledAt: defaultScheduledAt(),
    });
    completeForm.reset({ outcome: '' });
    // Resetting on every `open` keeps a cancelled draft from reappearing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const createMutation = useMutation({
    mutationFn: (values: ScheduleForm) =>
      customerService.createFollowUp(customerId, {
        type: values.type,
        subject: values.subject,
        notes: values.notes && values.notes.length > 0 ? values.notes : null,
        // `datetime-local` yields a local wall-clock string; the API expects
        // ISO-8601, so convert explicitly rather than relying on coercion.
        scheduledAt: new Date(values.scheduledAt).toISOString(),
      }),

    onSuccess: async () => {
      toast.success('Follow-up scheduled', `Reminder created for ${customerName}.`);
      await invalidateGroup('customer');
      await queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail(customerId) });
      onOpenChange(false);
    },

    onError: (error: unknown) => {
      if (error instanceof ApiRequestError && error.code === 'VALIDATION_ERROR') {
        for (const fieldError of error.fieldErrors) {
          if (['type', 'subject', 'notes', 'scheduledAt'].includes(fieldError.field)) {
            scheduleForm.setError(fieldError.field as keyof ScheduleForm, {
              message: fieldError.message,
            });
          }
        }
        return;
      }
      toastApiError(error, 'Could not schedule follow-up');
    },
  });

  const type = scheduleForm.watch('type');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        {isCompleteMode ? (
          <form onSubmit={completeForm.handleSubmit((values) => onComplete?.(values.outcome))}>
            <DialogHeader>
              <DialogTitle>Complete follow-up</DialogTitle>
              <DialogDescription>{completing.subject}</DialogDescription>
            </DialogHeader>

            <DialogBody>
              <FormField
                label="Outcome"
                htmlFor="outcome"
                required
                error={completeForm.formState.errors.outcome?.message}
                hint="Recorded on the customer timeline"
              >
                <Textarea
                  {...completeForm.register('outcome')}
                  {...fieldAria(
                    'outcome',
                    completeForm.formState.errors.outcome?.message,
                    'Recorded on the customer timeline',
                  )}
                  rows={4}
                  placeholder="Discussed Q3 requirements; they will confirm quantities by Friday."
                  hasError={Boolean(completeForm.formState.errors.outcome)}
                  autoFocus
                />
              </FormField>
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                Mark completed
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={scheduleForm.handleSubmit((values) => createMutation.mutate(values))}>
            <DialogHeader>
              <DialogTitle>Schedule follow-up</DialogTitle>
              <DialogDescription>For {customerName}</DialogDescription>
            </DialogHeader>

            <DialogBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Activity type" htmlFor="type">
                  <Select
                    value={type}
                    onValueChange={(value) =>
                      scheduleForm.setValue('type', value as FollowUpType, { shouldDirty: true })
                    }
                  >
                    <SelectTrigger id="type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FOLLOW_UP_TYPES.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField
                  label="Scheduled for"
                  htmlFor="scheduledAt"
                  required
                  error={scheduleForm.formState.errors.scheduledAt?.message}
                >
                  <Input
                    {...scheduleForm.register('scheduledAt')}
                    {...fieldAria('scheduledAt', scheduleForm.formState.errors.scheduledAt?.message)}
                    type="datetime-local"
                    hasError={Boolean(scheduleForm.formState.errors.scheduledAt)}
                  />
                </FormField>
              </div>

              <FormField
                label="Subject"
                htmlFor="subject"
                required
                error={scheduleForm.formState.errors.subject?.message}
              >
                <Input
                  {...scheduleForm.register('subject')}
                  {...fieldAria('subject', scheduleForm.formState.errors.subject?.message)}
                  placeholder="Quarterly requirement discussion"
                  hasError={Boolean(scheduleForm.formState.errors.subject)}
                />
              </FormField>

              <FormField label="Notes" htmlFor="followup-notes">
                <Textarea
                  {...scheduleForm.register('notes')}
                  id="followup-notes"
                  rows={3}
                  placeholder="Context, talking points, agreed agenda…"
                />
              </FormField>
            </DialogBody>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" loading={createMutation.isPending}>
                Schedule
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
