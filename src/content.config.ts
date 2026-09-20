import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const work = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/work" }),
  schema: z.object({
    title: z.string(),
    category: z.string(),
    client: z.string(),
    year: z.string(),
    summary: z.string(),
    cover: z.string(),
    services: z.array(z.string()),
    challenge: z.string(),
    process: z.string(),
    results: z.array(z.object({ metric: z.string(), label: z.string() })),
    order: z.number().default(0),
  }),
});

export const collections = { work };