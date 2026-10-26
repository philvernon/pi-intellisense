import { normalizeLocations as full } from "../locations.ts";
import type {
  CompletionItem,
  DocumentSymbol,
  LspCapabilities,
  LspHover,
  LspLocation,
  LspLocationLink,
  LspOperation,
  LspPosition,
  LspRange,
  LspResultMap,
  ResolvedWorkspaceSymbol,
  SignatureHelp,
  WorkspaceSymbol,
} from "./types.ts";

export type { DocumentSymbol } from "./types.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeLocations(
  input: unknown,
): { uri: string; line: number; character: number }[] {
  return full(input).map((location) => ({
    uri: location.uri,
    line: location.selectionRange.start.line,
    character: location.selectionRange.start.character,
  }));
}

export function normalizeHover(input: unknown): { markdown: string } | null {
  if (!isRecord(input) || !input.contents) return null;
  const parts: unknown[] = Array.isArray(input.contents)
    ? input.contents
    : [input.contents];
  const markdown = parts
    .map((part) => {
      if (typeof part === "string") return part;
      return isRecord(part) && typeof part.value === "string" ? part.value : "";
    })
    .join("\n\n")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/gu, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/gu, "");
  return markdown ? { markdown } : null;
}

export function isLspPosition(value: unknown): value is LspPosition {
  return (
    isRecord(value) &&
    typeof value.line === "number" &&
    Number.isInteger(value.line) &&
    value.line >= 0 &&
    typeof value.character === "number" &&
    Number.isInteger(value.character) &&
    value.character >= 0
  );
}

function comparePositions(a: LspPosition, b: LspPosition): number {
  return a.line - b.line || a.character - b.character;
}

export function isLspRange(value: unknown): value is LspRange {
  return (
    isRecord(value) &&
    isLspPosition(value.start) &&
    isLspPosition(value.end) &&
    comparePositions(value.start, value.end) <= 0
  );
}

export function normalizeDocumentSymbols(response: unknown): DocumentSymbol[] {
  if (!Array.isArray(response)) return [];
  const result: DocumentSymbol[] = [];
  const values: unknown[] = response;
  for (const value of values) {
    if (
      !isRecord(value) ||
      typeof value.name !== "string" ||
      typeof value.kind !== "number" ||
      !Number.isInteger(value.kind) ||
      !isLspRange(value.range) ||
      !isLspRange(value.selectionRange) ||
      comparePositions(value.range.start, value.selectionRange.start) > 0 ||
      comparePositions(value.selectionRange.end, value.range.end) > 0
    ) {
      continue;
    }
    const symbol: DocumentSymbol = {
      name: value.name,
      kind: value.kind,
      range: value.range,
      selectionRange: value.selectionRange,
    };
    if (typeof value.detail === "string") symbol.detail = value.detail;
    if (typeof value.deprecated === "boolean")
      symbol.deprecated = value.deprecated;
    if (
      Array.isArray(value.tags) &&
      value.tags.every((tag: unknown) => typeof tag === "number")
    ) {
      symbol.tags = value.tags;
    }
    if (Array.isArray(value.children))
      symbol.children = normalizeDocumentSymbols(value.children);
    result.push(symbol);
  }
  return result;
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => typeof item === "number")
  );
}

export function isLspCapabilities(value: unknown): value is LspCapabilities {
  if (!isRecord(value)) return false;
  if (
    value.positionEncoding !== undefined &&
    typeof value.positionEncoding !== "string"
  )
    return false;
  const workspace = value.workspaceSymbolProvider;
  if (workspace !== undefined && typeof workspace !== "boolean") {
    if (!isRecord(workspace)) return false;
    if (
      workspace.resolveProvider !== undefined &&
      typeof workspace.resolveProvider !== "boolean"
    )
      return false;
  }
  return [
    "hoverProvider",
    "definitionProvider",
    "declarationProvider",
    "implementationProvider",
    "typeDefinitionProvider",
    "referencesProvider",
    "completionProvider",
    "signatureHelpProvider",
    "documentSymbolProvider",
  ].every(
    (key) =>
      value[key] === undefined ||
      typeof value[key] === "boolean" ||
      isRecord(value[key]),
  );
}

export function isWorkspaceSymbol(value: unknown): value is WorkspaceSymbol {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.kind === undefined || typeof value.kind === "number") &&
    (value.containerName === undefined ||
      typeof value.containerName === "string") &&
    (value.tags === undefined || isNumberArray(value.tags)) &&
    isRecord(value.location) &&
    typeof value.location.uri === "string" &&
    (value.location.range === undefined || isLspRange(value.location.range))
  );
}

