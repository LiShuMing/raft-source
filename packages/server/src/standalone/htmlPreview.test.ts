import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { parse } from "parse5";
import { sanitizeOfflineHtml, readOfflineHtmlPreview, OFFLINE_HTML_PREVIEW_MAX_BYTES, offlineHtmlPreviewCsp } from "./htmlPreview";

test("offline previews preserve report content and remove script, navigation and remote attributes", () => {
  const html = sanitizeOfflineHtml(`<!doctype html><html><head>
    <meta http-equiv="refresh" content="0;url=https://audit.invalid/leak">
    <base href="https://audit.invalid/"><link rel="stylesheet" href="https://audit.invalid/x.css">
    <style>body{color:#123}</style></head><body onload="location='https://audit.invalid'">
    <script>location='https://audit.invalid'</script><iframe src="https://audit.invalid"></iframe>
    <a href="https://audit.invalid" ping="https://audit.invalid" target="_blank">Report</a>
    <a href="#summary">Summary</a><h1 id="summary">Analysis &amp; results</h1>
    <img src="https://audit.invalid" srcset="https://audit.invalid 2x" onerror="alert(1)">
    <form action="https://audit.invalid"><input name="secret"></form>
    <svg><a href="javascript:alert(1)"><text>Graph</text></a><set attributeName="href" to="https://audit.invalid"/></svg>
    <template><script>alert(1)</script></template></body></html>`);
  assert.doesNotMatch(html, /audit\.invalid|<script|<meta|<base|<link|<iframe|<form|<input|<template|<set\b|onload=|onerror=|ping=|srcset=|javascript:/i);
  assert.match(html, /<h1 id="summary">Analysis &amp; results<\/h1>/);
  assert.match(html, /href="#summary"/);
  assert.match(html, /<style>body\{color:#123\}<\/style>/);
  assert.match(html, /<text>Graph<\/text>/);
  assert.match(html, /Offline preview:/);
});

test("HTML parser normalization cannot recover active content after serialization", () => {
  const attacks = [
    '<svg><foreignObject><meta http-equiv="refresh" content="0;url=https://audit.invalid"></foreignObject></svg>',
    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
    '<a href="&#106;avascript:alert(1)">x</a><img src="data:image/svg+xml,<svg onload=alert(1)>">',
  ];
  for (const attack of attacks) {
    const html = sanitizeOfflineHtml(attack);
    const stack = [parse(html)];
    while (stack.length) {
      const node: any = stack.pop();
      assert.ok(!["script", "meta", "foreignObject", "iframe", "form"].includes(node.tagName));
      for (const attr of node.attrs ?? []) {
        assert.ok(!/^on/i.test(attr.name));
        assert.ok(!/javascript:|https:\/\/audit\.invalid/.test(attr.value));
      }
      stack.push(...(node.childNodes ?? []));
    }
  }
});

test("offline preview streams have a byte limit and keep UTF-8 split across chunks intact", async () => {
  const bytes = Buffer.from("<h1>本地报告</h1>");
  const result = await readOfflineHtmlPreview(Readable.from([bytes.subarray(0, 6), bytes.subarray(6)]));
  assert.match(result!, /本地报告/);
  const large = Readable.from([Buffer.alloc(OFFLINE_HTML_PREVIEW_MAX_BYTES), Buffer.from("x")]);
  assert.equal(await readOfflineHtmlPreview(large), null);
  assert.equal(large.destroyed, true);
  const csp = offlineHtmlPreviewCsp([]);
  assert.match(csp, /script-src 'none'/);
  assert.doesNotMatch(csp, /https:|allow-scripts|allow-same-origin/);
});
