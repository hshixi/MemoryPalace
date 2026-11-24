import {
  contractFiles,
  designFiles,
  duplicateContracts,
  financeFiles,
  folderOf,
  imageFiles,
  readingFiles,
  researchFiles,
  techFiles,
  topics,
} from "./data";
import type { ConfirmSpec, FileItem, RetrievalChunk, Usage } from "./types";

export interface Scenario {
  id: string;
  tools: { name: string; args: string; detail: string }[];
  text: string;
  files: FileItem[];
  confirm?: Omit<ConfirmSpec, "status">;
  chunks: RetrievalChunk[];
  usage: Usage;
}

const financeScenario: Scenario = {
  id: "finance",
  tools: [
    { name: "search_files", args: '"营收 PDF"', detail: "3 个结果 · 38 ms" },
    {
      name: "get_file_info",
      args: '"2026-Q3-营收分析.pdf"',
      detail: "2.4 MB · 4 ms",
    },
  ],
  text:
    "找到两份最相关的。你说的应该是「2026-Q3-营收分析.pdf」，10 月 18 日改过；另一份 Q2 的可以拿来对照。\n\n它们都在 01-财务/2026/ 下面。要我继续读出 Q3 里的关键数字吗？",
  files: [financeFiles[0], financeFiles[3]],
  chunks: [
    {
      file: "2026-Q3-营收分析.pdf",
      section: "第 3 页 · 营收概览",
      score: 0.91,
    },
    {
      file: "2026-Q3-经营月报.xlsx",
      section: "Sheet1 · 汇总",
      score: 0.84,
    },
    {
      file: "2026-Q2-营收分析.pdf",
      section: "第 1 页 · 摘要",
      score: 0.72,
    },
  ],
  usage: { prompt: 12846, cached: 12034, completion: 431, cost: 0.00091 },
};

const designScenario: Scenario = {
  id: "design",
  tools: [
    { name: "search_files", args: '"首页 设计稿"', detail: "6 个结果 · 44 ms" },
    {
      name: "get_file_info",
      args: '"首页-概念图-01.png"',
      detail: "4.2 MB · 3 ms",
    },
  ],
  text:
    "找到 3 张最像「首页设计稿」的图，最近两天改过的是前两张。\n\n它们都在 08-素材/首页/ 下。点「打开所在文件夹」就能到目标位置，不会复制文件。",
  files: [imageFiles[0], imageFiles[1], designFiles[1]],
  chunks: [
    {
      file: "首页-概念图-01.png",
      section: "图片 · 视觉相似",
      score: 0.88,
    },
    {
      file: "首页-概念图-02.png",
      section: "图片 · 视觉相似",
      score: 0.85,
    },
    {
      file: "移动端-空状态.png",
      section: "图片 · 同目录",
      score: 0.69,
    },
  ],
  usage: { prompt: 10312, cached: 9660, completion: 366, cost: 0.00077 },
};

const organizeRows = [
  { from: "08-素材/首页/首页-概念图-01.png", to: "08-素材/截图/首页/" },
  { from: "08-素材/首页/首页-概念图-02.png", to: "08-素材/截图/首页/" },
  { from: "08-素材/首页/首页-概念图-03.png", to: "08-素材/截图/首页/" },
  { from: "08-素材/组件/组件库-Button.png", to: "08-素材/截图/组件/" },
  { from: "08-素材/组件/组件库-Input.png", to: "08-素材/截图/组件/" },
  { from: "08-素材/组件/组件库-Tag.png", to: "08-素材/截图/组件/" },
  { from: "08-素材/移动端/移动端-空状态.png", to: "08-素材/截图/空状态/" },
  { from: "08-素材/移动端/移动端-空状态-2.png", to: "08-素材/截图/空状态/" },
  { from: "08-素材/移动端/移动端-加载失败.png", to: "08-素材/截图/空状态/" },
  { from: "08-素材/截图/设计评审-01.png", to: "08-素材/截图/评审/" },
  { from: "08-素材/截图/设计评审-02.png", to: "08-素材/截图/评审/" },
  { from: "08-素材/截图/设计评审-03.png", to: "08-素材/截图/评审/" },
];

