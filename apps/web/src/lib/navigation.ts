import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  Brain,
  Cable,
  House,
  MessageCircle,
  Mic2,
  MoreHorizontal,
  Radio,
  Settings,
  Smartphone,
  Sparkles,
  Workflow,
} from 'lucide-react';

export type NavigationItem = {
  href: string;
  label: string;
  shortLabel?: string;
  icon: LucideIcon;
  available: boolean;
};

export const desktopNavigation: NavigationItem[] = [
  { href: '/', label: 'Home', icon: House, available: true },
  { href: '/chat', label: 'Chat', icon: MessageCircle, available: true },
  { href: '/memory', label: 'Memory', icon: Brain, available: false },
  { href: '/eko', label: 'Eko', icon: Radio, available: false },
  { href: '/connections', label: 'Connections', icon: Cable, available: true },
  { href: '/devices', label: 'Devices', icon: Smartphone, available: false },
  { href: '/automations', label: 'Automations', icon: Workflow, available: false },
  { href: '/usage', label: 'Usage', icon: Sparkles, available: true },
  { href: '/settings', label: 'Settings', icon: Settings, available: true },
];

export const mobileNavigation: NavigationItem[] = [
  { href: '/', label: 'Home', icon: House, available: true },
  { href: '/chat', label: 'Chat', icon: MessageCircle, available: true },
  { href: '/chat?mode=voice', label: 'Voice', icon: Mic2, available: true },
  { href: '/memory', label: 'Memory', icon: Brain, available: false },
  { href: '/settings', label: 'More', icon: MoreHorizontal, available: true },
];

export const productMark = { label: 'NOX', icon: Bot };
