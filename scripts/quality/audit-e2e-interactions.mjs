#!/usr/bin/env node

/** Reject forced native checkbox actions before browser shards are scheduled. */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { isMainModule } from '../is-main-module.mjs';

export function forcedCheckboxActions(source, file = 'fixture.ts') {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  if (parsed.parseDiagnostics.length) throw new Error(`Invalid E2E syntax: ${file}`);
  const violations = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (['check', 'uncheck', 'setChecked'].includes(method)) {
        for (const arg of node.arguments) {
          if (!ts.isObjectLiteralExpression(arg)) continue;
          const force = arg.properties.find(
            (property) =>
              ts.isPropertyAssignment(property) &&
              (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
              property.name.text === 'force' &&
              property.initializer.kind !== ts.SyntaxKind.FalseKeyword,
          );
          if (force) {
            violations.push({
              file,
              line: parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1,
              method,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return violations;
}

export function auditE2eInteractions(root = process.cwd()) {
  const violations = [];
  let files = 0;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
        files++;
        violations.push(...forcedCheckboxActions(readFileSync(path, 'utf8'), relative(root, path)));
      }
    }
  };
  visit(join(root, 'tests', 'e2e'));
  return { files, violations };
}

if (isMainModule(import.meta.url)) {
  try {
    const report = auditE2eInteractions();
    for (const violation of report.violations) {
      console.error(
        `${violation.file}:${violation.line}: forced ${violation.method} bypasses checkbox actionability; click its visible label and assert state`,
      );
    }
    console.log(
      `E2E interaction audit: ${report.files} files; ${report.violations.length} forced checkbox actions.`,
    );
    process.exitCode = report.violations.length ? 1 : 0;
  } catch (error) {
    console.error(`E2E interaction audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}
