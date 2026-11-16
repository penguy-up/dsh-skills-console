import { h } from './host.js';
import { Section } from './section.js';
import type { Translate } from './copy.js';

export const PROJECT_TAB_ID = 'dsh-skills-console:project';

/** 注册到 dsh-better-sidebar「开始」页的项目技能页面。 */
export function registerProjectSkillsSurface(ctx: any, t: Translate): (() => void) | null {
  const betterSidebar = ctx.get('betterSidebar');
  if (!betterSidebar?.registerTab) return null;
  return betterSidebar.registerTab({
    id: PROJECT_TAB_ID,
    title: () => t('projectSkills.title'),
    description: () => t('projectSkills.description'),
    order: 45,
    single: true,
    icon: h('span', { 'aria-hidden': 'true', style: { display: 'grid', placeItems: 'center', width: 22, height: 22, color: 'var(--dsw-alias-brand-primary)', fontSize: 18 } }, '⌘'),
    component: ({ scope }: any) => h(Section, {
      t,
      page: true,
      initialCwd: scope?.cwd || null,
    }),
  });
}
