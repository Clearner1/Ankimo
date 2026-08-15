export type TagTreeNode = { _children?: Record<string, TagTreeNode> };
export type TagTree = Record<string, TagTreeNode>;

export function filterTagPaths(tags: readonly string[], search: string) {
  const query = search.trim().toLowerCase();
  return query ? tags.filter((tag) => tag.toLowerCase().includes(query)) : [...tags];
}

export function buildTagTree(tags: readonly string[]): TagTree {
  const root: TagTreeNode = {};
  for (const tag of tags) {
    let current = root;
    for (const part of tag.split('::')) {
      current._children ||= {};
      current._children[part] ||= {};
      current = current._children[part];
    }
  }
  return root._children || {};
}
