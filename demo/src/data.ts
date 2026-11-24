import type {
  ActivityDatum,
  AuditEvent,
  EvalFail,
  FileItem,
  FileKind,
  MemoryEntry,
  RecentQuery,
  Topic,
  TypeDatum,
} from "./types";

export const WORKSPACE = {
  path: "~/Desktop/工作区",
  files: 1284,
  size: "3.2 GB",
  topics: 9,
  indexed: "2 小时前",
};

export const KIND_LABEL: Record<FileKind, string> = {
  pdf: "PDF",
  xlsx: "XLSX",
  csv: "CSV",
  fig: "FIG",
  png: "PNG",
  jpg: "JPG",
  svg: "SVG",
  heic: "HEIC",
  md: "MD",
  docx: "DOCX",
  zip: "ZIP",
  txt: "TXT",
  ppt: "PPT",
  code: "CODE",
  other: "FILE",
};

export const KIND_NAME: Record<FileKind, string> = {
  pdf: "PDF 文档",
  xlsx: "Excel 表格",
  csv: "CSV 数据",
  fig: "Figma 源文件",
  png: "PNG 图片",
  jpg: "JPG 图片",
  svg: "SVG 矢量图",
  heic: "HEIC 图片",
  md: "Markdown 文档",
  docx: "Word 文档",
  zip: "压缩包",
  txt: "纯文本",
  ppt: "演示文稿",
  code: "代码文件",
  other: "其他文件",
};

export const financeFiles: FileItem[] = [
  {
    id: "fin-q3-revenue",
    name: "2026-Q3-营收分析.pdf",
    path: "01-财务/2026/Q3/2026-Q3-营收分析.pdf",
    kind: "pdf",
    size: "2.4 MB",
    modified: "3 天前",
  },
  {
    id: "fin-q3-monthly",
    name: "2026-Q3-经营月报.xlsx",
    path: "01-财务/2026/Q3/2026-Q3-经营月报.xlsx",
    kind: "xlsx",
    size: "840 KB",
    modified: "5 天前",
  },
  {
    id: "fin-budget",
    name: "2026 年度预算-v4.xlsx",
    path: "01-财务/2026/预算/2026 年度预算-v4.xlsx",
    kind: "xlsx",
    size: "1.2 MB",
    modified: "2 周前",
  },
  {
    id: "fin-q2-revenue",
    name: "2026-Q2-营收分析.pdf",
    path: "01-财务/2026/Q2/2026-Q2-营收分析.pdf",
    kind: "pdf",
    size: "1.9 MB",
    modified: "2 个月前",
  },
  {
    id: "fin-investor-update",
    name: "投资人更新-2026-10.md",
    path: "01-财务/投资人/投资人更新-2026-10.md",
    kind: "md",
    size: "24 KB",
    modified: "3 周前",
  },
  {
    id: "fin-cashflow",
    name: "现金流预测-2027.xlsx",
    path: "01-财务/预测/现金流预测-2027.xlsx",
    kind: "xlsx",
    size: "512 KB",
    modified: "6 天前",
  },
];

export const designFiles: FileItem[] = [
  {
    id: "design-home-v3",
    name: "首页改版-v3.fig",
    path: "02-设计/首页改版/首页改版-v3.fig",
    kind: "fig",
    size: "18.6 MB",
    modified: "昨天",
  },
  {
    id: "design-empty",
    name: "移动端-空状态.png",
    path: "02-设计/移动端/移动端-空状态.png",
    kind: "png",
    size: "1.1 MB",
    modified: "4 天前",
  },
  {
    id: "design-spec",
    name: "设计规范-颜色与间距.pdf",
    path: "02-设计/规范/设计规范-颜色与间距.pdf",
    kind: "pdf",
    size: "3.2 MB",
    modified: "1 个月前",
  },
  {
    id: "design-button",
    name: "组件库-Button.png",
    path: "02-设计/组件/组件库-Button.png",
    kind: "png",
    size: "640 KB",
    modified: "2 周前",
  },
  {
    id: "design-journey",
    name: "用户旅程图-2026.png",
    path: "02-设计/研究/用户旅程图-2026.png",
    kind: "png",
    size: "2.8 MB",
    modified: "3 周前",
  },
  {
    id: "design-ia",
    name: "仪表盘-信息架构.md",
    path: "02-设计/仪表盘/仪表盘-信息架构.md",
    kind: "md",
    size: "18 KB",
    modified: "昨天",
  },
];

