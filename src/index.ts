import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hideSourceAnnotations } from "./blocks.ts";
import { createLspManager } from "./runtime.ts";
import {
  registerTabFocusIntelliSense,
  isRecord,
  type Snapshot,
} from "./bridge/register.ts";
import {
  createNativeTranscriptController,
  type SourceRequest,
  type NavigationLocation,
} from "./native/native-controller.ts";
import { normalizeDocumentSymbols } from "./lsp/normalize.ts";
import type { DocumentSymbol } from "./lsp/types.ts";
import {
  symbolAtLine,
  type SourceAnchor,
  type Position,
} from "./native/transcript-source.ts";
import {
  normalizeLocations,
  validateFileLocation,
  within,
} from "./locations.ts";
import { createNeovimNavigator } from "./neovim-launcher.ts";
import { resolveTranscriptProvenance } from "./native/provenance-resolver.ts";
import { stripAnsi } from "./positions.ts";
import { createProvider } from "./providers/index.ts";

const hashText = (text: string) =>
  createHash("sha256").update(text).digest("hex");
interface Configuration {
  timeoutMs: number;
  servers: Record<string, { command: string; args: string[] }>;
  nvimSocket: string;
  provider: "standalone" | "pi-lens-mcp";
  piLensServer?: string;
}
const DEFAULT_CONFIG: Configuration = {
  timeoutMs: 5000,
  servers: {},
  nvimSocket: "env:NVIM",
  provider: "standalone",
};

