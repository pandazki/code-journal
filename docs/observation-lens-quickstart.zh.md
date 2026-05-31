# 协作观测 Lens — 快速上手

> 零配置。只要你在用 coding agent(Claude Code / Codex / Cowork),需要的东西
> 早就在你硬盘上了。三条命令 + 一个网页。
>
> English: [`observation-lens-quickstart.md`](observation-lens-quickstart.md) ·
> 完整指南:[`observation-lens.zh.md`](observation-lens.zh.md)

## 你会得到什么

一次回看:**是「你」在 AI 编程会话里设定了方向的那些时刻**——你 steer 了工作、
否决了 agent 的提议、或者提出了新关切。这不是生产力评分,是一面镜子:每一行都
指回你 transcript 里真实说过的话。

## 开始之前

你的 PATH 上要有 `claude` CLI —— lens 用你自己的 agent 来读你的会话,所以
**不需要 API key、不需要账号、不上传任何东西**。你的 transcript 永远不离开本机。

## 1 · 扫描

```sh
code-journal sync
```

找到你最近的编程会话,逐个用 lens 读一遍,记录发现的事件。第一次扫很多历史会
花几分钟(每个会话要跑一次你的 agent)。想先试一个项目:

```sh
code-journal sync --project 你的项目 --limit 5 --verbose
```

平淡的会话**什么都不产出**——这是对的,不是 bug。lens 从不编造事件。

## 2 · 生成审计(compose)

当一个项目积累了足够多的新事件,`sync` 会自动写一份审计。想立刻强制生成:

```sh
code-journal compose --project 你的项目
```

## 3 · 阅读 —— web console

```sh
code-journal            # 在浏览器里打开 journal
```

点角落的 **Observation →**(或直接访问
[localhost:4319/observe](http://localhost:4319/observe))。

- **ledger(账册)** 按事件密度从高到低列出项目。选一个。
- 每个 **episode** 展示:一条 stance 带(你有多少次注入方向、多少次只是批准)、
  一条显示方向**落在会话哪个位置**的密度条、以及事件本身——每条带逐字引用,
  可展开看出处和判定理由。

终端没法一次显示这么大的内容密度;console 就是为它而做的。

## 随时看状态

```sh
code-journal status
```

按项目:发现多少事件、生成几个 episode、上次跑是什么时候。

## 就这样

没有 setup,没有配置文件。时不时跑一下 `sync`(或挂个定时),想回看时打开
console。每条 lens 的含义和诚实的局限,见[完整指南](observation-lens.zh.md)。
