export type DirectoryChildDisplayMeta = {
  name: string;
  is_hidden?: boolean;
  is_symlink?: boolean;
  is_package?: boolean;
};

export function macPathLabel(path: string): string {
  return path.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");
}

export function visibleDirectoryChildren<T extends DirectoryChildDisplayMeta>(
  children: T[],
  showHidden: boolean,
): T[] {
  if (showHidden) return children;
  return children.filter((child) => !child.is_hidden);
}

export function directoryChildBadges(child: DirectoryChildDisplayMeta): string[] {
  const badges: string[] = [];
  if (child.is_package) badges.push("Package");
  if (child.is_symlink) badges.push("Alias");
  if (child.is_hidden) badges.push("Hidden");
  return badges;
}
