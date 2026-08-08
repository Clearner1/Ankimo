export type TagTreeNode = { _children?: Record<string, TagTreeNode> };
export type TagTree = Record<string, TagTreeNode>;

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
