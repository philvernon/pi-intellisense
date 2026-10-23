import fs from "node:fs";
import path from "node:path";
const root=process.argv[2];
if(!root)throw new Error("Usage: node scripts/patch-tab-focus.mjs /path/to/pi-tab-focus");
const file=path.join(root,"src/index.ts");
let src=fs.readFileSync(file,"utf8");
if(src.includes("NATIVE_PI_INTELLISENSE_BRIDGE_V1")){console.log("Pi transcript bridge already installed");process.exit(0);}
function replaceOnce(before,after){
 if(!src.includes(before))throw new Error("Cannot patch Pi tab-focus: expected upstream source changed: "+before.slice(0,70));
 src=src.replace(before,after);
}
replaceOnce('  let cleanupSession: (() => void) | undefined;',`  // NATIVE_PI_INTELLISENSE_BRIDGE_V1: transcript input remains owned by tab-focus.
  let intellisenseHandler:
    | { sessionId: string; extensionId: string; actions: string[]; invoke: (operation: string, snapshot: unknown) => Promise<void> }
    | undefined;
  pi.events?.on?.("pi-intellisense:register:v1", (value: any) => {
    if (value?.extensionId === "pi-intellisense" && typeof value.invoke === "function")
      intellisenseHandler = value;
  });
  pi.events?.on?.("pi-intellisense:unregister:v1", (value: any) => {
    if (value?.sessionId === intellisenseHandler?.sessionId) intellisenseHandler = undefined;
  });
  let cleanupSession: (() => void) | undefined;`);
replaceOnce('    cleanupSession = undefined;\n\n    const {\n      focusKey,',`    cleanupSession = undefined;

    const intellisenseSessionId = String(
      ctx.sessionManager?.getSessionId?.() ?? ctx.sessionManager?.getSessionFile?.() ?? "pi-session"
    );
    pi.events?.emit?.("pi-tab-focus:availability:v1", {
      sessionId: intellisenseSessionId, bridgeVersion: 1,
    });

    const {
      focusKey,`);
replaceOnce('    const handleVisualInput = (data: string): boolean => {',`    let intellisensePending = false;
    const intellisenseActions: Record<string, string> = {
      gd: "definition", gD: "declaration", gi: "implementation",
      gy: "typeDefinition", gr: "references", gs: "documentSymbols",
    };

    const emitIntelliSense = (operation: string): void => {
      const head = visualSnapshot()?.head;
      const handler = intellisenseHandler;
      if (!head || !handler || handler.sessionId !== intellisenseSessionId ||
          !handler.actions.includes(operation)) return;
      const item = transcriptItems().find(
        candidate => head.row >= candidate.startRow && head.row < candidate.endRow
      );
      const scroll = activeScrollView();
      if (!item || !scroll || head.row < scroll.scrollTop ||
          head.row >= scroll.scrollTop + scroll.viewportHeight) return;
      const screenRow = head.row - scroll.scrollTop;
      if (screenRow < 0 || screenRow >= (tui?.terminal.rows ?? 0)) return;
      const screenCol = Math.max(0, head.col + 1); // transcript left gutter
      const snapshot = {
        version: 1 as const,
        sessionId: intellisenseSessionId,
        itemSemanticKey: item.semanticKey,
        itemKind: item.kind,
        transcriptRevision: String(visualSourceRevision),
        layoutRevision: String(transcriptWidth()) + ":" + String(scroll.scrollTop),
        visualCursor: { ...head },
        screenCursor: { row: screenRow, col: screenCol },
        selectedCodeRegionId: item.semanticKey,
        sourceSpans: [],
        itemText: item.text,
        renderedLine: sourceLine(head.row),
        itemStartRow: item.startRow,
        itemEndRow: item.endRow,
        renderedLines: [...item.linkSourceLines],
      };
      void Promise.resolve(handler.invoke(operation, snapshot)).catch((error: unknown) => {
        ctx.ui.notify("IntelliSense: " + (error instanceof Error ? error.message : String(error)), "warning");
      });
    };

    const handleVisualInput = (data: string): boolean => {`);
replaceOnce('      if (!visualNavigation || !ensureVisualWidth()) return false;\n\n      const before = visualNavigation.snapshot().head;', `      if (!visualNavigation || !ensureVisualWidth()) return false;

      const semanticKey = normalizeVisualKey(data);
      const handler = intellisenseHandler?.sessionId === intellisenseSessionId
        ? intellisenseHandler : undefined;
      const before = visualNavigation.snapshot().head;
      if (handler && !exDetour && !isKeyRepeat(data)) {
        if (intellisensePending) {
          intellisensePending = false;
          const op = intellisenseActions["g" + semanticKey];
          if (op && handler.actions.includes(op)) {
            emitIntelliSense(op);
            updateStatus();
            return true;
          }
          // Feed both keys into the original Vim grammar for gg/ge/gE and
          // any other motions without losing its pending state.
          visualNavigation.handleKey("g", visualTextSource);
          const result = visualNavigation.handleKey(semanticKey, visualTextSource);
          if (result.command === "copy") copyVisualSelection();
          else syncVisualNavigation(before);
          return true;
        }
        if (semanticKey === "g") {
          intellisensePending = true;
          updateStatus();
          return true;
        }
        if (semanticKey === "K" && handler.actions.includes("hover")) {
          emitIntelliSense("hover");
          return true;
        }
      }
      if (intellisensePending) intellisensePending = false;`);
replaceOnce('      if (inVisualMode()) finishVisualMode({ restoreGutter: false });\n      clearSelection();','      if (inVisualMode()) finishVisualMode({ restoreGutter: false });\n      intellisensePending = false;\n      clearSelection();');
fs.writeFileSync(file,src);
console.log("Patched "+file);
