import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { docsLinks } from "./plugins/docs-links.mjs";

// The documentation site is a static build of ../docs, served under
// https://inboxrake.com/docs/ (the deploy PR merges it with the landing
// page and the demo into one tree).
export default defineConfig({
  site: "https://inboxrake.com",
  base: "/docs",
  trailingSlash: "always",
  markdown: { remarkPlugins: [docsLinks] },
  integrations: [
    starlight({
      title: "Inboxrake",
      description:
        "Self-hosted cleanup for a mailbox that piled up: see which senders fill it, then trash, block or unsubscribe in bulk.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/mclgoerg/inboxrake",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/mclgoerg/inboxrake/edit/main/docs/",
      },
      sidebar: [
        { label: "Introduction", slug: "" },
        { label: "Install", slug: "install" },
        { label: "Configuration", slug: "configuration" },
        { label: "Providers & OAuth", slug: "providers" },
        { label: "Filter syntax", slug: "filters" },
        { label: "Features", slug: "features" },
        { label: "Security & privacy", slug: "security" },
        { label: "FAQ", slug: "faq" },
      ],
    }),
  ],
});
