'use client';

/**
 * The confirmation gate.
 *
 * This component is the reason the AI in this product is safe to ship. The
 * model proposes; this screen makes every proposal legible and individually
 * refusable; only then does anything get written. Concretely it guarantees:
 *
 * - **Nothing is hidden.** Each row states the action type, the interpretation
 *   in plain English, and the concrete field values that will be stored. A
 *   preview that said "3 changes" would be a rubber stamp.
 *
 * - **Every row is deselectable.** A brain dump that produced four good tasks
 *   and one misreading should cost one click, not a retype.
 *
 * - **Inferences are labelled as inferences.** A duration the model guessed is
 *   marked as guessed, because the user is the only one who knows how long
 *   their own work takes.
 *
 * - **Questions are not changes.** A `clarify` action renders as a question
 *   with no checkbox — it cannot be "confirmed", only answered by editing the
 *   note.
 */
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  HelpCircle,
  Info,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import * as React from 'react';

import { usePlanner } from '@/components/planner/planner-store';
import type { AssistantController } from '@/components/planner/use-assistant';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { describeDueDate, formatDuration, formatInZone } from '@/lib/dates';
import { describeRecurrence } from '@/lib/domain/recurrence';
import { describeActionType, type AssistantAction } from '@/lib/validation/ai-actions';
import { cn, pluralize } from '@/lib/utils';

