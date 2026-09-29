/** Canonical public destinations shared by the full header and mobile menu. */
export type NavigationLink = {
  href: string;
  label: string;
  description?: string;
};

export const primaryNavigation = [
  { href: '/product', label: 'Product' },
  { href: '/features', label: 'Features' },
  { href: '/docs', label: 'Docs' },
] as const satisfies readonly NavigationLink[];

export const navigationGroups = [
  {
    id: 'learn-menu',
    label: 'Learn',
    links: [
      { href: '/learn', label: 'Learning hub', description: 'Guides and learning paths' },
      { href: '/learn/tutorials', label: 'Tutorials', description: 'Step-by-step lessons' },
      {
        href: '/learn/examples',
        label: 'Examples',
        description: 'See Varve workflows in practice',
      },
      {
        href: '/learn/community',
        label: 'Community',
        description: 'Meet and learn with other creators',
      },
    ],
  },
  {
    id: 'support-menu',
    label: 'Support',
    links: [
      { href: '/support', label: 'Support home', description: 'Find help and support options' },
      { href: '/support/faq', label: 'FAQ', description: 'Quick answers to common questions' },
      {
        href: '/support/troubleshooting',
        label: 'Troubleshooting',
        description: 'Resolve common problems',
      },
      {
        href: '/support/known-issues',
        label: 'Known issues',
        description: 'Current limitations and workarounds',
      },
      {
        href: '/support/report-issue',
        label: 'Report an issue',
        description: 'Share a reproducible problem',
      },
      { href: '/contact', label: 'Contact', description: 'Talk with the Varve team' },
    ],
  },
] as const satisfies readonly {
  id: string;
  label: string;
  links: readonly NavigationLink[];
}[];

export const allNavigationLinks: readonly NavigationLink[] = [
  ...primaryNavigation,
  ...navigationGroups.flatMap((group): NavigationLink[] =>
    group.links.map((link) => ({ ...link })),
  ),
];

/** Route equality ignores only trailing slashes, so a parent never impersonates its child. */
export function isExactNavigationRoute(pathname: string, href: string): boolean {
  const normalize = (path: string) => path.replace(/\/+$/, '') || '/';
  return normalize(pathname) === normalize(href);
}

/** A section can be indicated when any of its routes is active, without claiming the page. */
export function isNavigationSectionActive(
  pathname: string,
  links: readonly NavigationLink[],
): boolean {
  const normalize = (path: string) => path.replace(/\/+$/, '') || '/';
  const current = normalize(pathname);
  return links.some(({ href }) => {
    const route = normalize(href);
    return current === route || (route !== '/' && current.startsWith(`${route}/`));
  });
}
