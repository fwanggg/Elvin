import { DESIGN_FONTS, DESIGN_PALETTE, DESIGN_TOKENS, DESIGNS, type Design, type Theme } from "@/lib/design-tokens";
import { assistantComponentSource, reasoningGroupSource, toolCallRowSource, toolCardSource } from "@/lib/scaffold/assistant";
import { stepLabelSource } from "@/lib/scaffold/step-label";
import { chatRouteSource } from "@/lib/scaffold/chat-route";
import { configSource } from "@/lib/scaffold/config";
import { globalsSource } from "@/lib/scaffold/globals-css";
import type { SourceConfig, SourceFile } from "@/lib/scaffold/shared";

const encoder = new TextEncoder();

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const config: SourceConfig = {
    pattern: safeParam(url, "pattern", ["thread", "sidebar", "modal"], "thread"),
    theme: safeParam(url, "theme", ["dark", "light"], "dark"),
    design: safeParam(url, "design", DESIGNS, "swiss"),
    emoji: safeParam(url, "emoji", ["on", "off"], "off"),
    tools: safeParam(url, "tools", ["shown", "humanized", "off"], "shown"),
    reasoning: safeParam(url, "reasoning", ["shown", "hidden", "off"], "shown"),
    open: safeParam(url, "open", ["collapsed", "expanded"], "collapsed"),
    model: url.searchParams.get("model")?.trim() || "acme-support-agent",
    stream: safeParam(url, "stream", ["true", "false"], "true"),
    capability: url.searchParams.get("capability")?.trim() || "",
  };
  const files = generatedFiles(config);

  if (url.searchParams.has("list")) {
    return Response.json({ files: files.map((file) => file.name) });
  }

  // Same bytes the zip carries, so the export pane cannot drift from it.
  if (url.searchParams.has("contents")) {
    return Response.json({ files });
  }

  return new Response(zip(files), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="elvin-${config.pattern}-${config.design}-${config.theme}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

function safeParam<T extends string>(url: URL, key: string, allowed: readonly T[], fallback: T): T {
  const value = url.searchParams.get(key);
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function generatedFiles(config: SourceConfig): SourceFile[] {
  return [
    {
      name: "package.json",
      content: JSON.stringify({
        scripts: { dev: "next dev", build: "next build", start: "next start" },
        dependencies: { "@assistant-ui/react": "latest", next: "latest", react: "latest", "react-dom": "latest" },
        devDependencies: { typescript: "latest", "@types/node": "latest", "@types/react": "latest", "@types/react-dom": "latest" },
      }, null, 2) + "\n",
    },
    { name: "tsconfig.json", content: JSON.stringify({ compilerOptions: { target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "react-jsx", incremental: true, paths: { "@/*": ["./*"] }, plugins: [{ name: "next" }] }, include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"], exclude: ["node_modules"] }, null, 2) + "\n" },
    { name: "next-env.d.ts", content: "/// <reference types=\"next\" />\n/// <reference types=\"next/image-types/global\" />\n" },
    { name: ".env.example", content: "AGENT_BASE_URL=https://api.example.com/v1\nAGENT_API_KEY=\n" },
    { name: "elvin.config.ts", content: configSource(config) },
    {
      name: "app/layout.tsx",
      content: "import type { ReactNode } from 'react';\nimport './globals.css';\n\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return <html lang=\"en\" suppressHydrationWarning><body>{children}</body></html>;\n}\n",
    },
    { name: "app/globals.css", content: globalsSource(config) },
    {
      name: "app/page.tsx",
      content: "import { ElvinAssistant } from '../components/assistant/ElvinAssistant';\n\nexport default function Page() {\n  return <ElvinAssistant />;\n}\n",
    },
    { name: "app/api/chat/route.ts", content: chatRouteSource() },
    { name: "components/assistant/ElvinAssistant.tsx", content: assistantComponentSource() },
    { name: "components/assistant/reasoning-group.tsx", content: reasoningGroupSource() },
    { name: "components/assistant/tool-card.tsx", content: toolCardSource() },
    { name: "components/assistant/tool-call-row.tsx", content: toolCallRowSource() },
    { name: "components/assistant/step-label.ts", content: stepLabelSource() },
  ];
}

// Code emission

function zip(files: SourceFile[]): Uint8Array<ArrayBuffer> {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return concat([...localParts, ...centralParts, end]);
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function crc32(data: Uint8Array): number {
  let crc = -1;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});