export function isResolvedWorkspaceSymbol(
  value: unknown,
): value is ResolvedWorkspaceSymbol {
  return (
    isWorkspaceSymbol(value) &&
    Boolean(value.location.uri) &&
    isLspRange(value.location.range)
  );
}

function isMarkupContent(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    typeof value.value === "string"
  );
}

function isMarkedString(value: unknown): boolean {
  return (
    typeof value === "string" ||
    (isRecord(value) &&
      typeof value.language === "string" &&
      typeof value.value === "string")
  );
}

export function isLspHover(value: unknown): value is LspHover {
  if (
    !isRecord(value) ||
    (value.range !== undefined && !isLspRange(value.range))
  )
    return false;
  return (
    isMarkedString(value.contents) ||
    isMarkupContent(value.contents) ||
    (Array.isArray(value.contents) && value.contents.every(isMarkedString))
  );
}

function isLocation(value: unknown): value is LspLocation {
  return (
    isRecord(value) && typeof value.uri === "string" && isLspRange(value.range)
  );
}

function isLocationLink(value: unknown): value is LspLocationLink {
  return (
    isRecord(value) &&
    typeof value.targetUri === "string" &&
    isLspRange(value.targetRange) &&
    isLspRange(value.targetSelectionRange) &&
    (value.originSelectionRange === undefined ||
      isLspRange(value.originSelectionRange))
  );
}

function isDocumentSymbol(value: unknown): value is DocumentSymbol {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.kind === "number" &&
    Number.isInteger(value.kind) &&
    isLspRange(value.range) &&
    isLspRange(value.selectionRange) &&
    (value.detail === undefined || typeof value.detail === "string") &&
    (value.deprecated === undefined || typeof value.deprecated === "boolean") &&
    (value.tags === undefined || isNumberArray(value.tags)) &&
    (value.children === undefined ||
      (Array.isArray(value.children) && value.children.every(isDocumentSymbol)))
  );
}

function isCompletionItem(value: unknown): value is CompletionItem {
  return (
    isRecord(value) &&
    typeof value.label === "string" &&
    (value.kind === undefined || typeof value.kind === "number") &&
    (value.detail === undefined || typeof value.detail === "string") &&
    (value.documentation === undefined ||
      typeof value.documentation === "string" ||
      isMarkupContent(value.documentation)) &&
    (value.insertText === undefined || typeof value.insertText === "string")
  );
}

function isSignatureHelp(value: unknown): value is SignatureHelp {
  if (!isRecord(value) || !Array.isArray(value.signatures)) return false;
  return (
    (value.activeSignature === undefined ||
      typeof value.activeSignature === "number") &&
    (value.activeParameter === undefined ||
      typeof value.activeParameter === "number") &&
    value.signatures.every((signature: unknown) => {
      if (!isRecord(signature) || typeof signature.label !== "string")
        return false;
      if (
        signature.documentation !== undefined &&
        typeof signature.documentation !== "string" &&
        !isMarkupContent(signature.documentation)
      )
        return false;
      if (
        signature.activeParameter !== undefined &&
        typeof signature.activeParameter !== "number"
      )
        return false;
      if (signature.parameters === undefined) return true;
      return (
        Array.isArray(signature.parameters) &&
        signature.parameters.every((parameter: unknown) => {
          if (!isRecord(parameter)) return false;
          const label = parameter.label;
          return (
            (typeof label === "string" ||
              (Array.isArray(label) &&
                label.length === 2 &&
                label.every((part: unknown) => typeof part === "number"))) &&
            (parameter.documentation === undefined ||
              typeof parameter.documentation === "string" ||
              isMarkupContent(parameter.documentation))
          );
        })
      );
    })
  );
}

export function isLspResult<Kind extends LspOperation>(
  kind: Kind,
  value: unknown,
): value is LspResultMap[Kind] {
  if (value === null) return true;
  switch (kind) {
    case "hover":
      return isLspHover(value);
    case "definition":
    case "declaration":
    case "implementation":
    case "typeDefinition":
      return (
        isLocation(value) ||
        (Array.isArray(value) &&
          (value.every(isLocation) || value.every(isLocationLink)))
      );
    case "references":
      return Array.isArray(value) && value.every(isLocation);
    case "completion":
      return (
        (Array.isArray(value) && value.every(isCompletionItem)) ||
        (isRecord(value) &&
          typeof value.isIncomplete === "boolean" &&
          Array.isArray(value.items) &&
          value.items.every(isCompletionItem))
      );
    case "signatureHelp":
      return isSignatureHelp(value);
    case "documentSymbols":
      return (
        Array.isArray(value) &&
        (value.every(isDocumentSymbol) || value.every(isWorkspaceSymbol))
      );
  }
  return false;
}