function agentDirectory() {
  return (
    process.env.PI_CODING_AGENT_DIR ?? path.join(homedir(), ".pi", "agent")
  );
}
async function configFromDisk(): Promise<Configuration> {
  try {
    const data: unknown = JSON.parse(
      await fs.readFile(
        path.join(agentDirectory(), "pi-intellisense.json"),
        "utf8",
      ),
    );
    if (!isRecord(data)) return DEFAULT_CONFIG;
    const servers: Record<string, { command: string; args: string[] }> = {};
    for (const [language, value] of Object.entries(
      isRecord(data.servers) ? data.servers : {},
    )) {
      if (
        isRecord(value) &&
        typeof value.command === "string" &&
        Array.isArray(value.args) &&
        value.args.every((arg: unknown) => typeof arg === "string")
      )
        servers[language] = { command: value.command, args: value.args };
    }
    return {
      ...DEFAULT_CONFIG,
      servers,
      timeoutMs:
        typeof data.timeoutMs === "number" &&
        Number.isInteger(data.timeoutMs) &&
        data.timeoutMs > 0
          ? data.timeoutMs
          : 5000,
      nvimSocket:
        typeof data.nvimSocket === "string" ? data.nvimSocket : "env:NVIM",
      provider: data.provider === "pi-lens-mcp" ? "pi-lens-mcp" : "standalone",
      piLensServer:
        typeof data.piLensServer === "string" &&
        path.isAbsolute(data.piLensServer)
          ? data.piLensServer
          : undefined,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}
function configuredSocket(config: Configuration) {
  if (config.nvimSocket === "auto") return undefined;
  const socket =
    config.nvimSocket === "env:NVIM"
      ? (process.env.PI_INTELLISENSE_NVIM ?? process.env.NVIM)
      : config.nvimSocket;
  return socket && path.isAbsolute(socket) ? socket : undefined;
}

export default function piIntelliSense(pi: ExtensionAPI) {
  let disposeSession: undefined | (() => Promise<void>);
  pi.registerMarkdownTransformer((markdown, context) =>
    context.messageType === "assistant"
      ? hideSourceAnnotations(markdown)
      : markdown,
  );
  pi.on("before_agent_start", (event) => {
    event.systemPromptOptions.sections.intellisense_sources = [
      "Use ordinary language fences for code. IntelliSense uses the current workspace's language server automatically; no source annotations or prior file reads are required.",
    ].join("\n");
  });
  pi.on("session_start", async (_event, ctx) => {
    await disposeSession?.();
    const root = await fs.realpath(ctx.cwd);
    const sessionId = String(
      ctx.sessionManager.getSessionId?.() ??
        ctx.sessionManager.getSessionFile?.() ??
        "pi-session",
    );
    const config = await configFromDisk();
    const navigator = createNeovimNavigator({
      cwd: root,
      timeoutMs: config.timeoutMs,
    });
    let manager: ReturnType<typeof createLspManager> | undefined;
    let provider: ReturnType<typeof createProvider> | undefined;
    let transcriptRevision = "";
    let disposed = false;
    const runtime = () => (manager ??= createLspManager({ cwd: root, config }));
    const query = async (request: SourceRequest) => {
      if (!provider)
        provider = createProvider({
          kind: config.provider,
          cwd: root,
          piLensServer:
            config.piLensServer ??
            path.join(
              agentDirectory(),
              "npm",
              "node_modules",
              "pi-lens",
              "dist",
              "mcp",
              "server.js",
            ),
          standaloneQuery: async (q) => {
            const file = fileURLToPath(q.uri);
            if (!within(root, file))
              throw new Error("Source outside workspace");
            const text = await fs.readFile(file, "utf8");
            if (hashText(text) !== q.source?.fileHash)
              throw new Error(
                "Source changed since mapping; retry hover/navigation",
              );
            return (
              await runtime().get(file, text, { signal: q.signal })
            ).query(q);
          },
        });
      return provider.query(request);
    };
    const controller = createNativeTranscriptController({
      ui: ctx.ui,
      requestEditorFocus: () =>
        pi.events.emit("pi-intellisense:return-to-editor:v1", { sessionId }),
      getSession: () => ({ sessionId, transcriptRevision }),
      resolveSymbol: async (snapshot: Snapshot) => {
        const source = await resolveTranscriptProvenance(snapshot, {
          root,
          entries: ctx.sessionManager.getBranch(),
        });
        if (
          source.kind !== "unmapped" ||
          !["source-unknown", "wrapped-unmappable", "ambiguous"].includes(
            source.reason,
          )
        )
          return source;
        if (!snapshot.visualCursor) return source;
        const row = snapshot.visualCursor.row - snapshot.renderedStartRow;
        const text = stripAnsi(snapshot.renderedLines[row] ?? "");
        const symbol = symbolAtLine(text, text, snapshot.visualCursor.col);
        return symbol
          ? { kind: "workspace-symbol-query", token: symbol.token }
          : source;
      },
      findWorkspaceSymbols: async (source, { signal }) => {
        const symbols = await runtime().workspaceSymbols({
          query: source.token,
          languageId: source.languageId,
          signal,
        });
        const matches = new Map<string, SourceAnchor & NavigationLocation>(),
          files = new Map<
            string,
            Promise<{ text: string; fileHash: string }>
          >(),
          documents = new Map<string, Promise<DocumentSymbol[]>>();
        const compare = (a: Position, b: Position) =>
          a.line - b.line || a.character - b.character;
        const flatten = (symbols: DocumentSymbol[]): DocumentSymbol[] =>
          symbols.flatMap((symbol) => [
            symbol,
            ...flatten(symbol.children ?? []),
          ]);
        for (const symbol of symbols) {
          if (signal.aborted) return [];
          if (symbol.name !== source.token || !symbol.location?.range?.start)
            continue;
          const { uri, range } = symbol.location;
          try {
            const target = await validateFileLocation({ uri, range }, { root });
            if (!files.has(uri))
              files.set(
                uri,
                fs
                  .readFile(target.path, "utf8")
                  .then((text) => ({ text, fileHash: hashText(text) })),
              );
            const file = (await files.get(uri))!;
            const client = await runtime().get(target.path, file.text, {
              uri,
              signal,
            });
            let position = range.start;
            const line = file.text.split(/\r?\n/u)[position.line] ?? "";
            if (!line.slice(position.character).startsWith(source.token)) {
              if (!documents.has(uri))
                documents.set(
                  uri,
                  (async () => {
                    return client.capabilities.documentSymbolProvider
                      ? flatten(
                          normalizeDocumentSymbols(
                            await client.query({
                              kind: "documentSymbols",
                              uri,
                              signal,
                            }),
                          ),
                        )
                      : [];
                  })(),
                );
              const selections = (await documents.get(uri))!.filter(
                (symbol) =>
                  symbol.name === source.token &&
                  symbol.selectionRange &&
                  compare(symbol.selectionRange.start, range.start) >= 0 &&
                  compare(symbol.selectionRange.start, range.end) < 0,
              );
              const selected =
                selections.find(
                  (symbol) => compare(symbol.range.start, range.start) === 0,
                ) ?? (selections.length === 1 ? selections[0] : null);
              if (selected) position = selected.selectionRange.start;
            }
            const definitions = client.capabilities.definitionProvider
              ? normalizeLocations(
                  await client.query({
                    kind: "definition",
                    uri,
                    position,
                    signal,
                  }),
                )
              : [];
            const destinations = definitions.length
              ? definitions
              : [{ uri, selectionRange: { start: position } }];
            for (const destination of destinations) {
              if (signal.aborted) return [];
              const definition = await validateFileLocation(destination, {
                root,
              });
              const definitionUri = pathToFileURL(definition.path).href;
              const key = JSON.stringify([
                definitionUri,
                definition.line,
                definition.character,
              ]);
              if (matches.has(key)) continue;
              if (!files.has(definitionUri)) {
                files.set(
                  definitionUri,
                  fs
                    .readFile(definition.path, "utf8")
                    .then((text) => ({ text, fileHash: hashText(text) })),
                );
              }
              const contents = (await files.get(definitionUri))!;
              matches.set(key, {
                kind: "verified-file",
                origin: "workspace-symbol",
                uri: definitionUri,
                fileHash: contents.fileHash,
                token: source.token,
                position: {
                  line: definition.line,
                  character: definition.character,
                },
                line: definition.line,
                character: definition.character,
              });
            }
          } catch {
            continue;
          }
        }
        return [...matches.values()];
      },
      lsp: { query },
      validateSource: async (source) => {
        if (source.kind === "virtual-document") return true;
        if (!source.fileHash || !source.uri?.startsWith("file://"))
          return false;
        const file = fileURLToPath(source.uri);
        return (
          within(root, file) &&
          hashText(await fs.readFile(file, "utf8").catch(() => "")) ===
            source.fileHash
        );
      },
      validateTarget: async (location) => {
        await validateFileLocation(
          { uri: location.uri, selectionRange: { start: location } },
          { root },
        );
        return location;
      },
      neovim: {
        open: async (location, options) => {
          const target = await validateFileLocation(
            { uri: location.uri, selectionRange: { start: location } },
            { root },
          );
          return navigator.open(
            { ...target, encoding: "utf-16" },
            { ...options, socket: configuredSocket(config) },
          );
        },
      },
    });
    const registration = registerTabFocusIntelliSense({
      events: pi.events,
      sessionId,
      onAction: async (operation, snapshot) => {
        if (disposed || ctx.mode !== "tui") return;
        transcriptRevision = String(snapshot.transcriptRevision ?? "");
        await controller.invoke(operation, snapshot);
      },
    });
    disposeSession = async () => {
      if (disposed) return;
      disposed = true;
      registration.dispose();
      controller.dispose();
      await provider?.close?.();
      await manager?.close();
    };
  });
  pi.on("session_shutdown", async () => {
    await disposeSession?.();
    disposeSession = undefined;
  });
}
