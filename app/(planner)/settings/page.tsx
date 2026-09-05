'use client';

/**
 * Settings.
 *
 * Almost everything here is an input to the scheduler or the ranking engine,
 * not a preference. So each control says what it will change — "the scheduler
 * will not place work outside this window" is a useful label; "Workday" is not.
 *
 * The destructive controls live at the bottom behind a confirmation, and the
 * guest-mode section is honest about where the data actually lives. Somebody
 * evaluating this app deserves to know their demo data is in `localStorage`
 * before they spend an hour populating it.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Check, Database, HardDrive, RotateCcw } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { usePlanner } from '@/components/planner/planner-store';
import { PageContainer, PageHeader, Section } from '@/components/shell/page-header';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, describedBy } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { detectTimezone, formatDuration, isValidTimezone } from '@/lib/dates';
import { settingsFormSchema, type SettingsFormValues } from '@/lib/validation/forms';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const planner = usePlanner();

  if (planner.status === 'loading' || !planner.profile) return <SettingsSkeleton />;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Settings"
        title="How Momentum plans for you"
        description="These are inputs to the scheduler, not decoration. Changing your workday changes tomorrow's plan."
      />

      <SettingsForm key={planner.profile.updatedAt} />

      <Section title="Appearance">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5">
            <div>
              <p className="text-ink text-sm font-medium">Theme</p>
              <p className="text-ink-subtle text-xs">
                Follows your system by default. Both themes are designed, not inverted.
              </p>
            </div>
            <ThemeToggle />
          </CardContent>
        </Card>
      </Section>

      <StorageSection />
    </PageContainer>
  );
}

function SettingsForm() {
  const { profile, updateProfile, capabilities } = usePlanner();

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    mode: 'onBlur',
    defaultValues: {
      displayName: profile?.displayName ?? '',
      timezone: profile?.timezone ?? detectTimezone(),
      workdayStart: profile?.workdayStart ?? '09:00',
      workdayEnd: profile?.workdayEnd ?? '17:30',
      highEnergyStart: profile?.highEnergyStart ?? '09:00',
      highEnergyEnd: profile?.highEnergyEnd ?? '12:00',
      defaultTaskDurationMinutes: profile?.defaultTaskDurationMinutes ?? 30,
      breakMinutes: profile?.breakMinutes ?? 10,
      aiAssistEnabled: profile?.aiAssistEnabled ?? true,
      confirmAllActions: profile?.confirmAllActions ?? false,
      splitLongTasks: profile?.splitLongTasks ?? true,
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const parsed = settingsFormSchema.parse(values);

    if (!isValidTimezone(parsed.timezone)) {
      form.setError('timezone', { message: 'That timezone is not one this browser recognises' });
      return;
    }

    const saved = await updateProfile(parsed);
    if (saved) {
      toast.success('Settings saved.');
      form.reset(parsed);
    }
  });

  const errors = form.formState.errors;
  const isDirty = form.formState.isDirty;

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <Section title="You">
        <Card>
          <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
            <Field label="Display name" htmlFor="display-name" error={errors.displayName?.message}>
              <Input
                id="display-name"
                autoComplete="name"
                aria-invalid={Boolean(errors.displayName) || undefined}
                {...form.register('displayName')}
              />
            </Field>

            <Field
              label="Timezone"
              htmlFor="timezone"
              hint="Every deadline and time block is interpreted in this zone."
              error={errors.timezone?.message}
            >
              <div className="flex gap-2">
                <Input
                  id="timezone"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(errors.timezone) || undefined}
                  aria-describedby={describedBy('timezone', Boolean(errors.timezone), true)}
                  {...form.register('timezone')}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => form.setValue('timezone', detectTimezone(), { shouldDirty: true })}
                >
                  Detect
                </Button>
              </div>
            </Field>
          </CardContent>
        </Card>
      </Section>

      <Section
        title="Your day"
        description="The window the scheduler is allowed to place work in, and how it paces you through it."
      >
        <Card>
          <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
            <Field
              label="Workday starts"
              htmlFor="workday-start"
              error={errors.workdayStart?.message}
            >
              <Input id="workday-start" type="time" {...form.register('workdayStart')} />
            </Field>

            <Field
              label="Workday ends"
              htmlFor="workday-end"
              error={errors.workdayEnd?.message}
              hint="An end past midnight is allowed for night shifts."
            >
              <Input id="workday-end" type="time" {...form.register('workdayEnd')} />
            </Field>

            <Field
              label="High-energy window starts"
              htmlFor="energy-start"
              error={errors.highEnergyStart?.message}
              hint="High-effort tasks are placed here first."
            >
              <Input id="energy-start" type="time" {...form.register('highEnergyStart')} />
            </Field>

            <Field
              label="High-energy window ends"
              htmlFor="energy-end"
              error={errors.highEnergyEnd?.message}
            >
              <Input id="energy-end" type="time" {...form.register('highEnergyEnd')} />
            </Field>

            <Field
              label="Default task length"
              htmlFor="default-duration"
              hint="Used when you do not give an estimate."
              error={errors.defaultTaskDurationMinutes?.message}
            >
              <Input
                id="default-duration"
                type="number"
                inputMode="numeric"
                min={5}
                step={5}
                className="tabular-nums"
                {...form.register('defaultTaskDurationMinutes')}
              />
            </Field>

            <Field
              label="Break between blocks"
              htmlFor="break-minutes"
              hint="Minutes of breathing room inserted between consecutive tasks."
              error={errors.breakMinutes?.message}
            >
              <Input
                id="break-minutes"
                type="number"
                inputMode="numeric"
                min={0}
                step={5}
                className="tabular-nums"
                {...form.register('breakMinutes')}
              />
            </Field>
          </CardContent>
        </Card>
      </Section>

      <Section title="Assistant and scheduling">
        <Card>
          <CardContent className="pt-5">
            <FieldGroup label="Behaviour" className="gap-0">
              <ToggleRow
                id="ai-assist"
                label="Use AI to interpret what you type"
                description={
                  capabilities.aiAssistAvailable
                    ? 'Off means the deterministic parser handles everything. It is slower to teach but never surprises you.'
                    : 'No API key is configured on this deployment, so the deterministic parser is always used.'
                }
                checked={form.watch('aiAssistEnabled')}
                disabled={!capabilities.aiAssistAvailable}
                onCheckedChange={(checked) =>
                  form.setValue('aiAssistEnabled', checked, { shouldDirty: true })
                }
              />
              <ToggleRow
                id="confirm-all"
                label="Confirm every proposed action"
                description="On by default for anything destructive. Turn this on to review creations too."
                checked={form.watch('confirmAllActions')}
                onCheckedChange={(checked) =>
                  form.setValue('confirmAllActions', checked, { shouldDirty: true })
                }
              />
              <ToggleRow
                id="split-tasks"
                label="Split long tasks across the day"
                description="Lets the scheduler break a three-hour task into chunks when no single gap is long enough."
                checked={form.watch('splitLongTasks')}
                onCheckedChange={(checked) =>
                  form.setValue('splitLongTasks', checked, { shouldDirty: true })
                }
              />
            </FieldGroup>
          </CardContent>
        </Card>
      </Section>

      {/* Sticky so the save control is reachable without scrolling back up
          from the bottom of a long form on a phone. */}
      <div
        className={cn(
          'sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 lg:bottom-4',
          'border-line flex items-center justify-end gap-3 rounded-lg border',
          'bg-surface-raised/90 px-4 py-3 shadow-md backdrop-blur-sm',
        )}
      >
        <p className="text-ink-subtle mr-auto text-xs" aria-live="polite">
          {isDirty ? 'Unsaved changes' : 'All changes saved'}
        </p>
        {isDirty ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => form.reset()}>
            Discard
          </Button>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!isDirty || form.formState.isSubmitting}
        >
          <Check className="size-3.5" aria-hidden />
          Save settings
        </Button>
      </div>
    </form>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const descriptionId = `${id}-description`;

  return (
    <div
      className={cn(
        'border-line-subtle flex items-start justify-between gap-4 border-b py-3.5 last:border-0',
        disabled && 'opacity-60',
      )}
    >
      <div className="min-w-0">
        <label htmlFor={id} className="text-ink text-sm font-medium">
          {label}
        </label>
        <p id={descriptionId} className="text-ink-subtle mt-0.5 text-xs leading-relaxed">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={descriptionId}
        onCheckedChange={onCheckedChange}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}

