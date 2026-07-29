import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Class-name composer.
 *
 * `clsx` resolves conditionals; `twMerge` resolves Tailwind conflicts so that a
 * later class wins. Without the merge, `cn('p-2', 'p-4')` emits both and the
 * winner depends on CSS source order — which breaks the "pass className to
 * override" pattern every component here relies on.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
