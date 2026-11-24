export interface InjectionScan {
  suspected: boolean;
  signals: string[];
}

const SIGNALS: Array<{ name: string; pattern: RegExp }> = [
  { name: "ignore_previous", pattern: /ignore\s+(all\s+)?previous\s+instructions/i },
  { name: "system_tag", pattern: /<\/?system>|^\s*system\s*:/im },
  { name: "you_are_now", pattern: /you\s+are\s+now\b/i },
  { name: "ignore_chinese", pattern: /忽略(之前|以上|前面)的?(指令|规则|要求)/ },
  { name: "rm_rf", pattern: /\brm\s+-rf\b/i },
  { name: "delete_all", pattern: /删除(所有|全部)文件/ },
  { name: "run_command", pattern: /执行以下(命令|指令)/ },
  { name: "exfiltrate", pattern: /(泄露|发送).{0,20}(密钥|密码|token|api\s*key)/i },
];

const LONG_LINE_BASE64 = /[A-Za-z0-9+/]{200,}={0,2}/;

export function scanInjection(text: string): InjectionScan {
  const signals: string[] = [];
  for (const signal of SIGNALS) {
    if (signal.pattern.test(text)) signals.push(signal.name);
  }
  if (LONG_LINE_BASE64.test(text)) signals.push("long_base64_line");
  return { suspected: signals.length > 0, signals };
}
