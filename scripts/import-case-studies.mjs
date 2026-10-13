// One-off import of curated case-study images from the "All Projects" folder.
// Each project gets public/work/<slug>/cover.webp plus 01.webp, 02.webp… (right-sized WebP).
// Usage: node scripts/import-case-studies.mjs "<path to All Projects>"
import sharp from "sharp";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root || !existsSync(root)) throw new Error("Pass the path to the All Projects folder");

const PROJECTS = {
  "curated-kitchens-bath": { dir: "Curated Kitchens & Bath", cover: "curated-kitchens.png", gallery: ["Logo/Curated Logo ff (6).png", "Business Cards/Visiting cards ff-01.png", "Yard Sign/Yard sign ff.png", "Door Hanger/doorhanger ff Front.png"] },
  "dreamerce": { dir: "Dreamerce Static Ads", cover: "1.png", gallery: ["Fifth ray/Frame 151.png", "Fifth ray/Frame 152.png", "Fifth ray/Frame 157.png", "Fifth ray/Frame 160.png"] },
  "join-real": { dir: "Join Real", cover: "P1.png", gallery: ["P2.png", "P3.png", "D1.png"] },
  "keynest": { dir: "Key Nest", cover: "P2.png", gallery: ["P1.png", "P3.png", "D4.png"] },
  "kids-studio": { dir: "Kids Studio Web Design", cover: "kids-studio.png", gallery: ["1.png", "5.png"] },
  "pictory": { dir: "Pictory", cover: "2.png", gallery: ["1.png", "3.png"] },
  "profound-publishers": { dir: "Profound Publishers", cover: "5.png", gallery: ["4.png", "6.png", "7.png"] },
  "prospeqt": { dir: "Prospeqt", cover: "P1.png", gallery: ["3.png", "P4.PNG", "P3.png"] },
  "revive-real-estate": { dir: "Revive", cover: "6.png", gallery: ["2.png", "4.png", "PaidMedia-Meta-RTStay-Mess1-1080x1080-a.png", "PaidMedia-Meta-RTStay-Mess5-1080x1080-a.png"] },
  "scoop-analytics": { dir: "Scoop Analytics", cover: "4.png", gallery: ["6.png", "8.png", "kizgo22mk0tipm0wfst5.webp"] },
  "sterling-accountant-hub": { dir: "Sterling Accountand Hub", cover: "1.png", gallery: ["5.png", "4.png", "3.png"] },
};

const save = async (src, out, width) => {
  const info = await sharp(src).resize({ width, withoutEnlargement: true }).webp({ quality: 82, effort: 6 }).toFile(out);
  return `${Math.round(info.size / 1024)} KB ${info.width}×${info.height}`;
};

for (const [slug, p] of Object.entries(PROJECTS)) {
  const dest = join("public/work", slug);
  mkdirSync(dest, { recursive: true });
  const base = join(root, p.dir);
  console.log(`${slug}: cover ${await save(join(base, p.cover), join(dest, "cover.webp"), 1600)}`);
  for (const [i, file] of p.gallery.entries()) {
    const name = String(i + 1).padStart(2, "0");
    console.log(`  ${name}: ${await save(join(base, file), join(dest, `${name}.webp`), 1600)}`);
  }
}