const organizeScenario: Scenario = {
  id: "organize",
  tools: [
    {
      name: "list_folder",
      args: '"08-素材"',
      detail: "42 个文件 · 61 ms",
    },
    {
      name: "search_files",
      args: '"截图 png"',
      detail: "12 个结果 · 44 ms",
    },
  ],
  text:
    "工作区里有 12 张设计截图，按内容可以分成 4 组：首页、组件、空状态、评审记录。\n\n我建议移动到「08-素材/截图/」下，分四个子目录。移动前先把完整路径给你确认——不会直接改。",
  files: [],
  confirm: {
    kind: "move",
    title: "移动 12 个文件到「08-素材/截图」",
    description: "会创建 4 个子目录。确认后才会执行，移动不是复制。",
    rows: organizeRows,
    total: 12,
  },
  chunks: [],
  usage: { prompt: 9842, cached: 9210, completion: 388, cost: 0.00074 },
};

const deleteScenario: Scenario = {
  id: "delete",
  tools: [
    { name: "search_files", args: '"合同 2025"', detail: "5 个结果 · 41 ms" },
    {
      name: "get_file_info",
      args: '"3 个疑似重复"',
      detail: "大小与哈希一致 · 12 ms",
    },
  ],
  text:
    "我找到 3 份看起来重复的旧合同，文件名和大小几乎一样。\n\n我会把它们移到系统废纸篓，不会直接抹掉；确认后 30 天内都能恢复。",
  files: [],
  confirm: {
    kind: "delete",
    title: "移入废纸篓：3 个旧合同",
    description:
      "删除是危险动作。第一次点击只会进入二次确认，不会执行；第二次确认后才会移到系统废纸篓。",
    rows: duplicateContracts.map((f) => ({ from: f.path })),
    total: 3,
  },
  chunks: [],
  usage: { prompt: 8760, cached: 8120, completion: 342, cost: 0.00068 },
};

const contractScenario: Scenario = {
  id: "contracts",
  tools: [
    { name: "search_files", args: '"合同 续签"', detail: "2 个结果 · 36 ms" },
  ],
  text:
    "找到 2 份和「续签」有关的合同，最近改的是办公室租约。\n\n租约在 05-合同/2026/，云服务合同也在同一层。需要我对比两份里的续签日期吗？",
  files: [contractFiles[1], contractFiles[0]],
  chunks: [
    {
      file: "办公室租约-续签.pdf",
      section: "第 2 页 · 续签条款",
      score: 0.89,
    },
    {
      file: "云服务合同-2026.pdf",
      section: "第 4 页 · 服务期限",
      score: 0.74,
    },
  ],
  usage: { prompt: 7210, cached: 6680, completion: 312, cost: 0.00055 },
};

const readingScenario: Scenario = {
  id: "reading",
  tools: [
    { name: "search_files", args: '"RAG 文章"', detail: "3 个结果 · 52 ms" },
  ],
  text:
    "找到 3 份和 RAG 有关的材料。最像「上次看的那篇」的是 RAG-检索策略.md，昨天刚改过；另外两份可以当背景。",
  files: [techFiles[0], techFiles[2], readingFiles[2]],
  chunks: [
    {
      file: "RAG-检索策略.md",
      section: "混合检索 · RRF",
      score: 0.87,
    },
    {
      file: "向量索引-选型对比.md",
      section: "选型 · 本地模型",
      score: 0.79,
    },
    {
      file: "关于记忆宫殿的几篇文章.md",
      section: "第 2 篇 · 空间记忆",
      score: 0.61,
    },
  ],
  usage: { prompt: 9340, cached: 8700, completion: 351, cost: 0.00071 },
};