export const researchFiles: FileItem[] = [
  {
    id: "research-interview-1",
    name: "访谈记录-创作者-01.md",
    path: "03-研究/访谈/访谈记录-创作者-01.md",
    kind: "md",
    size: "32 KB",
    modified: "6 天前",
  },
  {
    id: "research-interview-2",
    name: "访谈记录-创作者-02.md",
    path: "03-研究/访谈/访谈记录-创作者-02.md",
    kind: "md",
    size: "28 KB",
    modified: "6 天前",
  },
  {
    id: "research-survey",
    name: "问卷结果-2026Q3.csv",
    path: "03-研究/问卷/问卷结果-2026Q3.csv",
    kind: "csv",
    size: "1.4 MB",
    modified: "2 周前",
  },
  {
    id: "research-competitor",
    name: "竞品分析-Notion.md",
    path: "03-研究/竞品/竞品分析-Notion.md",
    kind: "md",
    size: "41 KB",
    modified: "1 个月前",
  },
  {
    id: "research-usability",
    name: "可用性测试-汇总.pdf",
    path: "03-研究/可用性/可用性测试-汇总.pdf",
    kind: "pdf",
    size: "5.6 MB",
    modified: "3 周前",
  },
];

export const meetingFiles: FileItem[] = [
  {
    id: "meeting-weekly",
    name: "2026-11-18-产品周会.md",
    path: "04-会议/2026-11/2026-11-18-产品周会.md",
    kind: "md",
    size: "12 KB",
    modified: "4 天前",
  },
  {
    id: "meeting-growth",
    name: "2026-11-11-增长复盘.md",
    path: "04-会议/2026-11/2026-11-11-增长复盘.md",
    kind: "md",
    size: "16 KB",
    modified: "1 周前",
  },
  {
    id: "meeting-design",
    name: "2026-10-28-设计评审.md",
    path: "04-会议/2026-10/2026-10-28-设计评审.md",
    kind: "md",
    size: "9 KB",
    modified: "3 周前",
  },
  {
    id: "meeting-quarter",
    name: "2026-10-21-季度规划.md",
    path: "04-会议/2026-10/2026-10-21-季度规划.md",
    kind: "md",
    size: "22 KB",
    modified: "1 个月前",
  },
  {
    id: "meeting-1on1",
    name: "1:1-与设计负责人.md",
    path: "04-会议/1on1/1:1-与设计负责人.md",
    kind: "md",
    size: "8 KB",
    modified: "5 天前",
  },
];

export const contractFiles: FileItem[] = [
  {
    id: "contract-cloud",
    name: "云服务合同-2026.pdf",
    path: "05-合同/2026/云服务合同-2026.pdf",
    kind: "pdf",
    size: "1.8 MB",
    modified: "2 个月前",
  },
  {
    id: "contract-office",
    name: "办公室租约-续签.pdf",
    path: "05-合同/2026/办公室租约-续签.pdf",
    kind: "pdf",
    size: "4.1 MB",
    modified: "1 个月前",
  },
  {
    id: "contract-invoice-ali",
    name: "发票-2026-10-阿里云.pdf",
    path: "05-合同/发票/2026/发票-2026-10-阿里云.pdf",
    kind: "pdf",
    size: "220 KB",
    modified: "3 周前",
  },
  {
    id: "contract-invoice-tencent",
    name: "发票-2026-09-腾讯云.pdf",
    path: "05-合同/发票/2026/发票-2026-09-腾讯云.pdf",
    kind: "pdf",
    size: "198 KB",
    modified: "2 个月前",
  },
  {
    id: "contract-nda",
    name: "NDA-合作方-2026.pdf",
    path: "05-合同/NDA/NDA-合作方-2026.pdf",
    kind: "pdf",
    size: "760 KB",
    modified: "4 个月前",
  },
];

export const techFiles: FileItem[] = [
  {
    id: "tech-rag",
    name: "RAG-检索策略.md",
    path: "06-技术/RAG/RAG-检索策略.md",
    kind: "md",
    size: "36 KB",
    modified: "昨天",
  },
  {
    id: "tech-deepseek",
    name: "DeepSeek-API-笔记.md",
    path: "06-技术/模型/DeepSeek-API-笔记.md",
    kind: "md",
    size: "28 KB",
    modified: "2 天前",
  },
  {
    id: "tech-vector",
    name: "向量索引-选型对比.md",
    path: "06-技术/RAG/向量索引-选型对比.md",
    kind: "md",
    size: "44 KB",
    modified: "1 周前",
  },
  {
    id: "tech-fts",
    name: "SQLite-FTS5-中文分词.md",
    path: "06-技术/检索/SQLite-FTS5-中文分词.md",
    kind: "md",
    size: "19 KB",
    modified: "2 周前",
  },
  {
    id: "tech-deploy",
    name: "部署-checklist.md",
    path: "06-技术/部署/部署-checklist.md",
    kind: "md",
    size: "11 KB",
    modified: "5 天前",
  },
];

