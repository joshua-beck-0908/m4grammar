import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  Diagnostic,
  DiagnosticSeverity,
  Hover,
  MarkupKind,
  Location,
  Range,
  Position,
  DocumentSymbol,
  SymbolKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { M4Analyzer, AnalyzeResult, Usage, DiagSeverity, ResolvedInclude } from './lexer';
import { BUILTINS } from './builtins';
import { LEGEND, buildSemanticTokensData } from './semanticTokens';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const BUILTIN_SUMMARIES = new Map(BUILTINS.map((b) => [b.name, b.summary]));
const EFFECTFUL_BUILTINS = new Set(BUILTINS.filter((b) => b.hasTrackedEffect).map((b) => b.name));

const MAX_INCLUDE_FILE_BYTES = 2 * 1024 * 1024;
let maxIncludeDepth = 8;
let workspaceRoots: string[] = [];

interface CachedAnalysis {
  version: number;
  result: AnalyzeResult;
}
const analysisCache = new Map<string, CachedAnalysis>();

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const folders = params.workspaceFolders ?? [];
  workspaceRoots = folders.map((f) => safeFsPath(f.uri)).filter((p): p is string => !!p);
  if (workspaceRoots.length === 0 && params.rootUri) {
    const p = safeFsPath(params.rootUri);
    if (p) workspaceRoots = [p];
  }
  const cfgDepth = (params.initializationOptions as { maxIncludeDepth?: number } | undefined)?.maxIncludeDepth;
  if (typeof cfgDepth === 'number') maxIncludeDepth = cfgDepth;

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      semanticTokensProvider: { legend: LEGEND, full: true },
      hoverProvider: true,
      definitionProvider: true,
      documentSymbolProvider: true,
    },
  };
});

connection.onDidChangeConfiguration((change) => {
  const settings = change.settings as { m4?: { maxIncludeDepth?: number } } | undefined;
  const depth = settings?.m4?.maxIncludeDepth;
  if (typeof depth === 'number') {
    maxIncludeDepth = depth;
    analysisCache.clear();
    for (const doc of documents.all()) void validate(doc);
  }
});

function safeFsPath(uri: string): string | undefined {
  try {
    if (!uri.startsWith('file://')) return undefined;
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

function resolveAndRead(spec: string, baseDir: string): ResolvedInclude | undefined {
  const candidates = [path.resolve(baseDir, spec), ...workspaceRoots.map((root) => path.resolve(root, spec))];
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile() || stat.size > MAX_INCLUDE_FILE_BYTES) continue;
      const text = fs.readFileSync(candidate, 'utf8');
      return { absPath: candidate, text };
    } catch {
      continue;
    }
  }
  return undefined;
}

function analyze(document: TextDocument): AnalyzeResult {
  const baseDir = path.dirname(safeFsPath(document.uri) ?? document.uri);
  const analyzer = new M4Analyzer(document.uri, document.getText(), baseDir, {
    maxIncludeDepth,
    resolveAndRead,
    builtinSummaries: BUILTIN_SUMMARIES,
    effectfulBuiltins: EFFECTFUL_BUILTINS,
    // In m4-markdown, a stale `#` is correctly rendered by the grammar as a
    // Markdown heading; overriding it to plain would be a downgrade there.
    emitStaleHashOverride: document.languageId !== 'm4-markdown',
  });
  return analyzer.analyze();
}

function getAnalysis(document: TextDocument): AnalyzeResult {
  const cached = analysisCache.get(document.uri);
  if (cached && cached.version === document.version) return cached.result;
  const result = analyze(document);
  analysisCache.set(document.uri, { version: document.version, result });
  return result;
}

function severityOf(s: DiagSeverity): DiagnosticSeverity {
  switch (s) {
    case 'error':
      return DiagnosticSeverity.Error;
    case 'warning':
      return DiagnosticSeverity.Warning;
    case 'info':
      return DiagnosticSeverity.Information;
  }
}

