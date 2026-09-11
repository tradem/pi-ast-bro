#!/usr/bin/env node
/**
 * Analyze pi session logs for pi-ast-bro tool usage.
 *
 * Scans the pi agent session logs under the sessions directory for toolCall events and reports:
 *   - per month: session count, total tool calls, AST tool calls, AST/session
 *   - per tool: monthly call counts
 *   - per session with AST usage (month, project, tool breakdown, top model)
 *
 * AST tools are identified by name substring "ast" plus "find_implementations"
 * (the extension registers analyze_ast_map/search/context/graph/trace/surface/
 * impact and find_implementations).
 *
 * Usage: node scripts/analyze-ast-usage.js
 * Read-only reporting; the extension itself never runs this script.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");
const isAstTool = (name) =>
  typeof name === "string" && (name.includes("ast") || name === "find_implementations");

function extractToolCalls(obj, counts, models) {
  if (Array.isArray(obj)) {
    for (const v of obj) extractToolCalls(v, counts, models);
    return;
  }
  if (obj === null || typeof obj !== "object") return;
  if (obj.type === "toolCall" && typeof obj.name === "string") {
    counts.set(obj.name, (counts.get(obj.name) ?? 0) + 1);
  }
  const mm = obj.model;
  if (typeof mm === "string" && mm) {
    models.set(mm, (models.get(mm) ?? 0) + 1);
  } else if (mm && typeof mm === "object" && mm.provider && mm.id) {
    const key = `${mm.provider}/${mm.id}`;
    models.set(key, (models.get(key) ?? 0) + 1);
  }
  for (const v of Object.values(obj)) extractToolCalls(v, counts, models);
}

function main() {
  let sessionDirs;
  try {
    sessionDirs = readdirSync(SESSIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(SESSIONS_DIR, d.name));
  } catch {
    console.error(`sessions directory not found: ${SESSIONS_DIR}`);
    process.exitCode = 1;
    return;
  }

  const byMonth = new Map();
  const astSessions = [];

  for (const dir of sessionDirs) {
    const project = dir.split("/").filter(Boolean).pop() ?? "unknown";
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      const month = file.slice(0, 7);
      const counts = new Map();
      const models = new Map();
      const raw = readFileSync(join(dir, file), "utf-8");
      for (const line of raw.split("\n")) {
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue; // Skip malformed lines; session logs are JSONL.
        }
        extractToolCalls(entry, counts, models);
      }
      let ast = 0;
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      for (const [name, n] of counts) if (isAstTool(name)) ast += n;
      const bucket = byMonth.get(month) ?? { sessions: 0, tools: 0, ast: 0 };
      bucket.sessions += 1;
      bucket.tools += total;
      bucket.ast += ast;
      byMonth.set(month, bucket);
      if (ast > 0) {
        const astMap = new Map([...counts].filter(([n]) => isAstTool(n)));
        const topModels = [...models.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
        astSessions.push({ month, project, ast: astMap, models: topModels });
      }
    }
  }

  console.log("Month     Sessions  ToolCalls  ASTCalls  AST/Session");
  for (const [month, s] of [...byMonth].sort()) {
    const per = s.sessions ? (s.ast / s.sessions).toFixed(1) : "0.0";
    console.log(
      `${month}  ${String(s.sessions).padStart(8)}  ${String(s.tools).padStart(9)}  ${String(s.ast).padStart(8)}  ${per.padStart(11)}`,
    );
  }

  console.log("\nPer-tool calls per month:");
  const toolMonths = new Map();
  for (const s of astSessions) {
    for (const [name, n] of s.ast) {
      const m = toolMonths.get(name) ?? new Map();
      m.set(s.month, (m.get(s.month) ?? 0) + n);
      toolMonths.set(name, m);
    }
  }
  const months = [...byMonth].sort().map(([m]) => m);
  console.log(`tool${" ".repeat(26)}${months.join("  ")}`);
  for (const [name, m] of [...toolMonths].sort()) {
    const row = months.map((mo) => String(m.get(mo) ?? 0).padStart(String(mo).length));
    console.log(`${name.padEnd(30)}${row.join("  ")}`);
  }

  console.log("\nSessions with AST usage (recent months):");
  for (const s of astSessions) {
    if (!["2026-08", "2026-09"].includes(s.month)) continue;
    const proj = s.project.replace(/^--|-{2,}$/g, "").replace(/^.*repos-/, "");
    const astStr = [...s.ast].map(([n, c]) => `${n}:${c}`).join(", ");
    const modelStr = s.models.map(([n, c]) => `${n}(${c})`).join(", ");
    console.log(`${s.month}  ${proj}  ${astStr}  [${modelStr}]`);
  }
}

main();