export function ActionPreview({ assistant }: { assistant: AssistantController }) {
  const { timezone } = usePlanner();
  const preview = assistant.preview;
  if (!preview) return null;

  const selectableCount = preview.actions.filter((action) => action.type !== 'clarify').length;
  const selectedCount = assistant.selected.size;
  const applying = assistant.status === 'applying';

  return (
    <section className="border-line border-t" aria-label="Proposed changes">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 px-5 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <p className="text-ink text-sm leading-relaxed font-medium">{preview.summary}</p>
          <p className="text-ink-subtle mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {preview.source === 'ai' ? (
              <>
                <Sparkles className="text-primary size-3" aria-hidden />
                Read by AI
              </>
            ) : (
              <>
                <Wand2 className="size-3" aria-hidden />
                Read by the built-in parser
              </>
            )}
            {selectableCount > 0 ? (
              <span>
                · {selectedCount} of {selectableCount} selected
              </span>
            ) : null}
          </p>
        </div>

        {selectableCount > 1 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={
              selectedCount === selectableCount ? assistant.clearSelection : assistant.selectAll
            }
          >
            {selectedCount === selectableCount ? 'Deselect all' : 'Select all'}
          </Button>
        ) : null}
      </header>

      {/* A fallback is stated plainly rather than hidden. If the model was
          unavailable, the literal reading needs explaining or it just looks
          like the app got worse. */}
      {preview.fallbackReason ? (
        <p className="border-warning-border bg-warning-soft text-warning-ink mx-5 mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {preview.fallbackReason}
        </p>
      ) : null}

      {preview.issues.length > 0 ? (
        <ul className="mx-5 mb-3 space-y-1">
          {preview.issues.map((issue, index) => (
            <li
              key={`${issue.index}-${index}`}
              className="border-line bg-surface-sunken text-ink-muted flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed"
            >
              <AlertCircle className="text-ink-subtle mt-0.5 size-3.5 shrink-0" aria-hidden />
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="divide-line border-line divide-y border-y">
        {preview.actions.map((action, index) => (
          <ActionRow
            key={`${action.type}-${index}`}
            action={action}
            index={index}
            timezone={timezone}
            selected={assistant.selected.has(index)}
            onToggle={assistant.toggle}
          />
        ))}
      </ul>

      <footer className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center">
        {assistant.needsConfirmation ? (
          <p className="text-ink-muted flex items-start gap-1.5 text-xs leading-relaxed sm:flex-1">
            <AlertCircle className="text-warning mt-0.5 size-3.5 shrink-0" aria-hidden />
            Some of these change existing work. Check them before applying.
          </p>
        ) : (
          <div className="sm:flex-1" />
        )}

        <div className="flex gap-2">
          <Button variant="ghost" onClick={assistant.discard} disabled={applying}>
            Discard
          </Button>
          <Button
            variant="primary"
            onClick={() => void assistant.confirm()}
            disabled={selectedCount === 0 || applying}
            loading={applying}
          >
            {selectedCount === 0
              ? 'Nothing selected'
              : `Apply ${pluralize(selectedCount, 'change')}`}
          </Button>
        </div>
      </footer>
    </section>
  );
}

function ActionRow({
  action,
  index,
  timezone,
  selected,
  onToggle,
}: {
  action: AssistantAction;
  index: number;
  timezone: string;
  selected: boolean;
  onToggle: (index: number) => void;
}) {
  const selectable = action.type !== 'clarify';
  const rowId = `action-${index}`;

  return (
    <li
      className={cn(
        'flex items-start gap-3 px-5 py-3.5 transition-colors',
        selectable && !selected && 'opacity-55',
        selectable && 'hover:bg-surface-hover',
      )}
    >
      {selectable ? (
        <Checkbox
          id={rowId}
          checked={selected}
          onCheckedChange={() => onToggle(index)}
          className="mt-0.5 shrink-0"
          aria-label={`${describeActionType(action.type)}: ${action.interpretation}`}
        />
      ) : (
        <HelpCircle className="text-warning mt-0.5 size-5 shrink-0" aria-hidden />
      )}

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <ActionTypeBadge action={action} />
          <ConfidenceHint confidence={action.confidence} />
        </div>

        <p className="text-ink text-sm leading-relaxed">{action.interpretation}</p>

        <ActionDetails action={action} timezone={timezone} />

        {action.ambiguity ? (
          <div className="border-warning-border bg-warning-soft rounded-md border px-2.5 py-2">
            <p className="text-warning-ink text-xs leading-relaxed font-medium">
              {action.ambiguity.question}
            </p>
            {action.ambiguity.options.length > 0 ? (
              <p className="text-warning-ink/80 mt-0.5 text-[0.6875rem]">
                Assumed the first of: {action.ambiguity.options.join(', ')}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ActionTypeBadge({ action }: { action: AssistantAction }) {
  const tone =
    action.type === 'delete_task'
      ? 'urgent'
      : action.type === 'complete_task'
        ? 'success'
        : action.type === 'clarify'
          ? 'warning'
          : action.type.startsWith('create')
            ? 'primary'
            : 'neutral';

  const Icon =
    action.type === 'delete_task'
      ? Trash2
      : action.type === 'complete_task'
        ? CheckCircle2
        : action.type === 'optimize_day'
          ? CalendarClock
          : null;

  return (
    <Badge tone={tone as 'urgent' | 'success' | 'warning' | 'primary' | 'neutral'}>
      {Icon ? <Icon className="size-3" aria-hidden /> : null}
      {describeActionType(action.type)}
    </Badge>
  );
}

/**
 * Confidence, but only when it is low enough to matter.
 *
 * Showing "94% confident" on every row trains people to ignore the number.
 * Showing it only below the threshold makes it a signal.
 */
function ConfidenceHint({ confidence }: { confidence: number }) {
  if (confidence >= 0.7) return null;
  return <span className="text-ink-subtle text-[0.6875rem]">Low confidence — worth a look</span>;
}

/**
 * The concrete values that will be written.
 *
 * This is the part that makes the preview verifiable rather than reassuring: the
 * user sees the resolved date, not the phrase they typed, so a misparsed
 * "Friday" is visible before it becomes a task.
 */
function ActionDetails({ action, timezone }: { action: AssistantAction; timezone: string }) {
  const facts: Array<{ label: string; value: string; inferred?: boolean }> = [];

  switch (action.type) {
    case 'create_task': {
      facts.push({ label: 'Task', value: action.title });
      if (action.dueAt) {
        facts.push({
          label: 'Due',
          value: `${describeDueDate(action.dueAt, timezone)} · ${formatInZone(new Date(action.dueAt), timezone, 'h:mm a')}`,
        });
      }
      if (action.scheduledStart) {
        facts.push({
          label: 'Do it at',
          value: formatInZone(new Date(action.scheduledStart), timezone, "EEE d MMM 'at' h:mm a"),
        });
      }
      if (action.durationMinutes !== null) {
        facts.push({
          label: 'Length',
          value: formatDuration(action.durationMinutes),
          inferred: action.durationInferred,
        });
      }
      if (action.goalMatchTitle) {
        facts.push({ label: 'Goal', value: action.goalMatchTitle });
      }
      if (action.recurrenceRule) {
        facts.push({ label: 'Repeats', value: describeRecurrence(action.recurrenceRule) });
      }
      if (action.isFixedTime) {
        facts.push({ label: 'Fixed', value: 'Will not be moved by the scheduler' });
      }
      if (action.manualPriority) {
        facts.push({ label: 'Priority', value: action.manualPriority });
      }
      break;
    }

    case 'update_task': {
      if (action.taskTitle) facts.push({ label: 'Task', value: action.taskTitle });
      if (action.title) facts.push({ label: 'New name', value: action.title });
      if (action.clearDueAt) facts.push({ label: 'Deadline', value: 'Removed' });
      else if (action.dueAt) {
        facts.push({ label: 'New deadline', value: describeDueDate(action.dueAt, timezone) });
      }
      if (action.clearSchedule) facts.push({ label: 'Schedule', value: 'Back to the queue' });
      if (action.durationMinutes !== null) {
        facts.push({ label: 'Length', value: formatDuration(action.durationMinutes) });
      }
      if (action.status) facts.push({ label: 'Status', value: action.status.replace('_', ' ') });
      break;
    }

    case 'complete_task':
    case 'delete_task':
      if (action.taskTitle) facts.push({ label: 'Task', value: action.taskTitle });
      break;

    case 'schedule_task':
      if (action.taskTitle) facts.push({ label: 'Task', value: action.taskTitle });
      facts.push({
        label: 'Do it at',
        value: formatInZone(new Date(action.scheduledStart), timezone, "EEE d MMM 'at' h:mm a"),
      });
      break;

    case 'reschedule_task':
      if (action.taskTitle) facts.push({ label: 'Task', value: action.taskTitle });
      if (action.scheduledStart) {
        facts.push({
          label: 'Moved to',
          value: formatInZone(new Date(action.scheduledStart), timezone, "EEE d MMM 'at' h:mm a"),
        });
      }
      if (action.dueAt) {
        facts.push({ label: 'New deadline', value: describeDueDate(action.dueAt, timezone) });
      }
      break;

    case 'create_goal':
      facts.push({ label: 'Goal', value: action.title });
      facts.push({ label: 'Category', value: action.category });
      facts.push({ label: 'Weight', value: `${action.priorityWeight} of 5` });
      if (action.targetDate) facts.push({ label: 'Target', value: action.targetDate });
      if (action.weeklyTargetMinutes !== null) {
        facts.push({ label: 'Weekly target', value: formatDuration(action.weeklyTargetMinutes) });
      }
      break;

    case 'update_goal':
      if (action.goalTitle) facts.push({ label: 'Goal', value: action.goalTitle });
      if (action.title) facts.push({ label: 'New name', value: action.title });
      if (action.status) facts.push({ label: 'Status', value: action.status });
      if (action.priorityWeight !== null) {
        facts.push({ label: 'Weight', value: `${action.priorityWeight} of 5` });
      }
      break;

    case 'optimize_day':
      facts.push({ label: 'Day', value: action.date });
      facts.push({
        label: 'Mode',
        value: action.replaceExisting ? 'Rebuild from scratch' : 'Fill the gaps',
      });
      break;

    case 'clarify':
      if (action.options.length > 0) {
        facts.push({ label: 'Options', value: action.options.join(' · ') });
      }
      break;
  }

  if (facts.length === 0) return null;

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {facts.map((fact) => (
        <React.Fragment key={`${fact.label}-${fact.value}`}>
          <dt className="text-ink-subtle">{fact.label}</dt>
          <dd className="text-ink-muted min-w-0">
            {fact.value}
            {fact.inferred ? (
              <span className="text-ink-subtle ml-1.5 text-[0.6875rem]">(estimated)</span>
            ) : null}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
