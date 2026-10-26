import assert from "node:assert/strict";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export type CustomFactory = Parameters<ExtensionUIContext["custom"]>[0];
export type CustomOptions = Parameters<ExtensionUIContext["custom"]>[1];
export type TestComponent = ReturnType<typeof mountComponent>;

export function mountComponent(
  factory: CustomFactory,
  done: (value: unknown) => void = () => {},
) {
  const component = factory(
    { requestRender() {} } as Parameters<CustomFactory>[0],
    { fg: (_color, text) => text } as Parameters<CustomFactory>[1],
    {} as Parameters<CustomFactory>[2],
    done,
  );
  assert.ok(!(component instanceof Promise));
  assert.ok(component.handleInput);
  return component as typeof component & { handleInput(data: string): void };
}

export function customUI(
  run: (factory: CustomFactory, options: CustomOptions) => Promise<unknown>,
): ExtensionUIContext["custom"] {
  return run as ExtensionUIContext["custom"];
}
