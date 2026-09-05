'use client';

/**
 * Quick add.
 *
 * Deliberately smaller than the task editor. The composer above it handles
 * "next Tuesday at 3" in prose; this is the escape hatch for when someone
 * wants explicit fields, and the fastest version of that is four of them.
 * Everything else is one click away in the task sheet after the task exists,
 * which is the right time to care about energy level and recurrence.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { usePlanner } from '@/components/planner/planner-store';
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
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toIso, zonedTimeToInstant } from '@/lib/dates';
import { CATEGORY_LABELS } from '@/lib/goal-colors';
import { quickTaskFormSchema, type QuickTaskFormValues } from '@/lib/validation/forms';

const NO_GOAL = '__none__';

export function NewTaskDialog({
  open,
  onOpenChange,
  defaultDayKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefills the deadline with the day the user is looking at. */
  defaultDayKey?: string;
}) {
  const { goals, profile, timezone, createTask } = usePlanner();

  const defaults = React.useMemo<QuickTaskFormValues>(
    () => ({
      title: '',
      goalId: '',
      durationMinutes: profile?.defaultTaskDurationMinutes ?? 30,
      dueDate: '',
      dueTime: '',
    }),
    [profile?.defaultTaskDurationMinutes],
  );

  const form = useForm<QuickTaskFormValues>({
    resolver: zodResolver(quickTaskFormSchema),
    mode: 'onBlur',
    defaultValues: defaults,
  });

  // Remounting on open would lose focus management, so the form is reset
  // instead — and only when it opens, so a mid-edit re-render never wipes it.
  React.useEffect(() => {
    if (open) form.reset(defaults);
  }, [open, defaults, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    const parsed = quickTaskFormSchema.parse(values);

    const created = await createTask({
      title: parsed.title,
      goalId: parsed.goalId === '' ? null : parsed.goalId,
      durationMinutes: parsed.durationMinutes,
      // A deadline with no time means end of that day, not midnight at its
      // start — "due Friday" has never meant 00:00 to anyone.
      dueAt:
        parsed.dueDate === ''
          ? null
          : toIso(zonedTimeToInstant(parsed.dueDate, parsed.dueTime || '23:59', timezone)),
    });

    if (created) {
      toast.success('Task added.');
      onOpenChange(false);
    }
  });

  const activeGoals = goals.filter((goal) => goal.status === 'active');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Just the essentials. You can add scheduling, energy and recurrence after it exists.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <DialogBody className="space-y-4 py-3">
            <Field label="Task" htmlFor="quick-title" error={form.formState.errors.title?.message}>
              <Input
                id="quick-title"
                placeholder="Draft the Q3 retrospective"
                autoComplete="off"
                aria-invalid={Boolean(form.formState.errors.title) || undefined}
                {...form.register('title')}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Goal" htmlFor="quick-goal" optional>
                <Select
                  value={form.watch('goalId') || NO_GOAL}
                  onValueChange={(value) =>
                    form.setValue('goalId', value === NO_GOAL ? '' : value, { shouldDirty: true })
                  }
                >
                  <SelectTrigger id="quick-goal">
                    <SelectValue placeholder="No goal" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_GOAL}>No goal</SelectItem>
                    {activeGoals.map((goal) => (
                      <SelectItem key={goal.id} value={goal.id}>
                        {goal.title} · {CATEGORY_LABELS[goal.category]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label="Estimate"
                htmlFor="quick-duration"
                error={form.formState.errors.durationMinutes?.message}
                hint="Minutes"
              >
                <Input
                  id="quick-duration"
                  type="number"
                  inputMode="numeric"
                  min={5}
                  step={5}
                  className="tabular-nums"
                  {...form.register('durationMinutes')}
                />
              </Field>

              <Field
                label="Due date"
                htmlFor="quick-due-date"
                optional
                error={form.formState.errors.dueDate?.message}
              >
                <Input
                  id="quick-due-date"
                  type="date"
                  defaultValue={defaultDayKey}
                  {...form.register('dueDate')}
                />
              </Field>

              <Field label="Due time" htmlFor="quick-due-time" optional>
                <Input id="quick-due-time" type="time" {...form.register('dueTime')} />
              </Field>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={form.formState.isSubmitting}>
              Add task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
