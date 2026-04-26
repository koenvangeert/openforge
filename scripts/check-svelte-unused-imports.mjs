#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const DEFAULT_TARGETS = ['src', 'plugins', 'packages']
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'target', '.svelte-kit'])

function walkSvelteFiles(targetPath, files = []) {
  if (!existsSync(targetPath)) return files

  const stat = statSync(targetPath)
  if (stat.isFile()) {
    if (targetPath.endsWith('.svelte')) files.push(targetPath)
    return files
  }

  if (!stat.isDirectory()) return files

  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
    walkSvelteFiles(path.join(targetPath, entry.name), files)
  }

  return files
}

function getScriptBlocks(source) {
  const blocks = []
  const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi
  let match

  while ((match = scriptPattern.exec(source)) !== null) {
    const content = match[1]
    if (content === undefined) continue
    const start = match.index + match[0].indexOf(content)
    blocks.push({ content, start })
  }

  return blocks
}

function replaceRangeWithSpaces(source, start, end) {
  return source.slice(0, start) + ' '.repeat(end - start) + source.slice(end)
}

function getLineNumber(source, index) {
  return source.slice(0, index).split('\n').length
}

function hasIdentifier(source, identifier) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\w$])\\$?${escaped}(?![\\w$])`).test(source)
}

function getImportedBindings(sourceFile, importDeclaration) {
  const bindings = []
  const clause = importDeclaration.importClause
  if (!clause) return bindings

  if (clause.name) bindings.push(clause.name.text)

  const namedBindings = clause.namedBindings
  if (!namedBindings) return bindings

  if (ts.isNamespaceImport(namedBindings)) {
    bindings.push(namedBindings.name.text)
    return bindings
  }

  for (const element of namedBindings.elements) {
    bindings.push(element.name.text)
  }

  return bindings
}

export function findUnusedSvelteImports(source, fileName = 'component.svelte') {
  const scriptBlocks = getScriptBlocks(source)
  let searchableSource = source
  const imports = []

  for (const block of scriptBlocks) {
    const sourceFile = ts.createSourceFile(fileName, block.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue

      const statementStart = statement.getFullStart()
      const statementEnd = statement.end
      const absoluteStart = block.start + statementStart
      const absoluteEnd = block.start + statementEnd

      searchableSource = replaceRangeWithSpaces(searchableSource, absoluteStart, absoluteEnd)

      for (const binding of getImportedBindings(sourceFile, statement)) {
        imports.push({ name: binding, index: block.start + statement.getStart(sourceFile) })
      }
    }
  }

  return imports
    .filter((imported) => !hasIdentifier(searchableSource, imported.name))
    .map((imported) => ({ ...imported, line: getLineNumber(source, imported.index) }))
}

function main() {
  const targets = process.argv.slice(2)
  const files = (targets.length > 0 ? targets : DEFAULT_TARGETS)
    .flatMap((target) => walkSvelteFiles(path.resolve(process.cwd(), target)))
    .sort()

  const failures = []

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const unusedImports = findUnusedSvelteImports(source, file)
    for (const unusedImport of unusedImports) {
      failures.push(`${path.relative(process.cwd(), file)}:${unusedImport.line}: unused import '${unusedImport.name}'`)
    }
  }

  if (failures.length > 0) {
    console.error('Unused Svelte imports found:')
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