/** Where the data lives, and the controls for throwing it away. */
function StorageSection() {
  const { mode, isDurable, resetDemoData, tasks, goals } = usePlanner();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [isResetting, setIsResetting] = React.useState(false);

  const isGuest = mode === 'guest';

  return (
    <Section title="Your data">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isGuest ? (
              <HardDrive className="text-ink-subtle size-4" aria-hidden />
            ) : (
              <Database className="text-ink-subtle size-4" aria-hidden />
            )}
            {isGuest ? 'Guest demo' : 'Your account'}
            <Badge tone={isGuest ? 'warning' : 'success'}>{isGuest ? 'Local' : 'Synced'}</Badge>
          </CardTitle>
          <CardDescription>
            {isGuest ? (
              <>
                Everything you do is stored in this browser&rsquo;s local storage. It never leaves
                your device, and it will not follow you to another browser.
                {!isDurable ? (
                  <span className="text-warning-ink mt-1.5 flex items-start gap-1.5">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    Storage is unavailable here, likely a private window. Your changes will be lost
                    when you close the tab.
                  </span>
                ) : null}
              </>
            ) : (
              'Stored in Postgres with row-level security, so your rows are unreadable to every other account.'
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <dl className="text-ink-subtle flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <div className="flex items-baseline gap-1.5">
              <dt>Tasks</dt>
              <dd className="text-ink-muted font-medium tabular-nums">{tasks.length}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt>Goals</dt>
              <dd className="text-ink-muted font-medium tabular-nums">{goals.length}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt>Estimated work on the books</dt>
              <dd className="text-ink-muted font-medium tabular-nums">
                {formatDuration(
                  tasks
                    .filter((task) => task.status !== 'completed' && task.archivedAt === null)
                    .reduce((sum, task) => sum + task.durationMinutes, 0),
                )}
              </dd>
            </div>
          </dl>

          {isGuest ? (
            <Button variant="outlineDanger" size="sm" onClick={() => setConfirmOpen(true)}>
              <RotateCcw className="size-3.5" aria-hidden />
              Reset demo data
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset the demo?</DialogTitle>
            <DialogDescription>
              This deletes every task, goal and plan in this browser and reloads the sample dataset.
              It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Keep my data
            </Button>
            <Button
              variant="danger"
              loading={isResetting}
              onClick={async () => {
                setIsResetting(true);
                try {
                  await resetDemoData();
                  toast.success('Demo data reset.');
                  setConfirmOpen(false);
                } finally {
                  setIsResetting(false);
                }
              }}
            >
              Reset everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function SettingsSkeleton() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-72" />
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </PageContainer>
  );
}
