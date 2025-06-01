# koishi-plugin-chat-model

[![npm](https://img.shields.io/npm/v/koishi-plugin-chat-model?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-chat-model)

当消息没有触发其他命令时，自动使用大型语言模型（LLM）进行对话，支持记忆上下文。

## 功能特点

- 支持多种大型语言模型：
  - OpenAI GPT系列 (GPT-3.5-turbo、GPT-4等)
  - Anthropic Claude系列 (Claude 3 Opus、Claude 3 Sonnet、Claude 3 Haiku等)
  - Google Gemini系列 (Gemini Pro、Gemini 1.5等)
  - 自定义模型 (通过适配器支持)
- 自动在没有匹配到其他命令的情况下触发对话
- 保持上下文记忆，支持连续对话
- 可配置触发条件（私聊/群聊、前缀、触发概率等）
- 支持自定义系统提示语
- 支持用户使用限制（每日最大对话次数）
- 提供清除上下文的命令

## 安装

```bash
npm install koishi-plugin-chat-model
```

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
|-------|------|-------|------|
| modelType | select | openai | 对话模型类型，可选：openai、claude、gemini、custom |
| apiKey | string | | API密钥，必填 |
| apiEndpoint | string | (根据模型不同) | API地址，可选，用于修改默认API端点 |
| modelName | string | (根据模型不同) | 模型名称，如：gpt-3.5-turbo、claude-3-sonnet等 |
| systemPrompt | string | 你是一个有用的AI助手。 | 系统提示词，用于定义AI助手的行为和能力 |
| contextSize | number | 10 | 上下文记忆的消息数量（轮数），每轮包含一条用户消息和一条助手回复 |
| temperature | number | 0.7 | 温度参数，控制回复的随机性，0-2之间 |
| responseTimeout | number | 60 | 响应超时时间，单位为秒 |
| triggerRatio | number | 100 | 触发概率，范围0-100%之间 |
| triggerPrefix | string | | 触发前缀，不填则任何未命中命令的消息都会触发 |
| triggerPrivate | boolean | true | 是否在私聊中自动触发 |
| triggerGroup | boolean | false | 是否在群聊中自动触发 |
| showThinkingMessage | boolean | false | 是否显示"正在思考中..."的消息，默认不显示 |
| customModelAdapter | string | | 自定义模型适配器路径（仅在modelType=custom时有效） |
| usageLimit.enabled | boolean | false | 是否启用使用限制 |
| usageLimit.maxMessagesPerUser | number | 100 | 每用户每日最大消息数 |
| usageLimit.resetTime | string | 00:00 | 使用计数重置时间，24小时制 |

## 使用方法

1. 在Koishi应用中安装并启用本插件
2. 配置相应的API密钥和其他设置
3. 向机器人发送不匹配其他命令的消息即可触发对话

### 清除上下文

当需要重置对话上下文时，可使用以下命令：

```
清除上下文
```

### 使用系统提示词

通过修改系统提示词，可以改变AI助手的行为和风格。例如：

```
你是一位资深的编程助手，擅长解答与JavaScript、Python和数据库相关的问题，回答简洁专业，并提供实用的代码示例。
```

### 使用前缀过滤

如果只希望特定格式的消息触发AI对话，可以设置`triggerPrefix`。比如设置为`@AI `（注意结尾有空格），则只有以`@AI `开头的消息才会触发AI回复。

## 自定义模型适配器

如果需要支持其他语言模型，可以创建自定义适配器：

1. 创建一个实现了`generateResponse`方法的类
2. 将该类的路径填入`customModelAdapter`配置项
3. 设置`modelType`为`custom`

自定义适配器的最小实现示例：

```javascript
class CustomAdapter {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
  }
  
  async generateResponse(messages, session) {
    // 实现与您的模型API通信的逻辑
    // 返回生成的文本回复
    return '这是自定义模型的回复'
  }
  
  async dispose() {
    // 清理资源（如果需要）
  }
}

module.exports = CustomAdapter
```

## 数据库表

本插件会创建以下数据库表：

- `chatModelContext`：存储用户的对话上下文
- `chatModelUsage`：存储用户的使用统计

## 版本更新

### v1.0.4
- 修复了回复后发送多余"true"消息的问题
- 优化中间件处理逻辑，提高稳定性

### v1.0.3
- 修复使用限制功能无法正常工作的问题
- 添加可选的"正在思考中..."消息配置，默认关闭
- 解决多余的"true"消息问题

### v1.0.2
- 修复了 `fetch is not a function` 错误
- 使用 node-fetch 和 abort-controller 替代内置 fetch

## 协议

MIT 