export const readingFiles: FileItem[] = [
  {
    id: "read-second-brain",
    name: "《打造第二大脑》摘录.md",
    path: "07-阅读/书摘/《打造第二大脑》摘录.md",
    kind: "md",
    size: "52 KB",
    modified: "3 周前",
  },
  {
    id: "read-card-notes",
    name: "《卡片笔记写作法》笔记.md",
    path: "07-阅读/书摘/《卡片笔记写作法》笔记.md",
    kind: "md",
    size: "38 KB",
    modified: "1 个月前",
  },
  {
    id: "read-palace",
    name: "关于记忆宫殿的几篇文章.md",
    path: "07-阅读/主题/关于记忆宫殿的几篇文章.md",
    kind: "md",
    size: "26 KB",
    modified: "2 周前",
  },
  {
    id: "read-attention",
    name: "长文-注意力与工作记忆.pdf",
    path: "07-阅读/长文/长文-注意力与工作记忆.pdf",
    kind: "pdf",
    size: "3.4 MB",
    modified: "1 个月前",
  },
  {
    id: "read-podcast",
    name: "播客-知识管理-文字稿.md",
    path: "07-阅读/播客/播客-知识管理-文字稿.md",
    kind: "md",
    size: "64 KB",
    modified: "6 周前",
  },
];

export const imageFiles: FileItem[] = [
  {
    id: "image-concept-1",
    name: "首页-概念图-01.png",
    path: "08-素材/首页/首页-概念图-01.png",
    kind: "png",
    size: "4.2 MB",
    modified: "2 天前",
  },
  {
    id: "image-concept-2",
    name: "首页-概念图-02.png",
    path: "08-素材/首页/首页-概念图-02.png",
    kind: "png",
    size: "3.8 MB",
    modified: "2 天前",
  },
  {
    id: "image-moodboard",
    name: "品牌-情绪板.jpg",
    path: "08-素材/品牌/品牌-情绪板.jpg",
    kind: "jpg",
    size: "6.1 MB",
    modified: "3 周前",
  },
  {
    id: "image-icons",
    name: "图标-线性-合集.svg",
    path: "08-素材/图标/图标-线性-合集.svg",
    kind: "svg",
    size: "320 KB",
    modified: "1 周前",
  },
  {
    id: "image-team",
    name: "团队合影-2026-10.jpg",
    path: "08-素材/团队/团队合影-2026-10.jpg",
    kind: "jpg",
    size: "8.4 MB",
    modified: "1 个月前",
  },
];

export const unsortedFiles: FileItem[] = [
  {
    id: "unsorted-scan",
    name: "扫描件-2026-11-20.pdf",
    path: "00-收件箱/扫描件-2026-11-20.pdf",
    kind: "pdf",
    size: "2.2 MB",
    modified: "2 天前",
  },
  {
    id: "unsorted-photo",
    name: "IMG_4821.HEIC",
    path: "00-收件箱/照片/IMG_4821.HEIC",
    kind: "heic",
    size: "3.1 MB",
    modified: "4 天前",
  },
  {
    id: "unsorted-note",
    name: "未命名-3.md",
    path: "00-收件箱/未命名-3.md",
    kind: "md",
    size: "6 KB",
    modified: "1 周前",
  },
  {
    id: "unsorted-report",
    name: "报表(1).xlsx",
    path: "00-收件箱/下载/报表(1).xlsx",
    kind: "xlsx",
    size: "480 KB",
    modified: "3 周前",
  },
];

