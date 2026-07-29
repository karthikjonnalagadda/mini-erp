/**
 * Navigation manifest.
 *
 * The sidebar, the route guards and the mobile menu all read from this one
 * array. Declaring a screen's path, icon and required roles in a single place
 * means a nav item can never appear for a role that the router will then reject
 * — a class of bug that is invisible in review and infuriating in use.
 */
import {
  BarChart3,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Package,
  ScrollText,
  Users,
  Warehouse,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { RoleName } from '@/types/api.types';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** `undefined` means every authenticated role may see it. */
  roles?: RoleName[];
  /** Short description used in the mobile menu and command palette. */
  description?: string;
}

export interface NavSection {
  heading: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    heading: 'Overview',
    items: [
      {
        label: 'Dashboard',
        path: '/dashboard',
        icon: LayoutDashboard,
        description: 'Operational metrics at a glance',
      },
    ],
  },
  {
    heading: 'Sales & CRM',
    items: [
      {
        label: 'Customers',
        path: '/customers',
        icon: Users,
        description: 'Accounts, follow-ups and activity',
      },
      {
        label: 'Sales Challans',
        path: '/challans',
        icon: FileText,
        description: 'Delivery documents and dispatch',
      },
    ],
  },
  {
    heading: 'Inventory',
    items: [
      {
        label: 'Products',
        path: '/products',
        icon: Package,
        description: 'Catalogue and pricing',
      },
      {
        label: 'Inventory',
        path: '/inventory',
        icon: Warehouse,
        description: 'Stock levels and adjustments',
      },
      {
        label: 'Stock Movements',
        path: '/stock-movements',
        icon: ClipboardList,
        description: 'Append-only inventory ledger',
      },
    ],
  },
  {
    heading: 'Administration',
    items: [
      {
        label: 'Audit Logs',
        path: '/audit-logs',
        icon: ScrollText,
        // Matches RolePolicy.VIEW_AUDIT_LOGS on the backend.
        roles: ['ADMIN', 'ACCOUNTS'],
        description: 'Compliance trail',
      },
      {
        label: 'Users',
        path: '/users',
        icon: BarChart3,
        roles: ['ADMIN'],
        description: 'Accounts and role assignment',
      },
    ],
  },
];

/** Filters the manifest to the sections a role can actually reach. */
export const navSectionsForRole = (role: RoleName | undefined): NavSection[] => {
  if (!role) return [];

  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.roles || item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);
};

/** Flat lookup used by route guards and the page-title resolver. */
export const findNavItem = (pathname: string): NavItem | undefined =>
  NAV_SECTIONS.flatMap((section) => section.items).find(
    (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
  );