async function validate(document: TextDocument): Promise<void> {
  const result = getAnalysis(document);
  const diagnostics: Diagnostic[] = result.diagnostics.map((d) => ({
    range: Range.create(document.positionAt(d.start), document.positionAt(d.end)),
    message: d.message,
    severity: severityOf(d.severity),
    source: 'm4',
  }));
  await connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

documents.onDidChangeContent((change) => {
  void validate(change.document);
});

documents.onDidClose((e) => {
  analysisCache.delete(e.document.uri);
  void connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

connection.languages.semanticTokens.on((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return { data: [] };
  const result = getAnalysis(document);
  return { data: buildSemanticTokensData(document, result.tokens) };
});

function findUsageAt(usages: Usage[], offset: number): Usage | undefined {
  // usages is sorted by start; linear scan is fine at these file sizes. A
  // declaration site can carry two usage records at the same span (the
  // decorative pre-effect one seen while its own quotes were being scanned,
  // and a fresher one recorded once the define/pushdef actually applied) -
  // prefer the last (freshest) match rather than stopping at the first.
  let found: Usage | undefined;
  for (const u of usages) {
    if (offset >= u.start && offset < u.end) found = u;
    else if (u.start > offset) break;
  }
  return found;
}

connection.onHover((params): Hover | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const result = getAnalysis(document);
  const offset = document.offsetAt(params.position);
  const usage = findUsageAt(result.usages, offset);
  if (!usage) return null;

  const lines: string[] = [];
  if (!usage.resolved) {
    lines.push(`\`${usage.name}\` - no reachable definition found (not a builtin, and no \`define\`/\`pushdef\` seen for it).`);
  } else if (usage.resolved.kind === 'builtin') {
    lines.push(`**${usage.name}** _(GNU m4 builtin)_`);
    if (usage.resolved.summary) lines.push('', usage.resolved.summary);
  } else {
    lines.push(`**${usage.name}** _(user-defined macro)_`);
    if (usage.resolved.body !== undefined) {
      lines.push('', '```m4', usage.resolved.body, '```');
    } else {
      lines.push('', '_Definition body could not be read statically (computed at define-time)._');
    }
    if (usage.resolved.declUri && usage.resolved.declUri !== document.uri) {
      const rel = safeFsPath(usage.resolved.declUri) ?? usage.resolved.declUri;
      lines.push('', `Defined in \`${path.basename(rel)}\`.`);
    }
  }

  return {
    contents: { kind: MarkupKind.Markdown, value: lines.join('\n') },
    range: Range.create(document.positionAt(usage.start), document.positionAt(usage.end)),
  };
});

function offsetToPosition(text: string, offset: number): Position {
  let line = 0;
  let lastNl = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastNl = i;
    }
  }
  return Position.create(line, offset - lastNl - 1);
}

function locationForDecl(uri: string, start: number, end: number, requestingDoc: TextDocument): Location | null {
  if (uri === requestingDoc.uri) {
    return Location.create(uri, Range.create(requestingDoc.positionAt(start), requestingDoc.positionAt(end)));
  }
  const open = documents.get(uri);
  if (open) {
    return Location.create(uri, Range.create(open.positionAt(start), open.positionAt(end)));
  }
  const fsPath = safeFsPath(uri);
  if (!fsPath) return null;
  try {
    const text = fs.readFileSync(fsPath, 'utf8');
    return Location.create(uri, Range.create(offsetToPosition(text, start), offsetToPosition(text, end)));
  } catch {
    return null;
  }
}

connection.onDefinition((params): Location | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const result = getAnalysis(document);
  const offset = document.offsetAt(params.position);
  const usage = findUsageAt(result.usages, offset);
  if (!usage?.resolved || usage.resolved.kind !== 'user') return null;
  const { declUri, declNameStart, declNameEnd } = usage.resolved;
  if (!declUri || declNameStart === undefined || declNameEnd === undefined) return null;
  return locationForDecl(declUri, declNameStart, declNameEnd, document);
});

connection.onDocumentSymbol((params): DocumentSymbol[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const result = getAnalysis(document);
  return result.declarations.map((d) => {
    const range = Range.create(document.positionAt(d.nameStart), document.positionAt(d.nameEnd));
    return DocumentSymbol.create(d.name, d.kind === 'pushdef' ? 'pushdef' : undefined, SymbolKind.Function, range, range);
  });
});

documents.listen(connection);
connection.listen();
