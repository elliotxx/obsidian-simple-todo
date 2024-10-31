# Obsidian Simple Todo

一个极简的、基于文本的 Todo 管理器（Text-Based GTD）插件，帮助你在 Obsidian 中高效管理任务。

## 功能特点

- 📝 基于纯文本，完全符合 Markdown 语法
- 🎯 支持快速添加、编辑和完成任务
- 🗂 简单的任务分类管理
- 📅 支持按日期组织任务
- 🔄 支持任务状态切换（待办/进行中/已完成）
- 📦 支持归档已完成任务

## 安装方法

1. 在 Obsidian 中打开设置
2. 进入 "第三方插件"
3. 关闭 "安全模式"
4. 点击 "浏览" 并搜索 "Simple Todo"
5. 点击安装
6. 启用插件

## 使用方法

### 基本语法

```
2024-10-30 周三  
- [ ] 创建待办任务  
- [x] 标记任务为已完成  
- [/] 标记任务为进行中  
```

注意：
- 日期和时间格式必须为 `2024-10-30 周三`，否则无法识别
- 任务前必须添加 `- [ ]` 或 `- [x]` 或 `- [/]` 才能被识别为任务

### 支持的命令
- `Toggle Todo Status` - 切换任务状态（待办 -> 进行中 -> 已完成 -> 待办）
- `Reschedule Previous Todos` - 重新规划未完成任务（将最近一天的未完成任务移动到今天）
- `Archive Completed Todos` - 归档已完成任务（移动到按月份命名的归档文件中）

### 任务状态说明
- `- [ ]` - 待办任务
- `- [/]` - 进行中的任务
- `- [x]` - 已完成的任务

### 重新规划任务
- 插件会自动查找今天之前最近的一天中的未完成任务
- 如果找到未完成任务，会将它们移动到今天的日期下
- 如果今天的日期不存在，会自动创建今天的日期并添加任务

### 归档功能
- 归档文件按月份自动命名（例如：`archive-2024-03.md`）
- 已完成的任务会被移动到归档文件中
- 原文件中的已完成任务会被删除

## 本地开发指南

### 环境准备

1. 安装 Node.js (推荐使用 LTS 版本)
2. 安装 pnpm (推荐) 或 npm
3. 克隆项目到本地：
```bash
git clone https://github.com/your-username/obsidian-simple-todo.git
```

### 开发设置

1. 安装依赖：
```bash
cd obsidian-simple-todo
pnpm install
```

2. 创建开发环境配置文件 `.env`：
```
OBSIDIAN_TEST_VAULT=path/to/your/test/vault
```

3. 创建软链接到测试 vault：
```bash
# Windows (管理员权限)
mklink /D "path/to/vault/.obsidian/plugins/obsidian-simple-todo" "path/to/your/project"

# macOS/Linux
ln -s "path/to/your/project" "path/to/vault/.obsidian/plugins/obsidian-simple-todo"
```

### 开发工作流

1. 启动开发服务器：
```bash
pnpm dev
```

2. 在 Obsidian 中：
   - 打开设置 > 第三方插件
   - 关闭安全模式
   - 刷新已安装插件列表
   - 启用 "Simple Todo" 插件

3. 修改代码后：
   - 保存文件会自动重新构建
   - 在 Obsidian 中按 `Ctrl/Cmd + R` 重新加载

### 项目结构

```
obsidian-simple-todo/
├── src/
│   ├── main.ts          # 插件主文件
│   └── types.ts         # 类型定义
├── manifest.json        # 插件清单
├── package.json         # 项目配置
├── tsconfig.json        # TypeScript 配置
└── README.md           # 文档
```

### 构建发布

1. 构建生产版本：
```bash
pnpm build
```

2. 发布前检查清单：
   - 更新 `manifest.json` 中的版本号
   - 更新 `package.json` 中的版本号
   - 更新 `versions.json`
   - 提交所有更改
   - 创建新的 release tag

## 贡献

欢迎提交 Issues 和 Pull Requests！

## 许可证

MIT License
