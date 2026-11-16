import React from 'react';

import { h, overlayHost, portalize, useOverlayLayer } from './host.js';
import { Section } from './section.js';
import type { Translate } from './copy.js';

function ProjectSkillsEntry({ t, sessionId, sessions, cwd, workspace, dock = false }: any) {
  const [open, setOpen] = React.useState(false);
  const [initialCwd, setInitialCwd] = React.useState<string | null>(null);
  const close = () => setOpen(false);
  useOverlayLayer(open, close);
  const openProjectSkills = () => {
    const sessionCwd = sessions?.list?.getSnapshot?.()?.byId?.[sessionId]?.cwd;
    const current = [sessionCwd, cwd, workspace?.path]
      .find((value) => typeof value === 'string' && value.trim()) || null;
    setInitialCwd(current);
    setOpen(true);
  };
  const button = h('button', {
    type: 'button',
    className: 'dshsc-btn dshsc-project-entry',
    title: t('projectSkills.description'),
    'aria-label': t('projectSkills.title'),
    onClick: openProjectSkills,
  }, t('projectSkills.title'));
  const modal = open
    ? portalize(h('div', {
        className: 'dshsc-overlay',
        onClick: (event: any) => { if (event.target === event.currentTarget) close(); },
      }, h('div', {
        className: 'dshsc-modal dshsc-project-modal',
        role: 'dialog',
        'aria-modal': 'true',
      },
        h('button', {
          className: 'dshsc-modal-close',
          'aria-label': t('action.cancel'),
          onClick: close,
        }, '×'),
        h('h3', null, t('projectSkills.title')),
        h('div', { className: 'dshsc-project-modal-body' },
          h(Section, { t, page: true, initialCwd }),
        ),
      )), overlayHost())
    : null;
  return h('span', {
    className: 'dshsc-project-entry-wrap',
    style: dock ? { order: 1 } : undefined,
  }, button, modal);
}

/** Register project skills directly in the conversation composer. */
export function registerProjectSkillsSurface(ctx: any, t: Translate): (() => void) | null {
  const slots = ctx.get('slots');
  const sessions = ctx.get('sessions');
  if (!slots?.inject || !slots?.register) return null;
  const disposers: Array<(() => void) | undefined> = [];
  disposers.push(slots.inject('conversation.hero.options', () => slots.register({
    name: 'conversation.hero.options',
    id: 'dsh-skills-console:project-entry',
    order: 100,
  }, (props: any) => h(ProjectSkillsEntry, { ...props, t, sessions }))));
  disposers.push(slots.inject('conversation.composer.dock', () => slots.register({
    name: 'conversation.composer.dock',
    id: 'dsh-skills-console:project-entry',
    order: 100,
  }, (props: any) => h(ProjectSkillsEntry, { ...props, t, sessions, dock: true }))));
  return () => { for (const dispose of disposers) { try { dispose?.(); } catch {} } };
}
