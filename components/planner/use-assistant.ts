'use client';

/**
 * The capture → preview → confirm flow.
 *
 * The rule this hook exists to enforce: **nothing is written until the user
 * confirms.** Interpretation returns a proposal, the proposal is rendered as
 * rows the user can inspect and deselect, and only the selected subset is
 * applied. The model is never given a path to the database.
 *
 * Where the write happens depends on the mode, and the split is not incidental:
 *
 * - **Guest** — applied in the browser. The data is in localStorage, so a round
 *   trip would be pointless, and it means the demo works with no backend at
 *   all. The confirmed actions run through `planMutations`, the same pure
 *   function the server uses, so both modes produce identical writes.
 * - **Signed in** — applied by `/api/actions/apply`, which re-validates every
 *   id against the database and carries an idempotency key.
 *
 * The 'clarify' action type is deliberately unselectable: it is a question, not
 * a change, and pretending otherwise would let a user "confirm" a request for
 * information.
 */
import * as React from 'react';
import { toast } from 'sonner';

import { usePlanner } from '@/components/planner/planner-store';
import { planMutations } from '@/lib/domain/apply-actions';
import { newId } from '@/lib/domain/ids';
import type { DayKey } from '@/lib/domain/types';
import {
  requiresConfirmation,
  type ActionValidationIssue,
  type AssistantAction,
} from '@/lib/validation/ai-actions';
import type { InterpretResponse } from '@/lib/validation/api-schemas';
import { interpretResponseSchema } from '@/lib/validation/api-schemas';

export type AssistantStatus = 'idle' | 'interpreting' | 'preview' | 'applying';

export interface AssistantPreview {
  summary: string;
  actions: AssistantAction[];
  source: InterpretResponse['source'];
  fallbackReason: string | null;
  issues: ActionValidationIssue[];
}

export interface AssistantController {
  status: AssistantStatus;
  text: string;
  setText: (text: string) => void;
  preview: AssistantPreview | null;
  /** Indices of actions the user has left selected. */
  selected: ReadonlySet<number>;
  toggle: (index: number) => void;
  selectAll: () => void;
  clearSelection: () => void;
  /** True when at least one selected action needs a deliberate confirm. */
  needsConfirmation: boolean;
  interpret: () => Promise<void>;
  confirm: () => Promise<void>;
  discard: () => void;
  /** Dates from `optimize_day` actions, handed to the Optimize Day flow. */
  pendingOptimizeDates: readonly DayKey[];
  consumeOptimizeDates: () => void;
}

/** Actions that are informational rather than a change. */
function isSelectable(action: AssistantAction): boolean {
  return action.type !== 'clarify';
}

