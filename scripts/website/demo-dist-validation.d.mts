export const DEMO_DIST_OWNERS: string[];
export interface DemoDistInputs {
  sourceSha: string;
  origin: string;
  port: number;
  distDir: string;
  outputDir: string;
  report: string;
}
export function demoDistInputs(env?: NodeJS.ProcessEnv, root?: string): DemoDistInputs;
