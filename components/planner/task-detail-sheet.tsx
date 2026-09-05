'use client';

/**
 * The task editor.
 *
 * Deliberately a *full* editor rather than a modal with three fields. Every
 * property the priority engine and the scheduler read is editable here —
 * deadline, planned start, duration, importance, energy, fixed-time,
 * splittable, recurrence, dependencies — because a ranking the user can inspect
 * but not influence is worse than no ranking at all.
 *
 * The two-column deadline/schedule split is the most important layout decision
 * on this screen: showing "Due" and "Do it at" side by side with their own
 * labels is what teaches the distinction the whole product rests on.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Link2, Trash2 } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { usePlanner } from '@/components/planner/planner-store';
import { ScoreBreakdown } from '@/components/planner/score-breakdown';
import { Button } from '@/components/ui/button';
import { Field, describedBy } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Kbd, Separator } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { dayKeyOf, formatInZone, toIso, zonedTimeToInstant } from '@/lib/dates';
import { RECURRENCE_PRESETS, normalizeRecurrenceRule } from '@/lib/domain/recurrence';
import { scoreTask } from '@/lib/domain/priority';
import { ENERGY_LEVELS, MANUAL_PRIORITIES, type Task } from '@/lib/domain/types';
import { CATEGORY_LABELS } from '@/lib/goal-colors';
import { taskFormSchema, type TaskFormValues } from '@/lib/validation/forms';
import { cn } from '@/lib/utils';

const ENERGY_LABELS: Record<(typeof ENERGY_LEVELS)[number], string> = {
  low: 'Low — admin, email, tidying',
  medium: 'Medium — ordinary work',
  high: 'High — deep focus',
};

const PRIORITY_LABELS: Record<(typeof MANUAL_PRIORITIES)[number], string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

const IMPORTANCE_LABELS: Record<number, string> = {
  1: '1 — barely matters',
  2: '2 — minor',
  3: '3 — normal',
  4: '4 — significant',
  5: '5 — critical',
};

export function TaskDetailSheet({
  taskId,
  onOpenChange,
}: {
  taskId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const planner = usePlanner();
  const task = React.useMemo(
    () => planner.tasks.find((candidate) => candidate.id === taskId) ?? null,
    [planner.tasks, taskId],
  );

  return (
    <Sheet open={taskId !== null} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        {task ? (
          <TaskDetailForm key={task.id} task={task} onDone={() => onOpenChange(false)} />
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>Task not found</SheetTitle>
              <SheetDescription>It may have been deleted in another tab.</SheetDescription>
            </SheetHeader>
            <SheetFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TaskDetailForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const {
    timezone,
    goals,
    goalsById,
    blockedTaskIds,
    tasks,
    updateTask,
    deleteTask,
    duplicateTask,
    addDependency,
    removeDependency,
    snapshot,
  } = usePlanner();

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    // `onBlur` rather than `onChange`: validating mid-word means an error
    // appears the moment a field is touched and before it could possibly be
    // correct, which reads as the form arguing with the user.
    mode: 'onBlur',
    defaultValues: toFormValues(task, timezone),
  });

  const isFixedTime = form.watch('isFixedTime');

  const score = React.useMemo(
    () =>
      scoreTask(task, {
        goalsById,
        blockedTaskIds,
        now: new Date(),
        timezone,
      }),
    [task, goalsById, blockedTaskIds, timezone],
  );

  const dependencies = React.useMemo(
    () => (snapshot?.dependencies ?? []).filter((edge) => edge.taskId === task.id),
    [snapshot?.dependencies, task.id],
  );

  const dependencyCandidates = React.useMemo(
    () =>
      tasks.filter(
        (candidate) =>
          candidate.id !== task.id &&
          candidate.status !== 'completed' &&
          candidate.status !== 'archived' &&
          !dependencies.some((edge) => edge.dependsOnTaskId === candidate.id),
      ),
    [tasks, task.id, dependencies],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    const parsed = taskFormSchema.parse(values);

    const dueAt = combine(parsed.dueDate, parsed.dueTime || '23:59', timezone);
    const scheduledStart = combine(parsed.scheduledDate, parsed.scheduledTime || '09:00', timezone);
    const scheduledEnd = scheduledStart
      ? toIso(new Date(new Date(scheduledStart).getTime() + parsed.durationMinutes * 60_000))
      : null;

    const updated = await updateTask(task.id, {
      title: parsed.title,
      notes: parsed.notes.trim() === '' ? null : parsed.notes.trim(),
      goalId: parsed.goalId === '' ? null : parsed.goalId,
      dueAt,
      scheduledStart,
      scheduledEnd,
      durationMinutes: parsed.durationMinutes,
      manualPriority: parsed.manualPriority,
      importance: parsed.importance as Task['importance'],
      energy: parsed.energy,
      isFixedTime: parsed.isFixedTime,
      splittable: parsed.splittable,
      recurrenceRule: normalizeRecurrenceRule(parsed.recurrenceRule),
      // Scheduling a task moves it out of the inbox; unscheduling returns it.
      status:
        task.status === 'completed'
          ? task.status
          : scheduledStart
            ? 'planned'
            : task.status === 'planned'
              ? 'inbox'
              : task.status,
    });

    if (updated) {
      toast.success('Task updated.');
      onDone();
    }
  });

  return (
    <>
      <SheetHeader>
        <SheetTitle>Edit task</SheetTitle>
        <SheetDescription>
          Everything the planner uses to rank and schedule this task.
        </SheetDescription>
      </SheetHeader>

      <SheetBody>
        <form id="task-detail-form" onSubmit={onSubmit} className="space-y-5" noValidate>
          <Field label="Task" htmlFor="task-title" error={form.formState.errors.title?.message}>
            <Input
              id="task-title"
              {...form.register('title')}
              aria-invalid={Boolean(form.formState.errors.title) || undefined}
              aria-describedby={describedBy(
                'task-title',
                Boolean(form.formState.errors.title),
                false,
              )}
              autoComplete="off"
            />
          </Field>

          <Field label="Notes" htmlFor="task-notes" optional>
            <Textarea id="task-notes" rows={3} {...form.register('notes')} />
          </Field>

          <Field
            label="Goal"
            htmlFor="task-goal"
            optional
            hint="Links this work to something longer-term, which raises its rank."
          >
            <Select
              value={form.watch('goalId') ?? ''}
              onValueChange={(value) =>
                form.setValue('goalId', value === NO_GOAL ? '' : value, { shouldDirty: true })
              }
            >
              <SelectTrigger id="task-goal">
                <SelectValue placeholder="No goal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GOAL}>No goal</SelectItem>
                {goals
                  .filter((goal) => goal.status === 'active' || goal.id === task.goalId)
                  .map((goal) => (
                    <SelectItem key={goal.id} value={goal.id}>
                      {goal.title} · {CATEGORY_LABELS[goal.category]}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>

          <Separator />

          {/* The distinction the whole planner rests on, shown side by side. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="space-y-2">
              <legend className="text-ink text-sm font-medium">Due</legend>
              <p className="text-ink-subtle text-xs leading-relaxed">When it has to be finished.</p>
              <Input
                type="date"
                aria-label="Deadline date"
                {...form.register('dueDate')}
                aria-invalid={Boolean(form.formState.errors.dueDate) || undefined}
              />
              <Input type="time" aria-label="Deadline time" {...form.register('dueTime')} />
              {form.formState.errors.dueDate ? (
                <p role="alert" className="text-urgent-ink text-xs">
                  {form.formState.errors.dueDate.message}
                </p>
              ) : null}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-ink text-sm font-medium">Do it at</legend>
              <p className="text-ink-subtle text-xs leading-relaxed">
                When you plan to work on it.
              </p>
              <Input
                type="date"
                aria-label="Planned date"
                {...form.register('scheduledDate')}
                aria-invalid={Boolean(form.formState.errors.scheduledDate) || undefined}
              />
              <Input
                type="time"
                aria-label="Planned start time"
                {...form.register('scheduledTime')}
                aria-invalid={Boolean(form.formState.errors.scheduledTime) || undefined}
              />
              {(form.formState.errors.scheduledDate ?? form.formState.errors.scheduledTime) ? (
                <p role="alert" className="text-urgent-ink text-xs">
                  {form.formState.errors.scheduledDate?.message ??
                    form.formState.errors.scheduledTime?.message}
                </p>
              ) : null}
            </fieldset>
          </div>

          <Field
            label="How long"
            htmlFor="task-duration"
            hint="Used to decide whether it fits in the hours you have."
            error={form.formState.errors.durationMinutes?.message}
          >
            <div className="flex items-center gap-2">
              <Input
                id="task-duration"
                type="number"
                inputMode="numeric"
                min={5}
                max={480}
                step={5}
                className="w-28"
                {...form.register('durationMinutes')}
                aria-invalid={Boolean(form.formState.errors.durationMinutes) || undefined}
              />
              <span className="text-ink-muted text-sm">minutes</span>
            </div>
          </Field>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Priority flag" htmlFor="task-priority">
              <Select
                value={form.watch('manualPriority')}
                onValueChange={(value) =>
                  form.setValue('manualPriority', value as TaskFormValues['manualPriority'], {
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger id="task-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_PRIORITIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {PRIORITY_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Importance" htmlFor="task-importance">
              <Select
                value={String(form.watch('importance'))}
                onValueChange={(value) =>
                  form.setValue('importance', Number(value), { shouldDirty: true })
                }
              >
                <SelectTrigger id="task-importance">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {IMPORTANCE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field
            label="Energy needed"
            htmlFor="task-energy"
            hint="High-energy work is placed in your focus window when there is room."
          >
            <Select
              value={form.watch('energy')}
              onValueChange={(value) =>
                form.setValue('energy', value as TaskFormValues['energy'], { shouldDirty: true })
              }
            >
              <SelectTrigger id="task-energy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENERGY_LEVELS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {ENERGY_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Repeats"
            htmlFor="task-recurrence"
            optional
            hint="Completing an occurrence creates the next one."
          >
            <Select
              value={form.watch('recurrenceRule') || NO_RECURRENCE}
              onValueChange={(value) =>
                form.setValue('recurrenceRule', value === NO_RECURRENCE ? '' : value, {
                  shouldDirty: true,
                })
              }
            >
              <SelectTrigger id="task-recurrence">
                <SelectValue placeholder="Does not repeat" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_RECURRENCE}>Does not repeat</SelectItem>
                {/* The "does not repeat" preset is already the item above. */}
                {RECURRENCE_PRESETS.flatMap((preset) =>
                  preset.rule === null
                    ? []
                    : [
                        <SelectItem key={preset.rule} value={preset.rule}>
                          {preset.label}
                        </SelectItem>,
                      ],
                )}
              </SelectContent>
            </Select>
          </Field>

          <div className="border-line bg-surface-sunken space-y-3 rounded-md border p-3.5">
            <ToggleRow
              id="task-fixed"
              label="Fixed commitment"
              description="A class, meeting or appointment. The scheduler will never move it."
              checked={form.watch('isFixedTime')}
              onChange={(checked) => form.setValue('isFixedTime', checked, { shouldDirty: true })}
            />
            <ToggleRow
              id="task-splittable"
              label="Can be split"
              description="Long work may be broken into shorter blocks across the day."
              checked={form.watch('splittable')}
              onChange={(checked) => form.setValue('splittable', checked, { shouldDirty: true })}
              // A fixed commitment happens in one sitting by definition, so
              // offering to split it would be offering something meaningless.
              disabled={isFixedTime}
            />
          </div>
        </form>

        <Separator />

        <section className="space-y-3" aria-labelledby="task-dependencies-heading">
          <div>
            <h3 id="task-dependencies-heading" className="text-ink text-sm font-medium">
              Waiting on
            </h3>
            <p className="text-ink-subtle text-xs leading-relaxed">
              Blocked tasks stay out of the schedule until their prerequisites are done.
            </p>
          </div>

          {dependencies.length > 0 ? (
            <ul className="space-y-1.5">
              {dependencies.map((edge) => {
                const prerequisite = tasks.find(
                  (candidate) => candidate.id === edge.dependsOnTaskId,
                );
                return (
                  <li
                    key={edge.dependsOnTaskId}
                    className="bg-surface-sunken flex items-center gap-2 rounded-sm px-2.5 py-1.5"
                  >
                    <Link2 className="text-ink-subtle size-3.5 shrink-0" aria-hidden />
                    <span className="text-ink min-w-0 flex-1 truncate text-sm">
                      {prerequisite?.title ?? 'A deleted task'}
                    </span>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={`Stop waiting on ${prerequisite?.title ?? 'this task'}`}
                      onClick={() => void removeDependency(task.id, edge.dependsOnTaskId)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-ink-subtle text-sm">Nothing is blocking this task.</p>
          )}

          {dependencyCandidates.length > 0 ? (
            <Select value="" onValueChange={(value) => void addDependency(task.id, value)}>
              <SelectTrigger size="sm" aria-label="Add a prerequisite task">
                <SelectValue placeholder="Add a prerequisite…" />
              </SelectTrigger>
              <SelectContent>
                {dependencyCandidates.slice(0, 40).map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </section>

        <Separator />

        <section aria-labelledby="task-score-heading">
          <h3 id="task-score-heading" className="sr-only">
            Priority breakdown
          </h3>
          <div className="border-line bg-surface-sunken rounded-md border p-3.5">
            <ScoreBreakdown score={score} />
          </div>
        </section>

        <Separator />

        <section className="space-y-2">
          <h3 className="text-ink text-sm font-medium">Danger zone</h3>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                const copy = await duplicateTask(task.id);
                if (copy) toast.success('Task duplicated.');
              }}
            >
              Duplicate
            </Button>
            <Button
              variant="outlineDanger"
              size="sm"
              onClick={async () => {
                const removed = await deleteTask(task.id);
                if (removed) {
                  toast.success('Task deleted.');
                  onDone();
                }
              }}
            >
              <Trash2 className="size-3.5" aria-hidden />
              Delete
            </Button>
          </div>
        </section>
      </SheetBody>

      <SheetFooter className="justify-between">
        <p className="text-ink-subtle hidden items-center gap-1 text-xs sm:flex">
          <Kbd>Esc</Kbd> to close
        </p>
        <div className="flex flex-1 gap-2 sm:flex-none">
          <Button variant="ghost" className="flex-1 sm:flex-none" onClick={onDone}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="task-detail-form"
            className="flex-1 sm:flex-none"
            loading={form.formState.isSubmitting}
          >
            Save changes
          </Button>
        </div>
      </SheetFooter>
    </>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn('flex items-start gap-3', disabled && 'opacity-55')}>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-describedby={`${id}-description`}
      />
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={id} className="text-ink block text-sm font-medium select-none">
          {label}
        </label>
        <p id={`${id}-description`} className="text-ink-subtle text-xs leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}

/**
 * Radix `Select` cannot hold an empty-string value — it reserves that for
 * "nothing selected" — so the explicit "no goal" and "no recurrence" choices
 * need sentinel values that are mapped back to `''` on change.
 */
const NO_GOAL = '__none__';
const NO_RECURRENCE = '__never__';

function toFormValues(task: Task, timezone: string): TaskFormValues {
  return {
    title: task.title,
    notes: task.notes ?? '',
    goalId: task.goalId ?? '',
    dueDate: task.dueAt ? dayKeyOf(new Date(task.dueAt), timezone) : '',
    dueTime: task.dueAt ? formatInZone(new Date(task.dueAt), timezone, 'HH:mm') : '',
    scheduledDate: task.scheduledStart ? dayKeyOf(new Date(task.scheduledStart), timezone) : '',
    scheduledTime: task.scheduledStart
      ? formatInZone(new Date(task.scheduledStart), timezone, 'HH:mm')
      : '',
    durationMinutes: task.durationMinutes,
    manualPriority: task.manualPriority,
    importance: task.importance,
    energy: task.energy,
    isFixedTime: task.isFixedTime,
    splittable: task.splittable,
    recurrenceRule: task.recurrenceRule ?? '',
  };
}

/** Date + wall-clock time in the user's zone → a UTC instant. */
function combine(dayKey: string, time: string, timezone: string): string | null {
  if (dayKey === '') return null;
  return toIso(zonedTimeToInstant(dayKey, time, timezone));
}
