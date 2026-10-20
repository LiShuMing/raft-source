import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import type { Readable } from "node:stream";

export const OFFLINE_HTML_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

// Parse with a browser-compatible HTML parser, never regular expressions over
// markup. Omit active elements entirely, including templates and SVG animation.
const ELEMENTS = new Set((
  "html head body title style main section article header footer nav aside div span p " +
  "h1 h2 h3 h4 h5 h6 a strong em b i u s small sub sup mark br hr pre code blockquote " +
  "ul ol li dl dt dd table thead tbody tfoot tr td th caption colgroup col " +
  "figure figcaption img details summary time abbr kbd samp var wbr " +
  "svg g path rect circle ellipse line polyline polygon text tspan defs marker clipPath linearGradient radialGradient stop"
).split(" "));
const ATTRIBUTES = new Set((
  "id class style title lang dir role width height colspan rowspan scope start reversed open datetime " +
  "alt viewBox preserveAspectRatio x y x1 x2 y1 y2 cx cy r rx ry d points transform " +
  "fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin " +
  "stroke-dasharray opacity font-size font-family text-anchor dominant-baseline " +
  "offset stop-color stop-opacity gradientUnits gradientTransform markerWidth markerHeight refX refY orient " +
  "clip-path marker-start marker-mid marker-end"
).split(" "));

/** Static rendering only: no script, event handler, refresh, form or outbound link. */
export function sanitizeOfflineHtml(html: string): string {
  const document = parse(html);
  const stack: DefaultTreeAdapterMap["parentNode"][] = [document];
  while (stack.length) {
    const parent = stack.pop()!;
    parent.childNodes = parent.childNodes.filter((node) => {
      if (!("tagName" in node)) return node.nodeName === "#text" || node.nodeName === "#documentType";
      if (!ELEMENTS.has(node.tagName)) return false;
      node.attrs = node.attrs.filter((attr) => {
        if (attr.name === "href") return /^#[A-Za-z0-9_.:-]+$/.test(attr.value);
        if (node.tagName === "img" && attr.name === "src") {
          return /^data:image\/(?:png|gif|jpeg|webp|avif);base64,[a-z\d+/=\s]+$/i.test(attr.value);
        }
        return ATTRIBUTES.has(attr.name) || /^aria-[a-z-]+$/.test(attr.name);
      });
      stack.push(node);
      return true;
    });
  }
  const notice = '<p role="note" style="font:14px system-ui;padding:12px;border-bottom:1px solid #ddd">Offline preview: scripts, external resources and navigation are disabled. Download the original file to use its interactive features.</p>';
  return serialize(document).replace(/<body([^>]*)>/, `<body$1>${notice}`);
}

export function offlineHtmlPreviewCsp(frameAncestors: string[]): string {
  return [
    "default-src 'none'", "sandbox", "script-src 'none'",
    "style-src 'unsafe-inline'", "img-src data:", "font-src data:",
    "connect-src 'none'", "frame-src 'none'", "object-src 'none'",
    "base-uri 'none'", "form-action 'none'", "worker-src 'none'",
    `frame-ancestors 'self' ${frameAncestors.join(" ")}`,
  ].join("; ");
}

export async function readOfflineHtmlPreview(stream: Readable): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > OFFLINE_HTML_PREVIEW_MAX_BYTES) {
      stream.destroy();
      return null;
    }
    chunks.push(buffer);
  }
  return sanitizeOfflineHtml(Buffer.concat(chunks).toString("utf8"));
}
