import fs from "node:fs";
import path from "node:path";

export interface SkillInfo {
  name: string;
  description: string;
  bytes: number;
}

interface SkillEntry extends SkillInfo {
  content: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function firstMeaningfulLine(text: string): string {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    return line.replace(/[*_`>#-]/g, "").trim().slice(0, 120);
  }
  return "";
}

function frontmatterDescription(text: string): string {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return "";
  const line = match[1]
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.startsWith("description:"));
  return line ? line.slice("description:".length).trim().replace(/^["']|["']$/g, "") : "";
}

export class SkillLibrary {
  private readonly skills = new Map<string, SkillEntry>();

  constructor(root: string) {
    let names: string[] = [];
    try {
      names = fs
        .readdirSync(root)
        .filter((name) => name.endsWith(".md"))
        .sort((a, b) => a.localeCompare(b, "en"));
    } catch {
      return;
    }

    for (const file of names) {
      const name = file.slice(0, -3);
      if (!NAME_RE.test(name)) continue;
      try {
        const content = fs.readFileSync(path.join(root, file), "utf8");
        const description =
          frontmatterDescription(content) || firstMeaningfulLine(content) || "没有描述";
        this.skills.set(name, {
          name,
          description,
          bytes: Buffer.byteLength(content),
          content,
        });
      } catch {
        // 单个技能读失败不影响其它技能。
      }
    }
  }

  list(): SkillInfo[] {
    return [...this.skills.values()]
      .map(({ name, description, bytes }) => ({ name, description, bytes }))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
  }

  get(name: string): SkillEntry | null {
    if (!NAME_RE.test(name)) return null;
    return this.skills.get(name) ?? null;
  }

  promptLines(): string[] {
    return this.list().map((skill) => `- ${skill.name}: ${skill.description}`);
  }
}
