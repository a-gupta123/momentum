'use client';

import { CloudOff, Database, Sparkles, Wand2 } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { usePlanner } from '@/components/planner/planner-store';
import { Badge } from '@/components/ui/badge';
import { Hint } from '@/components/ui/tooltip';

/**
 * Says exactly which mode the app is running in.
 *
 * This is not decoration. Guest Demo keeps data in one browser, and somebody
 * who spends an hour planning their week deserves to know that *before* they
 * lose it — so the badge is always visible, states where the data lives, and
 * links to sign-in when an account is actually available.
 *
 * It also reports which interpreter is running. A deployment with no API key
 * still parses natural language, just deterministically, and labelling that
 * honestly is better than implying an AI that is not there.
 */
export function ModeBadge() {
  const { mode, isDurable, capabilities, profile } = usePlanner();

  const aiActive = capabilities.aiAssistAvailable && (profile?.aiAssistEnabled ?? true);

  return (
    <div className="space-y-2 px-1">
      {mode === 'guest' ? (
        <div className="space-y-1.5">
          <Hint
            label={
              isDurable
                ? 'Your demo data is saved in this browser only. It is never sent to a server.'
                : 'This browser will not let Momentum save locally, so changes last for this session only.'
            }
            side="right"
          >
            <Badge tone={isDurable ? 'primary' : 'warning'} className="cursor-default">
              {isDurable ? (
                <Database className="size-3" aria-hidden />
              ) : (
                <CloudOff className="size-3" aria-hidden />
              )}
              {isDurable ? 'Guest demo' : 'Session only'}
            </Badge>
          </Hint>

          {capabilities.authAvailable ? (
            <p className="text-ink-subtle text-[0.6875rem] leading-relaxed">
              <Link href="/signin" className="text-primary underline-offset-2 hover:underline">
                Sign in
              </Link>{' '}
              to keep this across devices.
            </p>
          ) : (
            <p className="text-ink-subtle text-[0.6875rem] leading-relaxed">
              Data stays in this browser.
            </p>
          )}
        </div>
      ) : null}

      <Hint
        label={
          aiActive
            ? 'Your notes are interpreted by an AI model. Nothing is saved until you confirm the preview.'
            : 'Your notes are interpreted by the built-in deterministic parser. No data leaves this deployment.'
        }
        side="right"
      >
        <Badge tone={aiActive ? 'success' : 'neutral'} className="cursor-default">
          {aiActive ? (
            <Sparkles className="size-3" aria-hidden />
          ) : (
            <Wand2 className="size-3" aria-hidden />
          )}
          {aiActive ? 'AI assist on' : 'Deterministic parsing'}
        </Badge>
      </Hint>
    </div>
  );
}
