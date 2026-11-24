/**
 * PDF 抽取偶尔会给出「康熙部首 / CJK 部首补充」字符（如 ⼀、⻓），
 * 它们看起来像汉字但不是同一个码位，会让搜索直接失灵。
 * 这里只修部首，不做整串 NFKC——整串会把中文全角标点改成半角。
 */
const RADICAL_MAP: Record<string, string> = {
  "⻄": "西",
  "⻅": "见",
  "⻉": "贝",
  "⻋": "车",
  "⻓": "长",
  "⻔": "门",
  "⻘": "青",
  "⻙": "韦",
  "⻚": "页",
  "⻛": "风",
  "⻜": "飞",
  "⻝": "食",
  "⻢": "马",
  "⻣": "骨",
  "⻤": "鬼",
  "⻥": "鱼",
  "⻦": "鸟",
  "⻨": "麦",
  "⻩": "黄",
  "⻮": "齿",
  "⻰": "龙",
  "⻳": "龟",
};

export function normalizeExtractedText(input: string): string {
  let out = "";
  for (const char of input) {
    const mapped = RADICAL_MAP[char];
    if (mapped) {
      out += mapped;
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    // 康熙部首（U+2F00–U+2FDF）都有 NFKC 映射，且不会碰到标点。
    if (code >= 0x2f00 && code <= 0x2fdf) {
      const normalized = char.normalize("NFKC");
      out += /[㐀-鿿]/.test(normalized) ? normalized : char;
      continue;
    }
    out += char;
  }
  return out.replace(/\r\n?/g, "\n");
}
