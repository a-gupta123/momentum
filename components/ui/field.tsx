'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import * as React from 'react';

import { cn } from '@/lib/utils';

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'text-ink flex items-center gap-2 text-sm font-medium select-none',
        'peer-disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

export interface FieldProps extends React.ComponentProps<'div'> {
  label: React.ReactNode;
  /** Stable id shared by the label, control and description. */
  htmlFor: string;
  hint?: React.ReactNode;
  error?: string | null;
  optional?: boolean;
}

/**
 * Label + control + hint/error, wired for screen readers.
 *
 * The description and error ids are derived from `htmlFor`, so callers only
 * need to spread `aria-describedby={fieldDescriptionId(id)}` on the control to
 * get a correct accessibility tree. Errors replace hints rather than stacking,
 * which keeps the form from reflowing as the user types.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  className,
  children,
  ...props
}: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)} {...props}>
      <Label htmlFor={htmlFor}>
        {label}
        {optional ? <span className="text-ink-subtle text-xs font-normal">Optional</span> : null}
      </Label>
      {children}
      {error ? (
        <p
          id={fieldErrorId(htmlFor)}
          role="alert"
          className="text-urgent-ink text-xs leading-relaxed"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={fieldDescriptionId(htmlFor)} className="text-ink-subtle text-xs leading-relaxed">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The same framing for a group of controls rather than a single one.
 *
 * A `<label htmlFor>` can only point at one element, so a set of radios or
 * toggles needs a `fieldset`/`legend` instead. Using `Field` here would produce
 * a label pointing at nothing, which reads as an unlabelled group.
 */
export function FieldGroup({
  label,
  hint,
  error,
  className,
  children,
  ...props
}: React.ComponentProps<'fieldset'> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
}) {
  return (
    <fieldset className={cn('flex flex-col gap-1.5 border-0 p-0', className)} {...props}>
      <legend className="text-ink mb-1.5 text-sm font-medium">{label}</legend>
      {children}
      {error ? (
        <p role="alert" className="text-urgent-ink text-xs leading-relaxed">
          {error}
        </p>
      ) : hint ? (
        <p className="text-ink-subtle text-xs leading-relaxed">{hint}</p>
      ) : null}
    </fieldset>
  );
}

export function fieldDescriptionId(id: string): string {
  return `${id}-description`;
}

export function fieldErrorId(id: string): string {
  return `${id}-error`;
}

/** Resolve the right `aria-describedby` for a field that may be in error. */
export function describedBy(id: string, hasError: boolean, hasHint: boolean): string | undefined {
  if (hasError) return fieldErrorId(id);
  if (hasHint) return fieldDescriptionId(id);
  return undefined;
}
