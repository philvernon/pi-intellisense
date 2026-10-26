export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LspTransport {
  request(
    method: string,
    params: unknown,
    options?: RequestOptions,
  ): Promise<unknown>;
  notify(method: string, params: unknown): Promise<void>;
  close?(): void | Promise<void>;
}

export type LspOperation =
  | "hover"
  | "definition"
  | "declaration"
  | "implementation"
  | "typeDefinition"
  | "references"
  | "completion"
  | "signatureHelp"
  | "documentSymbols";

export interface LspDocumentRequest {
  uri: string;
  position?: LspPosition;
  signal?: AbortSignal;
  includeDeclaration?: boolean;
}

export interface Request<
  Kind extends LspOperation = LspOperation,
> extends LspDocumentRequest {
  kind: Kind;
}

export type LspQuery<Kind extends LspOperation = LspOperation> = Request<Kind>;

export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  tags?: number[];
  deprecated?: boolean;
  range: LspRange;
  selectionRange: LspRange;
  children?: DocumentSymbol[];
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface LspLocationLink {
  originSelectionRange?: LspRange;
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange: LspRange;
}

export interface MarkupContent {
  kind: string;
  value: string;
}

export interface LspHover {
  contents:
    | string
    | MarkupContent
    | { language: string; value: string }
    | (string | { language: string; value: string })[];
  range?: LspRange;
}

export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | MarkupContent;
  insertText?: string;
  [key: string]: unknown;
}

export interface CompletionList {
  isIncomplete: boolean;
  items: CompletionItem[];
  [key: string]: unknown;
}

export interface SignatureHelp {
  signatures: {
    label: string;
    documentation?: string | MarkupContent;
    parameters?: {
      label: string | [number, number];
      documentation?: string | MarkupContent;
    }[];
    activeParameter?: number;
  }[];
  activeSignature?: number;
  activeParameter?: number;
}

export type DefinitionResult =
  LspLocation | LspLocation[] | LspLocationLink[] | null;

export interface LspResultMap {
  hover: LspHover | null;
  definition: DefinitionResult;
  declaration: DefinitionResult;
  implementation: DefinitionResult;
  typeDefinition: DefinitionResult;
  references: LspLocation[] | null;
  completion: CompletionItem[] | CompletionList | null;
  signatureHelp: SignatureHelp | null;
  documentSymbols: DocumentSymbol[] | WorkspaceSymbol[] | null;
}

export interface LspCapabilities {
  positionEncoding?: string;
  workspaceSymbolProvider?:
    boolean | { resolveProvider?: boolean; [key: string]: unknown };
  [capability: string]: unknown;
}

export interface WorkspaceSymbol {
  name: string;
  kind?: number;
  containerName?: string;
  tags?: number[];
  data?: unknown;
  location: { uri: string; range?: LspRange };
  [key: string]: unknown;
}

export interface ResolvedWorkspaceSymbol extends WorkspaceSymbol {
  location: { uri: string; range: LspRange };
}

export type LspDocumentMethods = {
  [Kind in LspOperation]: (
    args: LspDocumentRequest,
  ) => Promise<LspResultMap[Kind]>;
};

export interface LspSession extends LspDocumentMethods {
  initialize(): Promise<void>;
  open(document: {
    uri: string;
    text: string;
    version?: number;
  }): Promise<void>;
  workspaceSymbols(
    query: string,
    options?: Pick<RequestOptions, "signal">,
  ): Promise<ResolvedWorkspaceSymbol[]>;
  readonly capabilities: LspCapabilities;
  readonly positionEncoding: string;
  dispose(): Promise<void>;
  query<Kind extends LspOperation>(
    request: Request<Kind>,
  ): Promise<LspResultMap[Kind]>;
}
