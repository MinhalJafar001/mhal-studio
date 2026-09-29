// Converts site images to right-sized WebP. Run: node scripts/optimize-images.mjs
// Each rule: folder, max width (≈2× the displayed size), and which files to convert.
// Output names are lowercase-kebab .webp; originals are removed (they stay in git history).
import sharp from "sharp";
import { readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";

const RULES = [
  { dir: "public/work", width: 1400 },
  { dir: "public/mockups", width: 640 },
  { dir: "public/services", width: 800 },
  { dir: "public/clients", width: 480, minKB: 50 }, // only the heavy logos
];

const slug = (name) =>
  basename(name, extname(name))
    .toLowerCase()
    .replace(/\(\d+\)/g, "")
    .replace(/\bpng\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

let before = 0;
let after = 0;
for (const { dir, width, minKB = 0 } of RULES) {
  for (const file of readdirSync(dir)) {
    const src = join(dir, file);
    if (!/\.(png|jpe?g)$/i.test(file) || statSync(src).size < minKB * 1024) continue;
    const out = join(dir, `${slug(file)}.webp`);
    if (existsSync(out)) throw new Error(`${out} already exists`);
    const info = await sharp(src).resize({ width, withoutEnlargement: true }).webp({ quality: 80, effort: 6 }).toFile(out);
    before += statSync(src).size;
    after += info.size;
    console.log(`${src} (${Math.round(statSync(src).size / 1024)} KB) → ${out} (${Math.round(info.size / 1024)} KB, ${info.width}×${info.height})`);
    unlinkSync(src);
  }
}
console.log(`\nTotal: ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(2)} MB`);
