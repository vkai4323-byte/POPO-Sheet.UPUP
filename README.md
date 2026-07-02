# POPO-Sheet.UPUP

为 POPO / office.netease.com 在线表格填表任务设计的 Codex skill。

## 适用场景

- 处理 canvas 渲染、没有 DOM 单元格的 POPO 表格。
- 按达人名匹配源数据，把粉丝数、主页链接等字段填到对应行。
- 批量生成可粘贴 TSV，减少逐格鼠标点击。
- 写入前生成匹配报告，写入后复制回校验。

## 文件结构

- `SKILL.md`: skill 主说明和默认工作流。
- `references/popo-sheet-reference.md`: POPO 表格限制、失败模式和操作细节。
- `scripts/name_match_tsv.py`: 根据源数据和 POPO 复制 TSV 生成粘贴块与匹配报告。
