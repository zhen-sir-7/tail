# tail — 项目打磨工具

AI 搭建完产品后，从细节修复与工作流优化的角度不断完善项目。

## 结构

```
tail/
├── packages/
│   ├── tail/             轻量级打磨 CLI
│   │   └── tail scan/fix/loop  — 上下文感知的循环优化
│   └── tail-insights/    数据驱动分析工具
│       └── insights crawl/export — 从 GitHub issue 学习模式
└── README.md
```

## 快速开始

```bash
# tail — 打磨项目
cd packages/tail
npm link
tail init
tail scan
tail loop --auto

# tail-insights — 学习模式
cd packages/tail-insights
npm link
insights crawl owner/repo1 owner/repo2
insights list
insights export ../tail/lib/engine.js
```

## 理念

- **先理解，再检查**: 自动分析项目类型（frontend/cli/backend），只跑相关检查
- **数据驱动**: 从真实 AI 项目的 issue 中归纳共性问题，而不是拍脑袋定义规则
- **循环迭代**: scan → fix → review → loop，直到达到目标质量分
