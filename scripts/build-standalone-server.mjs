// Emit the standalone server's reachable workspace modules as native ESM.
// External npm dependencies remain installed dependencies, not a release archive.
import ts from "typescript";
import { readFile, writeFile, mkdir, cp, symlink, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = process.argv[2];
if (!destination) throw new Error("Usage: node scripts/build-standalone-server.mjs NEW_OUTPUT_DIRECTORY");
const output = path.resolve(destination);
// Never replace an existing artifact or permit output inside an input tree.
if (output === root || output.startsWith(path.join(root, "packages") + path.sep)) {
  throw new Error("Output must be outside the source packages");
}
await mkdir(output, { recursive: false });
const queue = [path.join(root, "packages/server/src/standalone.ts")];
const seen = new Set();
const packages = new Set();
const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, esModuleInterop: true,
  resolveJsonModule: true, isolatedModules: true };
const host = ts.sys;
const cache = ts.createModuleResolutionCache(root, (name) => name, options);
const emittedPath = (source) => path.join(output, path.relative(root, source).replace(/\.tsx?$/, ".js"));

async function workspaceSource(specifier, importer) {
  const result = ts.resolveModuleName(specifier, importer, options, host, cache).resolvedModule;
  if (!result || result.resolvedFileName.endsWith(".d.ts")) return null;
  const source = await realpath(result.resolvedFileName);
  if (!source.startsWith(path.join(root, "packages") + path.sep) || source.includes(`${path.sep}node_modules${path.sep}`)) return null;
  return source;
}

while (queue.length) {
  const source = queue.shift();
  if (seen.has(source)) continue;
  seen.add(source);
  const relative = path.relative(root, source);
  const packageRoot = relative.split(path.sep).slice(0, 2).join(path.sep);
  packages.add(packageRoot);
  await mkdir(path.dirname(emittedPath(source)), { recursive: true });
  if (source.endsWith(".json")) {
    await cp(source, emittedPath(source));
    continue;
  }
  const text = await readFile(source, "utf8");
  const result = ts.transpileModule(text, { fileName: source, compilerOptions: options, reportDiagnostics: true });
  const errors = (result.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCurrentDirectory: () => root, getCanonicalFileName: (name) => name, getNewLine: () => "\n",
  }));
  // Resolve emitted imports, so erased type-only dependencies are not copied.
  const parsed = ts.createSourceFile(source.replace(/\.tsx?$/, ".js"), result.outputText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const replacements = [];
  const literals = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      literals.push(node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      literals.push(node.arguments[0]);
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL" && node.arguments?.length === 2 && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.endsWith(".ts") && node.arguments[1].getText(parsed) === "import.meta.url") {
      literals.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  for (const literal of literals) {
    const target = await workspaceSource(literal.text, source);
    if (!target) {
      if (literal.text.startsWith(".")) throw new Error(`Unresolved local module: ${relative}: ${literal.text}`);
      continue;
    }
    queue.push(target);
    let specifier = path.relative(path.dirname(emittedPath(source)), emittedPath(target)).split(path.sep).join("/");
    if (!specifier.startsWith(".")) specifier = `./${specifier}`;
    replacements.push([literal.getStart(parsed), literal.end, JSON.stringify(specifier)]);
  }
  let code = result.outputText;
  for (const [start, end, replacement] of replacements.sort((a, b) => b[0] - a[0])) code = code.slice(0, start) + replacement + code.slice(end);
  await writeFile(emittedPath(source), code);
}
await writeFile(path.join(output, "package.json"), JSON.stringify({ private: true, type: "module" }));
for (const packageRoot of packages) {
  await cp(path.join(root, packageRoot, "package.json"), path.join(output, packageRoot, "package.json"));
  const dependencies = path.join(root, packageRoot, "node_modules");
  if (existsSync(dependencies)) await symlink(dependencies, path.join(output, packageRoot, "node_modules"), "dir");
}
await cp(path.join(root, "packages/server/drizzle"), path.join(output, "packages/server/drizzle"), { recursive: true });
const manifest = { stage: "compiled-workspace", entry: "packages/server/src/standalone.js", modules: seen.size,
  requiresInstalledDependencies: true, typechecked: false, workerLoaderRequired: false,
  note: "Experimental build only. Supply built web assets and daemon separately. Dependency symlinks are not a portable release." };
await writeFile(path.join(output, "build-manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ output, ...manifest }));
