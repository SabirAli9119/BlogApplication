import sanitizeHtml from "sanitize-html";
import { env } from "../config/env.js";

// Images may only come from OUR storage (no tracking pixels or hotlinked content).
const allowedImagePrefixes = () => {
  const prefixes = [`${env.serverUrl}/uploads/`];
  if (env.cloudinary.cloudName) {
    prefixes.push(`https://res.cloudinary.com/${env.cloudinary.cloudName}/image/upload/`);
  }
  return prefixes;
};

export const isOwnImageUrl = (src = "") => allowedImagePrefixes().some((p) => src.startsWith(p));

// Matches what the TipTap editor produces. Anything not listed here is removed.
const CONTENT_OPTIONS = {
  allowedTags: [
    "p", "br", "hr", "h1", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s",
    "code", "pre", "blockquote", "ul", "ol", "li", "a", "img",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    code: ["class"],
  },
  allowedClasses: { code: ["language-*"] }, // syntax highlighting class only
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer nofollow ugc" }),
  },
  exclusiveFilter: (frame) => frame.tag === "img" && !isOwnImageUrl(frame.attribs.src),
};

export const sanitizeContent = (html = "") => sanitizeHtml(html, CONTENT_OPTIONS);

// For titles, descriptions, tags: plain text only, no markup at all.
export const toPlainText = (html = "") =>
  sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&lt;|&gt;/g, "") // never turn entities back into < or >
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();