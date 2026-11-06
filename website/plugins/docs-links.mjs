const REPO = "https://github.com/mclgoerg/inboxrake/blob/main/";

function visitLinks(node, fn) {
  if (node.type === "link") fn(node);
  for (const child of node.children ?? []) visitLinks(child, fn);
}

/**
 * Remark plugin that lets docs/*.md read well on GitHub AND on the site:
 *  - drops the leading `# H1` (Starlight renders the frontmatter title),
 *  - `page.md#x` -> the page's site URL,
 *  - `../path` (outside docs/) -> the file on GitHub.
 */
export function docsLinks() {
  return (tree, file) => {
    const base = "/docs/";
    const first = tree.children.findIndex(
      (n) => n.type === "heading" && n.depth === 1,
    );
    if (first === 0) tree.children.splice(0, 1);

    visitLinks(tree, (node) => {
      const url = node.url;
      if (/^([a-z]+:|#|\/)/i.test(url)) return;
      if (url.startsWith("../")) {
        node.url = REPO + url.replace(/^(\.\.\/)+/, "");
        return;
      }
      const m = url.match(/^([\w-]+)\.md(#.*)?$/);
      if (m) {
        const slug = m[1] === "index" ? "" : `${m[1]}/`;
        node.url = `${base}${slug}${m[2] ?? ""}`;
      }
    });
  };
}
