/**
 * Minimal ambient declarations for the handful of Node.js built-ins
 * this project uses. Declaring them in-repo keeps `typescript` the
 * only devDependency (no `@types/node`); the surface below is
 * intentionally restricted to exactly what `src/` calls, so a typo
 * against a real Node API still fails to compile.
 */

declare module "node:fs" {
  export interface Stats {
    isDirectory(): boolean;
    isFile(): boolean;
  }
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string, encoding: "utf8"): void;
  export function readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): Dirent[];
  export function statSync(path: string): Stats;
  export function mkdirSync(path: string, options: { recursive: true }): void;
  export function unlinkSync(path: string): void;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string, suffix?: string): string;
}

declare var process: {
  argv: string[];
  exitCode: number | undefined;
  env: Record<string, string | undefined>;
  stdout: { write(chunk: string): boolean; isTTY?: boolean };
  stderr: { write(chunk: string): boolean; isTTY?: boolean };
};
