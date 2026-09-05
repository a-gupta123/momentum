'use client';

/**
 * Goal editor.
 *
 * Two fields here are load-bearing on the rest of the app, so they get real
 * explanations rather than bare labels:
 *
 * - **Weight** feeds directly into task ranking. Marking everything a 5 is the
 *   fastest way to make the ranking useless, and the hint says so.
 * - **Weekly target** is what Insights measures pace against. Leaving it blank
 *   is a legitimate answer, and it is different from a target of zero — so the
 *   field is a string, not a number with a magic sentinel.
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
import { Field, FieldGroup } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  GOAL_CATEGORIES,
  GOAL_COLOR_TOKENS,
  type Goal,
  type GoalColorToken,
} from '@/lib/domain/types';
import { CATEGORY_LABELS, goalColorLabel, goalColorVar, suggestGoalColor } from '@/lib/goal-colors';
import { goalFormSchema, type GoalFormValues } from '@/lib/validation/forms';
import { cn } from '@/lib/utils';

const WEIGHT_LABELS: Record<number, string> = {
  1: '1 — background',
  2: '2 — minor',
  3: '3 — steady',
  4: '4 — a priority',
  5: '5 — the reason I opened this app',
};

export function GoalDialog({
  goal,
  open,
  onOpenChange,
}: {
  /** `null` opens the dialog in create mode. */
  goal: Goal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { goals, createGoal, updateGoal } = usePlanner();

  const defaults = React.useMemo<GoalFormValues>(
    () =>
      goal
        ? {
            title: goal.title,
            description: goal.description ?? '',
            category: goal.category,
            priorityWeight: goal.priorityWeight,
            targetDate: goal.targetDate ?? '',
            weeklyTargetHours:
              goal.weeklyTargetMinutes === null
                ? ''
                : String(Math.round((goal.weeklyTargetMinutes / 60) * 10) / 10),
            status: goal.status,
            color: goal.color,
          }
        : {
            title: '',
            description: '',
            category: 'project',
            priorityWeight: 3,
            targetDate: '',
            weeklyTargetHours: '',
            status: 'active',
            color: suggestGoalColor('project', goals),
          },
    [goal, goals],
  );

  const form = useForm<GoalFormValues>({
    resolver: zodResolver(goalFormSchema),
    mode: 'onBlur',
    defaultValues: defaults,
  });

  React.useEffect(() => {
    if (open) form.reset(defaults);
  }, [open, defaults, form]);

  const category = form.watch('category');
  const color = form.watch('color') as GoalColorToken;

  // Only for new goals: changing the category of an existing goal should not
  // silently repaint something the user deliberately colored.
  const isNew = goal === null;
  React.useEffect(() => {
    if (!isNew || !open) return;
    form.setValue('color', suggestGoalColor(category, goals));
  }, [category, isNew, open, goals, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    const parsed = goalFormSchema.parse(values);

    const payload = {
      title: parsed.title,
      description: parsed.description.trim() === '' ? null : parsed.description.trim(),
      category: parsed.category,
      priorityWeight: parsed.priorityWeight as Goal['priorityWeight'],
      targetDate: parsed.targetDate === '' ? null : parsed.targetDate,
      weeklyTargetMinutes:
        parsed.weeklyTargetHours === '' ? null : Math.round(Number(parsed.weeklyTargetHours) * 60),
      status: parsed.status,
      color: parsed.color,
    };

    const saved = goal ? await updateGoal(goal.id, payload) : await createGoal(payload);
    if (saved) {
      toast.success(goal ? 'Goal updated.' : 'Goal created.');
      onOpenChange(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{goal ? 'Edit goal' : 'New goal'}</DialogTitle>
          <DialogDescription>
            Goals are what the ranking measures against. A task linked to a heavy goal outranks an
            identical task that is not.
          </DialogDescription>
        </DialogHeader>

        {/* The form owns the flex column so the fields scroll while the header
            and footer stay pinned — otherwise a tall form pushes the submit
            button off the bottom of a short viewport. */}
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <DialogBody className="space-y-4 py-3">
            <Field label="Goal" htmlFor="goal-title" error={form.formState.errors.title?.message}>
              <Input
                id="goal-title"
                placeholder="Ship the portfolio site"
                autoComplete="off"
                aria-invalid={Boolean(form.formState.errors.title) || undefined}
                {...form.register('title')}
              />
            </Field>

            <Field
              label="What does done look like?"
              htmlFor="goal-description"
              optional
              hint="A sentence you can check yourself against in three months."
            >
              <Textarea id="goal-description" rows={2} {...form.register('description')} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category" htmlFor="goal-category">
                <Select
                  value={category}
                  onValueChange={(value) =>
                    form.setValue('category', value as Goal['category'], { shouldDirty: true })
                  }
                >
                  <SelectTrigger id="goal-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GOAL_CATEGORIES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {CATEGORY_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label="Weight"
                htmlFor="goal-weight"
                hint="How much this goal pulls tasks up the ranking."
              >
                <Select
                  value={String(form.watch('priorityWeight'))}
                  onValueChange={(value) =>
                    form.setValue('priorityWeight', Number(value) as Goal['priorityWeight'], {
                      shouldDirty: true,
                    })
                  }
                >
                  <SelectTrigger id="goal-weight">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {WEIGHT_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Target date" htmlFor="goal-target" optional>
                <Input id="goal-target" type="date" {...form.register('targetDate')} />
              </Field>

              <Field
                label="Weekly target"
                htmlFor="goal-weekly"
                optional
                hint="Hours per week. Insights measures pace against this."
                error={form.formState.errors.weeklyTargetHours?.message}
              >
                <Input
                  id="goal-weekly"
                  inputMode="decimal"
                  placeholder="e.g. 6"
                  className="tabular-nums"
                  {...form.register('weeklyTargetHours')}
                />
              </Field>
            </div>

            <FieldGroup
              label="Color"
              hint="How this goal is identified across the timeline and charts."
            >
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Goal color">
                {GOAL_COLOR_TOKENS.map((token) => (
                  <button
                    key={token}
                    type="button"
                    role="radio"
                    aria-checked={color === token}
                    aria-label={goalColorLabel(token)}
                    onClick={() => form.setValue('color', token, { shouldDirty: true })}
                    className={cn(
                      'size-7 rounded-full border-2 transition-transform',
                      'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                      color === token
                        ? 'border-ink scale-110'
                        : 'border-transparent hover:scale-105',
                    )}
                    style={{ backgroundColor: goalColorVar(token) }}
                  />
                ))}
              </div>
            </FieldGroup>

            {goal ? (
              <Field
                label="Status"
                htmlFor="goal-status"
                hint="Paused goals stop influencing the ranking but keep their history."
              >
                <Select
                  value={form.watch('status')}
                  onValueChange={(value) =>
                    form.setValue('status', value as Goal['status'], { shouldDirty: true })
                  }
                >
                  <SelectTrigger id="goal-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="achieved">Achieved</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={form.formState.isSubmitting}>
              {goal ? 'Save changes' : 'Create goal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
