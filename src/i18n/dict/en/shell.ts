import type { shell as Ru } from '../ru/shell';
import type { Translation } from '../types';

export const shell: Translation<typeof Ru> = {
  'shell.panel.show': 'Show sidebar',
  'shell.panel.hide': 'Hide sidebar',
  'shell.panel.pin': 'Pin sidebar',
  'shell.panel.search': 'Search',
  'shell.panel.width': 'Sidebar width',
  'shell.panel.withCount': '{label}, tasks: {n}',
  'shell.user.menu': 'User menu',
  'shell.user.profile': 'Profile',
  'shell.user.logout': 'Sign out',
  'shell.user.name': 'Name',
  'shell.user.role': 'Role',
  'shell.user.portal': 'Portal',
  'shell.lang.label': 'Language',
  'shell.title.staff': 'MIG',
  'shell.title.assist': 'MIG · Assistance',
  'shell.title.clinic': 'MIG · Clinic',
  'shell.title.hr': 'MIG · Company',
  'shell.portal.staff': 'MIG staff portal',
  'shell.portal.assist': 'Assistance portal',
  'shell.portal.clinic': 'Clinic portal',
  'shell.portal.hr': 'HR portal',
};
