import fs from "node:fs";
import path from "node:path";
import { PolicyError } from "./paths.ts";

/**
 * 把文件移进系统废纸篓（macOS 的 ~/.Trash，可用 MP_TRASH_DIR 覆盖）。
 *
 * 这里只用 rename，永远不会 unlink/rm。同卷移动是原子操作；跨卷（EXDEV）
 * 直接报错，不做「复制再删除」——那等于绕过废纸篓的可恢复语义。
 */
export function moveToTrash(
  absPath: string,
  trashDir: string,
): { trashPath: string } {
  const stat = fs.lstatSync(absPath);
  if (stat.isSymbolicLink()) {
    throw new PolicyError("permission_denied", "不接受符号链接");
  }
  if (!stat.isFile()) {
    throw new PolicyError("not_a_file", "只支持删除普通文件");
  }

  fs.mkdirSync(trashDir, { recursive: true });
  const trashStat = fs.statSync(trashDir);
  if (!trashStat.isDirectory()) {
    throw new PolicyError("not_a_directory", "废纸篓路径不是目录");
  }

  const base = path.basename(absPath);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;

  let target = path.join(trashDir, base);
  let counter = 2;
  while (fs.existsSync(target)) {
    target = path.join(trashDir, `${stem} ${counter}${ext}`);
    counter += 1;
    if (counter > 10_000) {
      throw new PolicyError("invalid_path", "废纸篓里同名文件太多");
    }
  }

  try {
    fs.renameSync(absPath, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EXDEV") {
      throw new PolicyError("invalid_path", "文件不在废纸篓所在的磁盘上，暂不支持跨磁盘删除");
    }
    throw error;
  }

  return { trashPath: target };
}
