import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { LspPosition, Request, RequestOptions } from "../lsp/types.ts";
import {
  isLspHover,
  isLspPosition,
  isLspRange,
  isRecord,
} from "../lsp/normalize.ts";

export interface QueryRequest extends Request {
  documentVersion?: string;
  source?: { uri?: string; fileHash?: string };
}

export type ProviderKind = "standalone" | "pi-lens-mcp";
export type ProviderQuery = (request: QueryRequest) => Promise<unknown>;

export interface Provider {
  kind: ProviderKind;
  supportsVirtualDocuments: boolean;
  query: ProviderQuery;
  close(): void | Promise<void>;
}

export interface McpClient {
  call(
    name: string,
    args: unknown,
    options?: Pick<RequestOptions, "signal">,
  ): Promise<unknown>;
}

export interface JsonLineMcpClient extends McpClient {
  close(): Promise<void>;
}

export interface PiLensArguments {
  operation: string;
  path: string;
  line?: number;
  character?: number;
  apply: false;
  cwd?: string;
}

interface McpEnvelope {
  isError?: boolean;
  content?: { type?: string; text?: string }[];
}

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue | undefined };

interface NavigationPayload {
  ok?: boolean;
  errors?: unknown[];
  result?: JsonValue;
  locations?: unknown[];
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

const READ_ONLY = new Set([
  "hover",
  "definition",
  "declaration",
  "implementation",
  "typeDefinition",
  "references",
  "documentSymbols",
  "signatureHelp",
]);
const OPERATIONS: Readonly<Record<string, string | undefined>> = {
  documentSymbols: "documentSymbol",
};

export function piLensArguments({
  kind,
  uri,
  position,
  cwd,
}: {
  kind: string;
  uri: string;
  position?: LspPosition;
  cwd?: string;
}): PiLensArguments {
  if (!READ_ONLY.has(kind))
    throw new Error("pi-lens provider does not support " + kind);
  if (!uri.startsWith("file://")) {
    throw new Error(
      "pi-lens MCP needs a verified file source, not a virtual URI",
    );
  }
  const filePath = fileURLToPath(uri);
  return {
    operation: OPERATIONS[kind] ?? kind,
    path: filePath,
    ...(position
      ? { line: position.line + 1, character: position.character + 1 }
      : {}),
    apply: false,
    cwd,
  };
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isMcpEnvelope(value: unknown): value is McpEnvelope {
  return (
    isRecord(value) &&
    (value.isError === undefined || typeof value.isError === "boolean") &&
    (value.content === undefined ||
      (Array.isArray(value.content) &&
        value.content.every(
          (part: unknown) =>
            isRecord(part) &&
            (part.type === undefined || typeof part.type === "string") &&
            (part.text === undefined || typeof part.text === "string"),
        )))
  );
}

function isNavigationPayload(value: unknown): value is NavigationPayload {
  return (
    isRecord(value) &&
    (value.ok === undefined || typeof value.ok === "boolean") &&
    (value.errors === undefined || Array.isArray(value.errors)) &&
    (value.locations === undefined || Array.isArray(value.locations)) &&
    (value.result === undefined || isJsonValue(value.result))
  );
}

function envelopeResult(response: unknown, kind: string): JsonValue {
  if (!isMcpEnvelope(response))
    throw new Error("pi-lens MCP returned a malformed envelope");
  const content = response;
  if (content?.isError) {
    throw new Error(
      String(content.content?.[0]?.text ?? "pi-lens MCP query failed").slice(
        0,
        500,
      ),
    );
  }
  const text = content?.content?.find((part) => part?.type === "text")?.text;
  if (!text) throw new Error("pi-lens MCP did not return navigation data");
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("pi-lens MCP returned unstructured navigation data");
  }
  if (!isNavigationPayload(payload))
    throw new Error("pi-lens MCP returned malformed navigation data");
  if (payload.ok === false || payload.errors?.length) {
    throw new Error(String(payload.errors?.[0] ?? "pi-lens LSP query failed"));
  }
  if (kind === "hover") {
    const result = payload.result;
    if (typeof result === "string") return { contents: result };
    if (!isJsonObject(result)) return null;
    if (result.contents) {
      if (!isLspHover(result))
        throw new Error("pi-lens MCP returned malformed hover data");
      return result;
    }
    if (result.value) {
      if (typeof result.value !== "string")
        throw new Error("pi-lens MCP returned malformed hover data");
      return { contents: { kind: "markdown", value: result.value } };
    }
    if (result.markdown) {
      if (typeof result.markdown !== "string")
        throw new Error("pi-lens MCP returned malformed hover data");
      return { contents: { kind: "markdown", value: result.markdown } };
    }
    return null;
  }
  if (Array.isArray(payload.locations)) {
    return payload.locations
      .map((loc) => {
        if (!isJsonObject(loc)) return null;
        if (typeof loc.uri === "string" && loc.uri && isLspRange(loc.range))
          return loc;
        const position = { line: loc.line, character: loc.character ?? 0 };
        if (!isLspPosition(position)) return null;
        if (typeof loc.uri === "string" && loc.uri) {
          return {
            uri: loc.uri,
            range: { start: { ...position }, end: { ...position } },
          };
        }
        if (typeof loc.path === "string" && loc.path) {
          return {
            uri: "file://" + encodeURI(loc.path),
            range: { start: { ...position }, end: { ...position } },
          };
        }
        return null;
      })
      .filter(Boolean);
  }
  return payload.result ?? null;
}

export function createPiLensMcpProvider({
  cwd,
  client,
  closeClient,
}: {
  cwd?: string;
  client: McpClient;
  closeClient?: () => void | Promise<void>;
}): Provider {
  return {
    kind: "pi-lens-mcp",
    supportsVirtualDocuments: false,
    async query(request) {
      const args = piLensArguments({ ...request, cwd });
      const result = await client.call("pilens_lsp_navigation", args, {
        signal: request.signal,
      });
      return envelopeResult(result, request.kind);
    },
    async close() {
      await closeClient?.();
    },
  };
}

export interface JsonLineMcpClientOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export function createJsonLineMcpClient({
  command = process.execPath,
  args = [],
  cwd,
  env = process.env,
  timeoutMs = 12000,
}: JsonLineMcpClientOptions): JsonLineMcpClient {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
  const pending = new Map<number, PendingRequest>();
  let serial = 0;
  let buff = "";
  let closed = false;
  let stderrTail = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2400);
  });
  const fail = (error: Error): void => {
    closed = true;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    pending.clear();
  };
  child.on("error", fail);
  child.on("exit", (code) =>
    fail(
      new Error(
        "pi-lens MCP process exited: " +
          code +
          (stderrTail
            ? " — " +
              stderrTail.split("\n").filter(Boolean).slice(-4).join(" | ")
            : ""),
      ),
    ),
  );
  child.stdout.on("data", (chunk: Buffer) => {
    buff += chunk.toString("utf8");
    if (buff.length > 2_000_000) {
      fail(new Error("pi-lens MCP response too large"));
      child.kill();
      return;
    }
    while (buff.includes("\n")) {
      const end = buff.indexOf("\n");
      const line = buff.slice(0, end);
      buff = buff.slice(end + 1);
      if (!line.trim()) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(msg) || typeof msg.id !== "number") continue;
      const p = pending.get(msg.id);
      if (!p) continue;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        const message =
          isRecord(msg.error) && typeof msg.error.message === "string"
            ? msg.error.message
            : "MCP error";
        p.reject(new Error(message));
      } else p.resolve(msg.result);
    }
  });

  const request = (
    method: string,
    params: unknown,
    { signal }: Pick<RequestOptions, "signal"> = {},
  ): Promise<unknown> =>
    new Promise<unknown>((resolve, reject) => {
      if (closed) return reject(new Error("pi-lens MCP server closed"));
      const id = ++serial;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("pi-lens MCP timeout: " + method));
      }, timeoutMs);
      const abort = (): void => {
        pending.delete(id);
        clearTimeout(timer);
        reject(new Error("MCP request cancelled"));
      };
      if (signal?.aborted) {
        clearTimeout(timer);
        return reject(new Error("MCP request cancelled"));
      }
      signal?.addEventListener("abort", abort, { once: true });
      const settle =
        (fn: (value: unknown) => void) =>
        (value: unknown): void => {
          signal?.removeEventListener("abort", abort);
          fn(value);
        };
      pending.set(id, {
        resolve: settle(resolve),
        reject: settle(reject),
        timer,
      });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  let init: Promise<void> | undefined;
  const ready = async (): Promise<void> => {
    if (!init) {
      init = request("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "pi-intellisense", version: "0.2" },
      }).then(async () => {
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          }) + "\n",
        );
        const found = await request("tools/list", {});
        if (
          !isRecord(found) ||
          !Array.isArray(found.tools) ||
          !found.tools.some(
            (tool: unknown) =>
              isRecord(tool) && tool.name === "pilens_lsp_navigation",
          )
        ) {
          throw new Error("pi-lens MCP lsp_navigation tool unavailable");
        }
      });
    }
    return init;
  };
  return {
    async call(name, args, options) {
      await ready();
      return request("tools/call", { name, arguments: args }, options);
    },
    async close() {
      closed = true;
      fail(new Error("MCP client closing"));
      child.kill();
    },
  };
}

interface BaseProviderOptions {
  cwd?: string;
  standaloneClose?: () => void | Promise<void>;
  piLensServer?: string;
}

export type ProviderOptions = BaseProviderOptions &
  (
    | { kind?: "standalone"; standaloneQuery: ProviderQuery }
    | { kind: "pi-lens-mcp"; standaloneQuery?: ProviderQuery }
  );

export function createProvider(options: ProviderOptions): Provider {
  const { cwd, standaloneClose = () => {}, piLensServer } = options;
  if (options.kind === undefined || options.kind === "standalone") {
    return {
      kind: "standalone",
      supportsVirtualDocuments: true,
      query: options.standaloneQuery,
      close: () => standaloneClose?.(),
    };
  }
  if (options.kind !== "pi-lens-mcp")
    throw new Error("Unknown IntelliSense provider: " + options.kind);
  const server =
    piLensServer ??
    fileURLToPath(
      new URL("../../node_modules/pi-lens/dist/mcp/server.js", import.meta.url),
    );
  const mcp = createJsonLineMcpClient({ cwd, args: [server] });
  return createPiLensMcpProvider({
    cwd,
    client: mcp,
    closeClient: () => mcp.close(),
  });
}