export const topics: Topic[] = [
  {
    id: "finance",
    name: "财务与报表",
    count: 218,
    blurb: "营收、预算、月报与投资人更新。",
    x: 185,
    y: 150,
    kinds: [
      { label: "文档", pct: 42 },
      { label: "表格", pct: 38 },
      { label: "PDF", pct: 20 },
    ],
    related: [
      { topicId: "contracts", reason: "共享 24 个金额条款" },
      { topicId: "meetings", reason: "季度经营会纪要" },
    ],
    files: financeFiles,
  },
  {
    id: "design",
    name: "产品设计",
    count: 246,
    blurb: "界面稿、组件规范与设计评审。",
    x: 420,
    y: 105,
    kinds: [
      { label: "图片", pct: 52 },
      { label: "文档", pct: 31 },
      { label: "源文件", pct: 17 },
    ],
    related: [
      { topicId: "images", reason: "86 张设计稿与导出图" },
      { topicId: "research", reason: "用户旅程与访谈" },
    ],
    files: designFiles,
  },
  {
    id: "research",
    name: "用户研究",
    count: 112,
    blurb: "访谈、问卷、竞品与可用性测试。",
    x: 665,
    y: 145,
    kinds: [
      { label: "文档", pct: 61 },
      { label: "表格", pct: 24 },
      { label: "PDF", pct: 15 },
    ],
    related: [
      { topicId: "reading", reason: "研究素材与摘录" },
      { topicId: "design", reason: "用户旅程与访谈" },
    ],
    files: researchFiles,
  },
  {
    id: "meetings",
    name: "会议与纪要",
    count: 167,
    blurb: "周会、评审、1:1 与季度规划。",
    x: 835,
    y: 285,
    kinds: [
      { label: "文档", pct: 78 },
      { label: "表格", pct: 12 },
      { label: "其他", pct: 10 },
    ],
    related: [
      { topicId: "finance", reason: "季度经营会纪要" },
      { topicId: "tech", reason: "周会里的技术议题" },
    ],
    files: meetingFiles,
  },
  {
    id: "contracts",
    name: "合同与发票",
    count: 79,
    blurb: "云服务、租约、NDA 与报销凭证。",
    x: 650,
    y: 420,
    kinds: [
      { label: "PDF", pct: 72 },
      { label: "图片", pct: 18 },
      { label: "其他", pct: 10 },
    ],
    related: [{ topicId: "finance", reason: "共享 24 个金额条款" }],
    files: contractFiles,
  },
  {
    id: "tech",
    name: "技术文档",
    count: 143,
    blurb: "RAG、DeepSeek、索引与部署笔记。",
    x: 415,
    y: 430,
    kinds: [
      { label: "文档", pct: 64 },
      { label: "代码", pct: 22 },
      { label: "表格", pct: 14 },
    ],
    related: [
      { topicId: "reading", reason: "RAG 笔记与书摘" },
      { topicId: "meetings", reason: "周会里的技术议题" },
    ],
    files: techFiles,
  },
  {
    id: "reading",
    name: "阅读与摘录",
    count: 104,
    blurb: "书摘、长文、播客文字稿。",
    x: 185,
    y: 365,
    kinds: [
      { label: "文档", pct: 70 },
      { label: "PDF", pct: 20 },
      { label: "其他", pct: 10 },
    ],
    related: [
      { topicId: "tech", reason: "RAG 笔记与书摘" },
      { topicId: "research", reason: "研究素材与摘录" },
    ],
    files: readingFiles,
  },
  {
    id: "images",
    name: "图片与素材",
    count: 178,
    blurb: "概念图、情绪板、图标与截图。",
    x: 330,
    y: 260,
    kinds: [
      { label: "图片", pct: 88 },
      { label: "源文件", pct: 12 },
    ],
    related: [
      { topicId: "design", reason: "86 张设计稿与导出图" },
      { topicId: "unsorted", reason: "未归档的截图与素材" },
    ],
    files: imageFiles,
  },
  {
    id: "unsorted",
    name: "未归类",
    count: 37,
    blurb: "还没找到归属的文件。",
    x: 540,
    y: 265,
    kinds: [
      { label: "PDF", pct: 40 },
      { label: "图片", pct: 33 },
      { label: "其他", pct: 27 },
    ],
    related: [{ topicId: "images", reason: "未归档的截图与素材" }],
    files: unsortedFiles,
  },
];

export const activity: ActivityDatum[] = [
  { label: "10/04", value: 84 },
  { label: "10/11", value: 112 },
  { label: "10/18", value: 96 },
  { label: "10/25", value: 148 },
  { label: "11/01", value: 121 },
  { label: "11/08", value: 176 },
  { label: "11/15", value: 142 },
  { label: "11/22", value: 205 },
];

