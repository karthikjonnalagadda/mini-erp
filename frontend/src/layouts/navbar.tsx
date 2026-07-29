/**
 * Top navigation bar.
 *
 * Holds the mobile menu trigger, the current page title, the theme toggle and
 * the account menu. The page title is derived from the route manifest rather
 * than passed down as a prop from every page — one less thing for a new screen
 * to forget.
 */
import * as React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { LogOut, Menu, Moon, Sun, User as UserIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/auth-context';
import { useTheme } from '@/context/theme-context';
import { toast } from '@/hooks/use-toast';
import { findNavItem } from '@/routes/navigation';
import { cn } from '@/utils/cn';
import { initialsOf } from '@/utils/format';

export interface NavbarProps {
  onMenuToggle: () => void;
}

export const Navbar = ({ onMenuToggle }: NavbarProps): React.JSX.Element => {
  const { user, logout } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const pageTitle = findNavItem(location.pathname)?.label ?? 'Workspace';

  const handleLogout = async (): Promise<void> => {
    await logout();
    toast.success('Signed out', 'You have been signed out successfully.');
    navigate('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/70">
      <Button
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        onClick={onMenuToggle}
        aria-label="Open navigation"
      >
        <Menu aria-hidden="true" />
      </Button>

      {/* `aria-live` so a screen reader announces navigation in this SPA, which
          has no full page load to trigger the usual announcement. */}
      <h1 className="truncate text-sm font-semibold text-foreground" aria-live="polite">
        {pageTitle}
      </h1>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleTheme}
          aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="size-4" aria-hidden="true" />
          ) : (
            <Moon className="size-4" aria-hidden="true" />
          )}
        </Button>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className={cn(
                'flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-primary text-[0.7rem] font-semibold text-primary-foreground">
                {initialsOf(user?.fullName)}
              </span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-xs font-medium text-foreground">{user?.firstName}</span>
                <span className="block text-[0.65rem] text-muted-foreground">
                  {user?.role.name}
                </span>
              </span>
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={8}
              className="z-50 min-w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-popover data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
            >
              <div className="px-2 py-2">
                <p className="truncate text-sm font-medium">{user?.fullName}</p>
                <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
              </div>

              <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-border" />

              <DropdownMenu.Item asChild>
                <Link
                  to="/profile"
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground"
                >
                  <UserIcon className="size-4" aria-hidden="true" />
                  Profile &amp; security
                </Link>
              </DropdownMenu.Item>

              <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-border" />

              <DropdownMenu.Item
                onSelect={(event) => {
                  // Radix closes the menu synchronously on select; preventing
                  // the default keeps focus sane while the async logout runs.
                  event.preventDefault();
                  void handleLogout();
                }}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-none focus:bg-destructive/10"
              >
                <LogOut className="size-4" aria-hidden="true" />
                Sign out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
};