const researchScenario: Scenario = {
  id: "research",
  tools: [
    { name: "search_files", args: '"访谈 创作者"', detail: "2 个结果 · 40 ms" },
  ],
  text:
    "找到两份创作者访谈，都是 6 天前整理的。01 更偏动机，02 更偏现有工作流。\n\n需要我把两份的共同点整理成一页摘要吗？",
  files: [researchFiles[0], researchFiles[1]],
  chunks: [
    {
      file: "访谈记录-创作者-01.md",
      section: "第 2 节 · 为什么整理",
      score: 0.9,
    },
    {
      file: "访谈记录-创作者-02.md",
      section: "第 3 节 · 现在怎么做",
      score: 0.86,
    },
  ],
  usage: { prompt: 8020, cached: 7420, completion: 329, cost: 0.00061 },
};

const genericScenario: Scenario = {
  id: "generic",
  tools: [
    { name: "search_files", args: '"你的描述"', detail: "2 个结果 · 33 ms" },
  ],
  text:
    "我先按你的描述找了 2 个可能相关的文件。\n\n如果不是你要的，再给我一点线索——大概的时间、项目名，或者文件里的一句话都可以。",
  files: [techFiles[0], readingFiles[2]],
  chunks: [
    {
      file: "RAG-检索策略.md",
      section: "混合检索 · RRF",
      score: 0.73,
    },
    {
      file: "关于记忆宫殿的几篇文章.md",
      section: "第 2 篇 · 空间记忆",
      score: 0.66,
    },
  ],
  usage: { prompt: 6420, cached: 5900, completion: 288, cost: 0.00049 },
};

function ageHours(modified: string): number {
  if (modified === "今天") return 1;
  if (modified === "昨天") return 24;
  const m = modified.match(/(\d+)\s*(小时|天|周|个月)前/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const n = Number(m[1]);
  if (m[2] === "小时") return n;
  if (m[2] === "天") return n * 24;
  if (m[2] === "周") return n * 168;
  return n * 720;
}

/** 地图里「问助手这个主题」会带着主题名过来，按主题本身组织答案。 */
function topicScenario(text: string): Scenario | null {
  const match = text.match(/帮我看看「(.+?)」里最近改过的文件/);
  if (!match) return null;
  const topic = topics.find((t) => t.name === match[1]);
  if (!topic || topic.files.length === 0) return null;

  const files = [...topic.files]
    .sort((a, b) => ageHours(a.modified) - ageHours(b.modified))
    .slice(0, 3);
  const lead = files[0];
  const folders = [...new Set(files.map((f) => folderOf(f.path)))];
  const where =
    folders.length === 1
      ? `都在 ${folders[0]}/ 下`
      : "分散在几个目录里，可以直接打开对应文件夹";

  return {
    id: `topic-${topic.id}`,
    tools: [
      {
        name: "search_files",
        args: `"主题：${topic.name}"`,
        detail: `${topic.count} 个文件 · 41 ms`,
      },
      {
        name: "get_file_info",
        args: `"${lead.name}"`,
        detail: `${lead.size} · 3 ms`,
      },
    ],
    text: `「${topic.name}」里最近改过的是这 ${files.length} 个文件，按修改时间排在前面。\n\n它们${where}。要我按时间再排一遍，或者只看其中的图片或文档吗？`,
    files,
    chunks: files.map((f, i) => ({
      file: f.name,
      section: `最近修改 · ${f.modified}`,
      score: [0.92, 0.85, 0.77][i] ?? 0.7,
    })),
    usage: { prompt: 9120, cached: 8420, completion: 302, cost: 0.00066 },
  };
}

export function getScenario(text: string): Scenario {
  const fromTopic = topicScenario(text);
  if (fromTopic) return fromTopic;

  const q = text.toLowerCase();
  if (/删除|删掉|清理|重复|旧合同/.test(q)) return deleteScenario;
  if (/整理|移动|归类/.test(q)) return organizeScenario;
  if (/合同|续签/.test(q)) return contractScenario;
  if (/营收|财报|报表|财务|q3|pdf/.test(q)) return financeScenario;
  if (/设计稿|设计|首页|截图/.test(q)) return designScenario;
  if (/rag|文章|阅读|笔记/.test(q)) return readingScenario;
  if (/访谈|用户研究|问卷/.test(q)) return researchScenario;
  return genericScenario;
}
