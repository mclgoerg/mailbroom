import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

// The Markdown stays in ../docs (single source, also readable on GitHub).
export const collections = {
  docs: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "../docs" }),
    schema: docsSchema(),
  }),
};
