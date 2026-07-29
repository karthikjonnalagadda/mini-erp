/**
 * Application sidebar.
 *
 * One component serves both breakpoints: a fixed rail on desktop, and an
 * off-canvas drawer on mobile driven by the same markup. Duplicating it as two
 * components is how a nav item ends up on one and not the other.
 */
import * as React from 'react';
import { NavLink } from 'react-router-dom';
import { Boxes, X } from 'lucide-react';

import { useAuth } from '@/context/auth-context';
import { navSectionsForRole } from '@/routes/navigation';
import { cn } from '@/utils/cn';

export interface SidebarProps {
  /** Mobile drawer visibility. Ignored at desktop widths. */
  isOpen: boolean;
  onClose: () => void;
}

const NavItemLink = ({
  to,
  icon: Icon,
  label,
  onNavigate,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onNavigate: () => void;
}): React.JSX.Element => (
  <NavLink
    to={to}
    onClick={onNavigate}
    className={({ isActive }) =>
      cn(
        'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-sidebar-accent text-white shadow-sm'
          : 'text-sidebar-foreground hover:bg-white/6 hover:text-white',
      )
    }
  >
    {({ isActive }) => (
      <>
        <Icon
          className={cn(
            'size-4 shrink-0 transition-colors',
            isActive ? 'text-white' : 'text-sidebar-foreground/70 group-hover:text-white',
          )}
        />
        <span className="truncate">{label}</span>
      </>
    )}
  </NavLink>
);

export const Sidebar = ({ isOpen, onClose }: SidebarProps): React.JSX.Element => {
  const { user } = useAuth();
  const sections = React.useMemo(() => navSectionsForRole(user?.role.name), [user?.role.name]);

  return (
    <>
      {/* Mobile scrim. `aria-hidden` because the drawer itself is the
          interactive element; the scrim is a click target only. */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-[1px] transition-opacity lg:hidden',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar transition-transform duration-200 ease-out',
          // Off-canvas below lg, always visible from lg upward.
          isOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0',
        )}
        aria-label="Main navigation"
      >
        {/* Brand */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-accent">
              <Boxes className="size-4.5 text-white" aria-hidden="true" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-white">Mini ERP</p>
              <p className="text-[0.65rem] uppercase tracking-wider text-sidebar-foreground/60">
                Operations Portal
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-sidebar-foreground hover:bg-white/8 hover:text-white lg:hidden"
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Close navigation</span>
          </button>
        </div>

        {/* Sections */}
        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
          {sections.map((section) => (
            <div key={section.heading}>
              <p className="mb-1.5 px-3 text-[0.65rem] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
                {section.heading}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavItemLink
                    key={item.path}
                    to={item.path}
                    icon={item.icon}
                    label={item.label}
                    onNavigate={onClose}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Role footer — orients the user in a multi-role system. */}
        {user && (
          <div className="shrink-0 border-t border-sidebar-border p-3">
            <div className="rounded-md bg-white/5 px-3 py-2">
              <p className="truncate text-xs font-medium text-white">{user.fullName}</p>
              <p className="mt-0.5 text-[0.65rem] uppercase tracking-wide text-sidebar-foreground/60">
                {user.role.name}
              </p>
            </div>
          </div>
        )}
      </aside>
    </>
  );
};
