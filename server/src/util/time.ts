export interface TimeRange {
  after: number;
  before: number;
  label: string;
}

const DAY = 86_400_000;

export function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function startOfWeek(ms: number): number {
  // 周一为一周起点。
  const day = startOfDay(ms);
  const date = new Date(day);
  const dow = date.getDay();
  const delta = dow === 0 ? 6 : dow - 1;
  return day - delta * DAY;
}

export function addDays(ms: number, days: number): number {
  return ms + days * DAY;
}

export function endOfDay(ms: number): number {
  return startOfDay(ms) + DAY - 1;
}

/** 从自然语言里识别粗粒度时间范围。只作为排序信号，不做硬过滤。 */
export function parseTimeHint(query: string, now = Date.now()): TimeRange | null {
  const text = query.toLowerCase();

  const recent = text.match(/最近\s*(\d+)\s*天/);
  if (recent) {
    const days = Math.max(1, Number(recent[1]));
    return {
      after: addDays(startOfDay(now), -(days - 1)),
      before: now,
      label: `最近 ${days} 天`,
    };
  }

  if (/今天|今日/.test(text)) {
    return { after: startOfDay(now), before: now, label: "今天" };
  }

  if (/昨天|昨日/.test(text)) {
    const start = addDays(startOfDay(now), -1);
    return { after: start, before: endOfDay(start), label: "昨天" };
  }

  if (/上周|上个星期|上星期/.test(text)) {
    const thisWeek = startOfWeek(now);
    const start = addDays(thisWeek, -7);
    return { after: start, before: thisWeek - 1, label: "上周" };
  }

  if (/本周|这周|这个星期/.test(text)) {
    return { after: startOfWeek(now), before: now, label: "本周" };
  }

  if (/上个月|上月/.test(text)) {
    const date = new Date(now);
    const start = new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime();
    const end = new Date(date.getFullYear(), date.getMonth(), 1).getTime() - 1;
    return { after: start, before: end, label: "上个月" };
  }

  if (/本月|这个月/.test(text)) {
    const date = new Date(now);
    const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    return { after: start, before: now, label: "本月" };
  }

  return null;
}

export function inRange(ms: number, range: TimeRange): boolean {
  return ms >= range.after && ms <= range.before;
}
