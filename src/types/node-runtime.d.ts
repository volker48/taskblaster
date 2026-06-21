declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}

declare const process: {
  readonly argv: readonly string[] & { at(index: number): string | undefined };
};

declare const console: {
  log(message?: unknown): void;
};
