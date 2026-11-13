import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SourceTextModule, SyntheticModule } from "node:vm";

const root = fileURLToPath(new URL("../", import.meta.url));
const hosts = {
  "gpui-kit": ["View", "div", "svg", "image", "Background", "PathBuilder"],
  "gpui-base": ["h_flex", "v_flex", "v_virtual_list", "Scrollbar", "Editor", "EditorState", "Input", "InputState", "Popup"],
  herdr: ["appHome", "exec", "home", "notify", "props", "run", "setShared", "shared", "spaces", "theme", "watchFolder", "hc", "knownAgents", "terminals", "layout", "settings", "readTextFile", "writeTextFile"],
  "fs/promises": ["mkdir", "readFile", "writeFile", "unlink", "exists"],
};
const allowed = {
  app: ["app", "ai", "charts", "notebooks", "postgres", "results", "runtime", "ui"],
  ai: ["ai", "notebooks", "postgres"],
  charts: ["charts", "results"],
  notebooks: ["notebooks", "postgres"],
  postgres: ["postgres"],
  results: ["results", "postgres"],
  runtime: ["runtime", "postgres", "results"],
  ui: ["ui", "ai", "charts", "notebooks", "postgres", "results"],
};
const hostUsers = new Set(["src/app/pg-view.js", "src/ai/assistant.js", "src/runtime/services.js"]);
const modules = new Map();
const graph = new Map();
const hostModules = new Map();

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : extname(path) === ".js" ? [path] : [];
  });
}

const nameOf = (path) => relative(root, path).replaceAll("\\", "/");
const areaOf = (path) => nameOf(path).split("/")[1];

function load(path) {
  if (modules.has(path)) return modules.get(path);
  const name = nameOf(path);
  const module = new SourceTextModule(readFileSync(path, "utf8"), { identifier: path });
  modules.set(path, module);
  graph.set(path, []);
  for (const specifier of module.dependencySpecifiers) {
    if (!specifier.startsWith(".")) {
      if (!Object.hasOwn(hosts, specifier)) throw new Error(`${name}: unsupported runtime import ${specifier}`);
      if (!name.startsWith("src/ui/") && !hostUsers.has(name)) throw new Error(`${name}: host APIs belong in a runtime adapter or view`);
      continue;
    }
    const target = resolve(dirname(path), specifier);
    if (extname(target) !== ".js" || !nameOf(target).startsWith("src/")) throw new Error(`${name}: import must name a source .js file: ${specifier}`);
    if (name !== "main.js" && !allowed[areaOf(path)]?.includes(areaOf(target))) throw new Error(`${name}: dependency on ${nameOf(target)} violates the project structure`);
    graph.get(path).push(target);
    load(target);
  }
  return module;
}

function checkCycles(path, visiting = new Set(), visited = new Set()) {
  if (visiting.has(path)) throw new Error(`Import cycle: ${[...visiting, path].map(nameOf).join(" -> ")}`);
  if (visited.has(path)) return;
  visiting.add(path);
  for (const target of graph.get(path)) checkCycles(target, visiting, visited);
  visiting.delete(path);
  visited.add(path);
}

try {
  const entry = load(join(root, "main.js"));
  checkCycles(entry.identifier);
  for (const path of files(join(root, "src"))) {
    if (!modules.has(path)) throw new Error(`${nameOf(path)} is not reachable from main.js`);
  }
  // Linking validates named exports without executing host calls or opening a database.
  await entry.link((specifier, parent) => {
    if (specifier.startsWith(".")) return modules.get(resolve(dirname(parent.identifier), specifier));
    if (!hostModules.has(specifier)) hostModules.set(specifier, new SyntheticModule(hosts[specifier], () => {}));
    return hostModules.get(specifier);
  });
  if (!Object.getOwnPropertyNames(entry.namespace).includes("default")) throw new Error("main.js must default-export a view");
  const developmentFiles = [...files(join(root, "tests")), ...files(join(root, "scripts"))];
  for (const path of developmentFiles) new SourceTextModule(readFileSync(path, "utf8"), { identifier: path });
  console.log(`Checked ${modules.size} runtime modules and ${developmentFiles.length} development files: syntax, imports, exports, dependency direction, and cycles.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
