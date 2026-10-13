import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Case studies: src/content/work/<slug>.md, images in public/work/<slug>/
const work = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/work" }),
  schema: z.object({
    title: z.string(), // headline on the case-study page
    client: z.string(),
    category: z.string(),
    summary: z.string(), // one line, shown on cards
    platform: z.string().optional(),
    cover: z.string(),
    thumb: z.string().optional(), // card image if the cover crops badly (defaults to cover)
    thumbPosition: z.enum(["center", "left", "top"]).default("center"), // which part of the card image to keep
    video: z.string().optional(), // shown in place of the cover on the case-study page, with the cover as its poster

    gallery: z.array(z.object({ src: z.string(), alt: z.string() })).default([]),
    services: z.array(z.string()),
    deliverables: z.array(z.string()).default([]),
    challenge: z.string(), // "The brief"
    process: z.string(), // "What we did"
    results: z.array(z.object({ metric: z.string(), label: z.string() })).default([]), // only real, verifiable numbers
    featured: z.boolean().default(false), // show in the homepage carousel
    order: z.number().default(100),
  }),
});

export const collections = { work };
