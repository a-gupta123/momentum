'use client';

/**
 * The capture box.
 *
 * The single most important input in the product, so a few things are handled
 * with more care than a textarea usually gets:
 *
 * - **⌘↵ submits, ↵ inserts a newline.** Multi-line captures are the primary
 *   use case ("three things on separate lines"), so Enter must not submit. The
 *   shortcut is shown next to the button rather than left to be discovered.
 *
 * - **Examples are clickable, not placeholder text.** A placeholder disappears
 *   the moment someone types and cannot be read again. These insert real text
 *   the user can then edit, which teaches the deadline/schedule distinction by
 *   demonstration.
 *
 * - **The composer can be focused from anywhere.** The command palette
 *   dispatches an event rather than holding a ref across the tree, so "Add a
 *   task" from ⌘K lands the cursor here.
 */
import { CornerDownLeft, Loader2, Sparkles, Wand2 } from 'lucide-react';
import * as React from 'react';

import { ActionPreview } from '@/components/planner/action-preview';
import { usePlanner } from '@/components/planner/planner-store';
import type { AssistantController } from '@/components/planner/use-assistant';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Kbd } from '@/components/ui/misc';
import { Textarea } from '@/components/ui/input';
import { DOMAIN_LIMITS } from '@/lib/domain/tuning';
import { cn } from '@/lib/utils';

/**
 * Examples chosen to cover the four cases people get wrong, in order: a
 * deadline, a fixed commitment, a multi-item brain dump, and recurrence.
 */
const EXAMPLES: readonly string[] = [
  'Automata problem set due Friday 5pm, about 2 hours',
  'Standup at 9:30 tomorrow for 15 minutes',
  'Read chapter 4\nDraft the lab report\nEmail my advisor',
  'Gym every weekday at 7am',
];

export function Composer({ assistant }: { assistant: AssistantController }) {
  const { capabilities, profile } = usePlanner();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const aiActive = capabilities.aiAssistAvailable && (profile?.aiAssistEnabled ?? true);
  const busy = assistant.status === 'interpreting';
  const charactersLeft = DOMAIN_LIMITS.captureMaxLength - assistant.text.length;

  // The palette asks for focus by event, so it needs no reference into this
  // subtree and this component needs no knowledge of the palette.
  React.useEffect(() => {
    function focusComposer(): void {
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    window.addEventListener('momentum:focus-composer', focusComposer);
    return () => window.removeEventListener('momentum:focus-composer', focusComposer);
  }, []);

  const submit = React.useCallback(() => {
    if (assistant.text.trim().length === 0 || busy) return;
    void assistant.interpret();
  }, [assistant, busy]);

  return (
    <Card className="overflow-hidden">
      <div className="relative">
        <label htmlFor="composer" className="sr-only">
          What is on your mind?
        </label>
        <Textarea
          id="composer"
          ref={textareaRef}
          value={assistant.text}
          onChange={(event) => assistant.setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
          maxLength={DOMAIN_LIMITS.captureMaxLength}
          rows={3}
          disabled={busy}
          placeholder="Automata problem set due Friday 5pm, about 2 hours…"
          aria-describedby="composer-help"
          className={cn(
            'min-h-24 resize-none rounded-none border-0 bg-transparent px-5 py-4 text-[0.9375rem] shadow-none',
            'focus-visible:ring-0',
          )}
        />
      </div>

      <div className="border-line bg-surface-sunken flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3">
        <p id="composer-help" className="text-ink-subtle flex items-center gap-1.5 text-xs">
          {aiActive ? (
            <Sparkles className="text-primary size-3.5" aria-hidden />
          ) : (
            <Wand2 className="size-3.5" aria-hidden />
          )}
          {aiActive
            ? 'Interpreted by AI. Nothing is saved until you confirm.'
            : 'Interpreted on this deployment. Nothing is saved until you confirm.'}
        </p>

        <div className="ml-auto flex items-center gap-2">
          {/* Only shown near the ceiling — a live counter on an empty box is
              noise, and a warning that appears late is more informative. */}
          {charactersLeft < 200 ? (
            <span
              className={cn(
                'text-xs tabular-nums',
                charactersLeft < 40 ? 'text-urgent-ink' : 'text-ink-subtle',
              )}
              aria-live="polite"
            >
              {charactersLeft} left
            </span>
          ) : null}

          <span className="text-ink-subtle hidden items-center gap-1 text-xs sm:flex">
            <Kbd>⌘</Kbd>
            <Kbd>
              <CornerDownLeft className="size-2.5" aria-hidden />
            </Kbd>
          </span>

          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={assistant.text.trim().length === 0 || busy}
            loading={busy}
          >
            {busy ? 'Reading…' : 'Interpret'}
          </Button>
        </div>
      </div>

      {/* One region, so a screen reader hears the preview appear instead of
          silently gaining twelve new controls. */}
      <div aria-live="polite" aria-atomic="false">
        {assistant.status === 'interpreting' ? (
          <div className="border-line text-ink-muted flex items-center gap-2 border-t px-5 py-4 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Working out what that means…
          </div>
        ) : null}

        {assistant.preview ? <ActionPreview assistant={assistant} /> : null}
      </div>

      {!assistant.preview && assistant.status === 'idle' ? (
        <div className="border-line border-t px-4 py-3">
          <p className="text-ink-subtle mb-2 text-[0.6875rem] font-semibold tracking-wide uppercase">
            Try
          </p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  assistant.setText(example);
                  textareaRef.current?.focus();
                }}
                className={cn(
                  'press border-line bg-surface rounded-full border px-2.5 py-1',
                  'text-ink-muted text-left text-[0.6875rem]',
                  'hover:border-primary-border hover:bg-primary-soft hover:text-primary',
                )}
              >
                {example.split('\n')[0]}
                {example.includes('\n') ? ' + 2 more' : ''}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