export const typeDistribution: TypeDatum[] = [
  { label: "文档", value: 612 },
  { label: "图片", value: 318 },
  { label: "表格", value: 164 },
  { label: "演示", value: 97 },
  { label: "其他", value: 93 },
];

export const recentQueries: RecentQuery[] = [
  {
    id: "q1",
    query: "上周那份讲营收的 PDF",
    results: 2,
    time: "12 分钟前",
  },
  {
    id: "q2",
    query: "设计稿的首页截图",
    results: 6,
    time: "今天 09:41",
  },
  {
    id: "q3",
    query: "Q3 的合同续签",
    results: 1,
    time: "昨天",
  },
  {
    id: "q4",
    query: "上次看的关于 RAG 的文章",
    results: 3,
    time: "11/20",
  },
];

export const memories: MemoryEntry[] = [
  {
    id: "mem-1",
    kind: "alias",
    text: "「月报」指代季度经营分析报告。",
    source: "你说过",
    uses: 8,
  },
  {
    id: "mem-2",
    kind: "preference",
    text: "按时间而不是目录浏览文件。",
    source: "观察 + 确认",
    uses: 14,
  },
  {
    id: "mem-3",
    kind: "context",
    text: "最近在找 2026 Q3 的营收数据。",
    source: "上次会话",
    uses: 3,
  },
  {
    id: "mem-4",
    kind: "correction",
    text: "「设计稿」指 Figma 导出图，不是截图。",
    source: "你纠正过",
    uses: 2,
  },
];

export const auditEvents: AuditEvent[] = [
  {
    id: "a1",
    time: "2 小时前",
    action: "索引完成",
    detail: "1,284 个文件 · 0 个失败",
    tone: "good",
  },
  {
    id: "a2",
    time: "昨天 18:02",
    action: "移入废纸篓",
    detail: "3 个旧合同 · 30 天内可恢复",
    tone: "warn",
  },
  {
    id: "a3",
    time: "11/20 10:14",
    action: "越界读取已拦截",
    detail: "尝试访问工作区外的 .ssh/id_rsa",
    tone: "critical",
  },
  {
    id: "a4",
    time: "11/19 16:37",
    action: "读取文件",
    detail: "RAG-检索策略.md · 只读",
    tone: "neutral",
  },
];

export const evalMetrics = [
  { label: "recall@5", value: "0.86", delta: "+0.02" },
  { label: "MRR", value: "0.64", delta: "+0.01" },
  { label: "hit@1", value: "0.52", delta: "−0.03" },
  { label: "e2e", value: "0.71", delta: "+0.04" },
];

export const evalTrend = [0.78, 0.81, 0.79, 0.83, 0.84, 0.86];

export const evalFails: EvalFail[] = [
  {
    id: "q007",
    expected: "finance/2026-Q2.pdf",
    got: "notes/q2.md",
  },
  {
    id: "q014",
    expected: "design/mockups/home.png",
    got: "无结果",
  },
];

export const duplicateContracts: FileItem[] = [
  {
    id: "dup-1",
    name: "合同-2025-草稿.pdf",
    path: "05-合同/旧版/合同-2025-草稿.pdf",
    kind: "pdf",
    size: "1.1 MB",
    modified: "8 个月前",
  },
  {
    id: "dup-2",
    name: "合同-2025-草稿 (1).pdf",
    path: "05-合同/旧版/合同-2025-草稿 (1).pdf",
    kind: "pdf",
    size: "1.1 MB",
    modified: "8 个月前",
  },
  {
    id: "dup-3",
    name: "合同-2025-草稿 (2).pdf",
    path: "05-合同/旧版/合同-2025-草稿 (2).pdf",
    kind: "pdf",
    size: "1.1 MB",
    modified: "8 个月前",
  },
];

export function nodeTone(count: number): number {
  if (count >= 200) return 1;
  if (count >= 150) return 2;
  if (count >= 115) return 3;
  if (count >= 80) return 4;
  return 5;
}

/** 真实工作区的文件数可能很小，按相对大小分档比固定阈值更稳定。 */
export function toneForCount(count: number, max: number): number {
  const ratio = max > 0 ? count / max : 0;
  if (ratio >= 0.8) return 1;
  if (ratio >= 0.6) return 2;
  if (ratio >= 0.4) return 3;
  if (ratio >= 0.2) return 4;
  return 5;
}

export function isUnsortedTopic(topic: { id: string; name: string }): boolean {
  return topic.id === "unsorted" || topic.name === "未归类";
}

export function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(0, i);
}
