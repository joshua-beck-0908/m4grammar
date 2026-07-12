import { SemanticTokensLegend } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SemToken, SemTokenType } from './lexer';

export const TOKEN_TYPES = ['comment', 'keyword', 'string', 'function', 'parameter', 'number', 'macroCall'] as const;
export const TOKEN_MODIFIERS = ['defaultLibrary', 'declaration', 'modification'] as const;

export const LEGEND: SemanticTokensLegend = {
  tokenTypes: [...TOKEN_TYPES],
  tokenModifiers: [...TOKEN_MODIFIERS],
};

function typeIndex(name: (typeof TOKEN_TYPES)[number]): number {
  return TOKEN_TYPES.indexOf(name);
}

function modBit(name: (typeof TOKEN_MODIFIERS)[number]): number {
  return 1 << TOKEN_MODIFIERS.indexOf(name);
}

function classify(type: SemTokenType): { type: number; mods: number } {
  switch (type) {
    case SemTokenType.Comment:
      return { type: typeIndex('comment'), mods: 0 };
    case SemTokenType.Keyword:
      return { type: typeIndex('keyword'), mods: 0 };
    case SemTokenType.String:
      return { type: typeIndex('string'), mods: 0 };
    case SemTokenType.FunctionBuiltin:
      return { type: typeIndex('function'), mods: modBit('defaultLibrary') };
    case SemTokenType.FunctionUser:
      return { type: typeIndex('function'), mods: 0 };
    case SemTokenType.FunctionUnknown:
      return { type: typeIndex('macroCall'), mods: 0 };
    case SemTokenType.MacroDecl:
      return { type: typeIndex('function'), mods: modBit('declaration') };
    case SemTokenType.MacroUndecl:
      return { type: typeIndex('function'), mods: modBit('modification') };
    case SemTokenType.Parameter:
      return { type: typeIndex('parameter'), mods: 0 };
    case SemTokenType.Number:
      return { type: typeIndex('number'), mods: 0 };
  }
}

/** Semantic tokens must not span multiple lines; split on raw '\n' offsets in the document text. */
function splitByLine(text: string, start: number, end: number): Array<[number, number]> {
  const segments: Array<[number, number]> = [];
  let pos = start;
  while (pos < end) {
    const nl = text.indexOf('\n', pos);
    const segEnd = nl === -1 || nl >= end ? end : nl;
    if (segEnd > pos) segments.push([pos, segEnd]);
    pos = nl === -1 || nl >= end ? end : nl + 1;
  }
  return segments;
}

export function buildSemanticTokensData(document: TextDocument, tokens: SemToken[]): number[] {
  const text = document.getText();
  const raw: Array<{ start: number; end: number; type: number; mods: number }> = [];
  for (const t of tokens) {
    const { type, mods } = classify(t.type);
    for (const [s, e] of splitByLine(text, t.start, t.end)) {
      if (e > s) raw.push({ start: s, end: e, type, mods });
    }
  }
  raw.sort((a, b) => a.start - b.start);

  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;
  for (const r of raw) {
    const pos = document.positionAt(r.start);
    const length = r.end - r.start;
    const deltaLine = pos.line - prevLine;
    const deltaStart = deltaLine === 0 ? pos.character - prevChar : pos.character;
    data.push(deltaLine, deltaStart, length, r.type, r.mods);
    prevLine = pos.line;
    prevChar = pos.character;
  }
  return data;
}
