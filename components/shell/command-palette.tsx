'use client';

/**
 * Command palette.
 *
 * Two jobs: navigate, and act on a specific task without hunting for it in a
 * list. The task actions are what make it more than a fancy menu — "complete
 * the automata problem set" is three keystrokes and Enter from anywhere in the
 * app.
 *
 * Registration of the ⌘K shortcut lives here rather than in the shell so the
 * component that owns the dialog also owns the key that opens it, and there is
 * no way to ship one without the other.
 */
import { Command } from 'cmdk';
import {
  ArrowRight,
  Check,
  CircleDot,
  Plus,
  RotateCcw,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { usePlanner } from '@/components/planner/planner-store';
import { NAV_ITEMS } from '@/components/shell/nav-items';
import { Dialog, DialogPortal } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { describeDueDate } from '@/lib/dates';
import { cn, truncate } from '@/lib/utils';

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { tasks, timezone, completeTask, undo, canUndo, resetDemoData, mode } = usePlanner();
  const [query, setQuery] = React.useState('');

  /**
   * Closing clears the search.
   *
   * Done here rather than in an effect watching `open`, because closing is an
   * event and this is the single place it happens. Reacting to the resulting
   * state change in a later render pass would do the same work one render late.
   */
  const changeOpen = React.useCallback(
    (next: boolean) => {
      if (!next) setQuery('');
      onOpenChange(next);
    },
    [onOpenChange],
  );

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // ⌘K on macOS, Ctrl+K elsewhere. Also `/` when the user is not already
      // typing, which is the convention most people try first.
      const isPaletteChord = event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey);
      const isSlash = event.key === '/' && !isEditableTarget(event.target);

      if (isPaletteChord || isSlash) {
        event.preventDefault();
        changeOpen(true);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [changeOpen]);

  const openTasks = React.useMemo(
    () =>
      tasks
        .filter((task) => task.status !== 'completed' && task.status !== 'archived')
        // Capped: past a dozen rows the list is slower to scan than to type
        // through, and cmdk filters what is rendered.
        .slice(0, 60),
    [tasks],
  );

  const run = React.useCallback(
    // `unknown` rather than `void`: most store mutations resolve to the thing
    // they wrote, and the palette does not care about the result.
    (action: () => unknown) => {
      changeOpen(false);
      void action();
    },
    [changeOpen],
  );

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogPortal>
        <DialogPrimitive.Overlay className="anim-overlay bg-ink/30 fixed inset-0 z-50 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className={cn(
            'anim-sheet border-line bg-surface fixed z-50 flex flex-col overflow-hidden border shadow-lg',
            'inset-x-0 bottom-0 max-h-[80vh] rounded-t-xl',
            // Sits above centre on desktop: the eye goes there first, and it
            // leaves the results list room to grow downward.
            'sm:inset-x-auto sm:top-[12vh] sm:bottom-auto sm:left-1/2 sm:max-h-[70vh]',
            'sm:w-[min(36rem,calc(100%-2rem))] sm:-translate-x-1/2 sm:rounded-xl',
          )}
        >
          <VisuallyHidden asChild>
            <DialogPrimitive.Title>Command palette</DialogPrimitive.Title>
          </VisuallyHidden>

          <Command
            // Filtering is cmdk's own substring scoring, which is enough for a
            // list this size and avoids shipping a fuzzy-search dependency.
            label="Command palette"
            className="flex min-h-0 flex-col"
          >
            <div className="border-line border-b px-4">
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search tasks, or jump to a page…"
                className={cn(
                  'text-ink h-14 w-full bg-transparent text-[0.9375rem] outline-none',
                  'placeholder:text-ink-subtle',
                )}
              />
            </div>

            <Command.List className="min-h-0 flex-1 overflow-y-auto p-2">
              <Command.Empty className="text-ink-muted px-3 py-8 text-center text-sm">
                Nothing matches “{truncate(query, 40)}”.
              </Command.Empty>

              <Group heading="Go to">
                {NAV_ITEMS.map((item) => (
                  <Item
                    key={item.href}
                    icon={item.icon}
                    label={item.label}
                    detail={item.description}
                    onSelect={() => run(() => router.push(item.href))}
                  />
                ))}
              </Group>

              <Group heading="Actions">
                <Item
                  icon={Plus}
                  label="Add a task"
                  detail="Opens the capture box on Today"
                  onSelect={() =>
                    run(() => {
                      router.push('/today');
                      // The composer listens for this so the palette does not
                      // need a reference to it across the tree.
                      window.dispatchEvent(new CustomEvent('momentum:focus-composer'));
                    })
                  }
                />
                {canUndo ? (
                  <Item icon={Undo2} label="Undo the last change" onSelect={() => run(undo)} />
                ) : null}
                {mode === 'guest' ? (
                  <Item
                    icon={RotateCcw}
                    label="Reset demo data"
                    detail="Replaces the demo with a fresh, date-relative dataset"
                    onSelect={() => run(resetDemoData)}
                  />
                ) : null}
              </Group>

              {openTasks.length > 0 ? (
                <Group heading="Complete a task">
                  {openTasks.map((task) => (
                    <Item
                      key={task.id}
                      icon={task.status === 'in_progress' ? CircleDot : Check}
                      label={task.title}
                      detail={describeDueDate(task.dueAt, timezone)}
                      onSelect={() => run(() => completeTask(task.id))}
                    />
                  ))}
                </Group>
              ) : null}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className={cn(
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5',
        '[&_[cmdk-group-heading]]:text-[0.6875rem] [&_[cmdk-group-heading]]:font-semibold',
        '[&_[cmdk-group-heading]]:text-ink-subtle [&_[cmdk-group-heading]]:tracking-wide',
        '[&_[cmdk-group-heading]]:uppercase',
      )}
    >
      {children}
    </Command.Group>
  );
}

function Item({
  icon: Icon,
  label,
  detail,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      // `value` includes the detail so "due tomorrow" is searchable, not just
      // the title.
      value={`${label} ${detail ?? ''}`}
      onSelect={onSelect}
      className={cn(
        'text-ink flex cursor-default items-center gap-3 rounded-md px-2.5 py-2 text-sm',
        'data-[selected=true]:bg-surface-hover',
      )}
    >
      <Icon className="text-ink-subtle size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail ? (
        <span className="text-ink-subtle shrink-0 text-xs">{truncate(detail, 28)}</span>
      ) : null}
      <ArrowRight
        className="text-ink-subtle size-3.5 shrink-0 opacity-0 data-[selected=true]:opacity-100"
        aria-hidden
      />
    </Command.Item>
  );
}

/** True when the event came from a field, so `/` types a slash instead. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