export function useAssistant(): AssistantController {
  const { mode, profile, tasks, goals, repository, refresh, pushUndo, undo } = usePlanner();

  const [status, setStatus] = React.useState<AssistantStatus>('idle');
  const [text, setText] = React.useState('');
  const [preview, setPreview] = React.useState<AssistantPreview | null>(null);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [pendingOptimizeDates, setPendingOptimizeDates] = React.useState<DayKey[]>([]);

  /**
   * Aborts an in-flight interpretation when a new one starts.
   *
   * Without this, typing a second capture while the first is still running can
   * land two previews, and the one that renders is whichever request finished
   * last rather than whichever the user asked for most recently.
   */
  const inFlight = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => inFlight.current?.abort(), []);

  const discard = React.useCallback(() => {
    inFlight.current?.abort();
    setPreview(null);
    setSelected(new Set());
    setStatus('idle');
  }, []);

  const interpret = React.useCallback(async () => {
    const capture = text.trim();
    if (!capture || !profile) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setStatus('interpreting');

    try {
      const response = await fetch('/api/assistant/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: capture,
          // Guests send their own context because the server has no copy of a
          // localStorage planner. For a signed-in user this is ignored server
          // side, so it is not sent at all.
          ...(mode === 'guest' ? { context: { profile, tasks, goals } } : {}),
        }),
      });

      if (!response.ok) {
        const message = await readErrorMessage(response);
        setStatus('idle');
        toast.error(message);
        return;
      }

      const parsed = interpretResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setStatus('idle');
        toast.error('That response could not be read. Try rephrasing your note.');
        return;
      }

      const actions = parsed.data.actions;
      setPreview({
        summary: parsed.data.summary,
        actions,
        source: parsed.data.source,
        fallbackReason: parsed.data.fallbackReason,
        issues: parsed.data.issues,
      });

      // Everything actionable starts selected: the common case is "yes, all of
      // that", and deselecting is easier than selecting six rows.
      setSelected(
        new Set(
          actions.reduce<number[]>((indexes, action, index) => {
            if (isSelectable(action)) indexes.push(index);
            return indexes;
          }, []),
        ),
      );
      setStatus('preview');
    } catch (error) {
      // An abort is this hook superseding itself, not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus('idle');
      toast.error('Your note could not be interpreted. Check your connection and try again.');
    }
  }, [text, profile, mode, tasks, goals]);

  const toggle = React.useCallback(
    (index: number) => {
      const action = preview?.actions[index];
      if (!action || !isSelectable(action)) return;

      setSelected((current) => {
        const next = new Set(current);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
    },
    [preview],
  );

  const selectAll = React.useCallback(() => {
    if (!preview) return;
    setSelected(
      new Set(
        preview.actions.reduce<number[]>((indexes, action, index) => {
          if (isSelectable(action)) indexes.push(index);
          return indexes;
        }, []),
      ),
    );
  }, [preview]);

  const clearSelection = React.useCallback(() => setSelected(new Set()), []);

  const selectedActions = React.useMemo(() => {
    if (!preview) return [];
    return preview.actions.filter((action, index) => selected.has(index) && isSelectable(action));
  }, [preview, selected]);

  const needsConfirmation = React.useMemo(
    () =>
      selectedActions.some((action) =>
        requiresConfirmation(action, {
          batchSize: selectedActions.length,
          confirmAll: profile?.confirmAllActions ?? false,
        }),
      ),
    [selectedActions, profile?.confirmAllActions],
  );

  const confirm = React.useCallback(async () => {
    if (!profile || !repository || selectedActions.length === 0) return;

    setStatus('applying');
    const sourceText = text.trim();

    try {
      if (mode === 'guest') {
        // Same pure planner the server uses, so guest and account modes cannot
        // interpret a confirmed action differently.
        const planned = planMutations(selectedActions, {
          profile,
          tasks,
          goals,
          now: new Date(),
          sourceText,
        });

        const outcome = await repository.applyMutations(planned.mutations);
        await refresh();

        // Registered before the toast is built, so the toast's Undo button acts
        // on a batch that is already pending rather than racing it.
        if (outcome.inverse.length > 0) {
          pushUndo(describeBatch(selectedActions.length), outcome.inverse);
        }

        reportOutcome({
          appliedCount: outcome.appliedCount,
          createdTaskCount: outcome.createdTaskIds.length,
          rejected: outcome.rejected.map((entry) => entry.reason),
          onUndo: outcome.inverse.length > 0 ? () => void undo() : null,
        });

        setPendingOptimizeDates(planned.deferred.map((action) => action.date));
      } else {
        const response = await fetch('/api/actions/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actions: selectedActions,
            sourceText,
            // A fresh key per confirmation attempt. Resending the same one is
            // what makes a retry safe; a new one per attempt is what keeps two
            // *different* confirmations from being collapsed into one.
            idempotencyKey: newId(),
          }),
        });

        if (!response.ok) {
          toast.error(await readErrorMessage(response));
          setStatus('preview');
          return;
        }

        const payload = (await response.json()) as {
          appliedCount?: number;
          createdTaskIds?: string[];
          rejected?: Array<{ reason: string }>;
          deferredOptimizeDates?: string[];
        };

        await refresh();

        reportOutcome({
          appliedCount: payload.appliedCount ?? 0,
          createdTaskCount: payload.createdTaskIds?.length ?? 0,
          rejected: (payload.rejected ?? []).map((entry) => entry.reason),
          // Undo for account mode reverses through the repository on the next
          // request rather than being offered from a stale client-side inverse.
          onUndo: null,
        });

        setPendingOptimizeDates(payload.deferredOptimizeDates ?? []);
      }

      setText('');
      setPreview(null);
      setSelected(new Set());
      setStatus('idle');
    } catch {
      // The preview is kept so the user can retry without retyping.
      setStatus('preview');
      toast.error('Those changes could not be saved. Nothing was applied — try again.');
    }
  }, [profile, repository, selectedActions, text, mode, tasks, goals, refresh, pushUndo, undo]);

  const consumeOptimizeDates = React.useCallback(() => setPendingOptimizeDates([]), []);

  return {
    status,
    text,
    setText,
    preview,
    selected,
    toggle,
    selectAll,
    clearSelection,
    needsConfirmation,
    interpret,
    confirm,
    discard,
    pendingOptimizeDates,
    consumeOptimizeDates,
  };
}

/**
 * One toast per confirmation, phrased by what happened.
 *
 * Partial success is reported as partial success rather than as either a clean
 * win or a failure, because "3 of 4 saved" is the only accurate thing to say
 * and the user needs to know which state their planner is in.
 */
function reportOutcome(options: {
  appliedCount: number;
  createdTaskCount: number;
  rejected: string[];
  onUndo: (() => void) | null;
}): void {
  const { appliedCount, createdTaskCount, rejected, onUndo } = options;

  if (appliedCount === 0 && rejected.length > 0) {
    toast.error(rejected[0] ?? 'Nothing could be applied.');
    return;
  }

  const summary =
    createdTaskCount > 0
      ? `Added ${createdTaskCount} ${createdTaskCount === 1 ? 'task' : 'tasks'}.`
      : 'Changes applied.';

  if (rejected.length > 0) {
    toast.warning(`${summary} ${rejected.length} could not be applied.`, {
      description: rejected[0],
    });
    return;
  }

  if (onUndo) {
    toast.success(summary, { action: { label: 'Undo', onClick: onUndo } });
    return;
  }

  toast.success(summary);
}

function describeBatch(count: number): string {
  return count === 1 ? 'that change' : `those ${count} changes`;
}

/** Reads the API's error envelope, falling back to something honest. */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // Not JSON. The status-based message below is the better answer anyway.
  }
  if (response.status === 429) return 'That was a lot at once. Try again in a moment.';
  return 'Something went wrong. Try again.';
}
