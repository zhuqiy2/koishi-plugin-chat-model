const { Context, Schema } = require('koishi')

// 插件名称
exports.name = 'chat-model'

// 插件配置项
exports.Config = Schema.object({
  modelType: Schema.union([
    Schema.const('openai').description('OpenAI (GPT-3.5/GPT-4)'),
    Schema.const('claude').description('Anthropic Claude'),
    Schema.const('gemini').description('Google Gemini'),
    Schema.const('custom').description('自定义模型')
  ]).default('openai').description('对话模型类型'),
  apiKey: Schema.string().role('secret').description('API密钥'),
  apiEndpoint: Schema.string().default('https://api.openai.com/v1').description('API地址(可选)'),
  modelName: Schema.string().default('gpt-3.5-turbo').description('模型名称'),
  systemPrompt: Schema.string().default('你是一个有用的AI助手。').description('系统提示词'),
  contextSize: Schema.number().default(10).description('上下文记忆的消息数量(默认: 10)'),
  temperature: Schema.number().min(0).max(2).step(0.1).default(0.7).description('温度参数(0-2之间)'),
  responseTimeout: Schema.number().default(60).description('响应超时时间(秒)'),
  triggerRatio: Schema.number().min(0).max(100).step(1).default(100).description('触发概率(0-100%之间)'),
  triggerPrefix: Schema.string().description('触发前缀，不填则任何未命中命令的消息都会触发模型响应'),
  triggerPrivate: Schema.boolean().default(true).description('是否在私聊中自动触发'),
  triggerGroup: Schema.boolean().default(false).description('是否在群聊中自动触发'),
  showThinkingMessage: Schema.boolean().default(false).description('是否显示"正在思考中..."(默认: 不显示)'),
  customModelAdapter: Schema.string().description('自定义模型适配器路径(仅modelType=custom时有效)'),
  usageLimit: Schema.object({
    enabled: Schema.boolean().default(false).description('是否启用使用限制'),
    maxMessagesPerUser: Schema.number().default(100).description('每用户每日最大消息数'),
    resetTime: Schema.string().default('00:00').description('计数重置时间(24小时制,如 00:00)')
  }).description('使用限制配置')
})

// 声明依赖的服务或插件
exports.using = ['database']

// 插件主体逻辑
exports.apply = (ctx, config) => {
  // 从lib目录加载适配器
  const ModelAdapter = loadModelAdapter(ctx, config)
  const modelInstance = new ModelAdapter(ctx, config)

  // 初始化数据库
  setupDatabase(ctx)
  
  // 消息处理器
  const messageHandler = createMessageHandler(ctx, config, modelInstance)
  
  // 注册middleware - 在消息中间件管道的末尾捕获未处理的消息
  ctx.middleware(async (session, next) => {
    // 首先尝试使用Koishi的其他处理器处理消息
    const handled = await next()
    
    // 如果消息已被处理，或者是不应该触发的消息类型，则直接返回
    if (handled || shouldIgnoreMessage(session, config)) {
      return handled
    }
    
    // 检查是否有自定义前缀，如果有则检查消息是否以该前缀开头
    if (config.triggerPrefix && !session.content.startsWith(config.triggerPrefix)) {
      return
    }
    
    // 移除前缀（如果有）
    let content = session.content
    if (config.triggerPrefix) {
      content = content.substring(config.triggerPrefix.length).trim()
    }
    
    // 如果内容为空，则不处理
    if (!content) {
      return
    }
    
    // 使用概率判断是否响应
    if (config.triggerRatio < 100 && Math.random() * 100 > config.triggerRatio) {
      ctx.logger.debug('根据概率设置不响应此消息')
      return
    }
    
    // 检查用户使用限制
    if (config.usageLimit?.enabled && !await checkUsageLimit(ctx, session.userId, config)) {
      await session.send('今日对话次数已达上限，请明天再来')
      // 设置标记但不返回true
      session._handled = true
      return
    }
    
    try {
      // 可选显示"正在思考中..."的消息
      if (config.showThinkingMessage) {
        await session.sendQueued('正在思考中...')
      }
      
      // 处理消息并发送回复
      const reply = await messageHandler(session, content)
      
      // 如果没有回复内容，则跳过发送
      if (!reply) {
        ctx.logger.warn('模型没有返回有效回复')
        return
      }
      
      // 发送回复
      await session.send(reply)
      
      // 更新用户使用计数
      if (config.usageLimit?.enabled) {
        await updateUsageCount(ctx, session.userId)
      }
      
      // 标记消息为已处理，但不显式返回true
      session._handled = true
      // 这里不返回任何值，避免"true"被发送出去
    } catch (error) {
      ctx.logger.error('处理消息时出错:', error)
      await session.send(`处理消息时出错: ${error.message}`)
      // 标记已处理但不返回true
      session._handled = true
    }
  }, true) // true表示这个中间件应该在所有其他中间件之后执行
  
  // 注册清理上下文的命令
  ctx.command('清除上下文', '清除与AI助手的对话上下文')
    .alias('/清除上下文')
    .action(async ({ session }) => {
      await clearUserContext(ctx, session.userId)
      return '已清除对话上下文'
    })
  
  // 关闭插件时清理资源
  ctx.on('dispose', async () => {
    // 清理资源
    await modelInstance.dispose()
    ctx.logger.info('聊天模型插件已卸载')
  })
}

// 加载对应的模型适配器
function loadModelAdapter(ctx, config) {
  try {
    switch(config.modelType) {
      case 'openai':
        return require('./lib/openai-adapter')
      case 'claude':
        return require('./lib/claude-adapter')
      case 'gemini':
        return require('./lib/gemini-adapter')
      case 'custom':
        if (!config.customModelAdapter) {
          throw new Error('使用自定义模型时必须提供适配器路径')
        }
        return require(config.customModelAdapter)
      default:
        ctx.logger.warn(`未知模型类型: ${config.modelType}，将使用OpenAI适配器`)
        return require('./lib/openai-adapter')
    }
  } catch (error) {
    ctx.logger.error(`加载模型适配器失败: ${error.message}`)
    throw new Error(`加载模型适配器失败: ${error.message}`)
  }
}

// 设置数据库表结构
function setupDatabase(ctx) {
  // 用于存储上下文历史记录
  ctx.model.extend('chatModelContext', {
    // 用户ID
    userId: 'string',
    // 上下文历史（作为JSON字符串存储）
    context: 'json',
    // 最后更新时间
    updatedAt: 'timestamp'
  }, {
    primary: 'userId'
  })
  
  // 用于存储使用统计
  ctx.model.extend('chatModelUsage', {
    // 用户ID
    userId: 'string',
    // 当日消息计数
    dailyCount: 'integer',
    // 上次重置时间
    lastResetDate: 'string'
  }, {
    primary: 'userId'
  })
}

// 创建消息处理器函数
function createMessageHandler(ctx, config, modelInstance) {
  return async (session, content) => {
    // 获取用户上下文
    const userContext = await getUserContext(ctx, session.userId)
    
    // 添加新的用户消息
    userContext.push({
      role: 'user',
      content: content
    })
    
    // 限制上下文大小
    while (userContext.length > config.contextSize * 2 + 1) { // +1是因为我们要保留system消息
      // 移除最早的用户消息和对应的助手回复(成对删除)
      userContext.splice(1, 2)
    }
    
    // 从配置中获取系统提示，并确保它始终是第一条消息
    if (userContext.length === 0 || userContext[0].role !== 'system') {
      userContext.unshift({
        role: 'system',
        content: config.systemPrompt
      })
    } else {
      // 更新系统提示内容
      userContext[0].content = config.systemPrompt
    }
    
    // 设置超时
    const timeout = (config.responseTimeout || 60) * 1000
    
    try {
      // 请求模型响应
      const response = await Promise.race([
        modelInstance.generateResponse(userContext, session),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('响应超时')), timeout)
        )
      ])
      
      // 添加助手回复到上下文
      userContext.push({
        role: 'assistant',
        content: response
      })
      
      // 保存更新的上下文
      await saveUserContext(ctx, session.userId, userContext)
      
      return response
    } catch (error) {
      ctx.logger.error('生成回复失败:', error)
      return `抱歉，生成回复时发生错误: ${error.message}`
    }
  }
}

// 获取用户上下文
async function getUserContext(ctx, userId) {
  const record = await ctx.database.get('chatModelContext', { userId })
  
  if (record && record.length > 0) {
    return record[0].context || []
  }
  
  return []
}

// 保存用户上下文
async function saveUserContext(ctx, userId, context) {
  const now = new Date().getTime()
  
  // 尝试更新现有记录
  const result = await ctx.database.set('chatModelContext', { userId }, {
    context,
    updatedAt: now
  })
  
  // 如果没有更新任何记录，则创建新记录
  if (result === 0) {
    await ctx.database.create('chatModelContext', {
      userId,
      context,
      updatedAt: now
    })
  }
}

// 清除用户上下文
async function clearUserContext(ctx, userId) {
  await ctx.database.set('chatModelContext', { userId }, {
    context: [],
    updatedAt: new Date().getTime()
  })
}

// 检查当前日期是否需要重置使用计数
async function checkAndResetUsage(ctx, userId, config) {
  const records = await ctx.database.get('chatModelUsage', { userId })
  
  if (!records || records.length === 0) {
    return true
  }
  
  const record = records[0]
  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
  
  // 如果日期不同，重置计数
  if (record.lastResetDate !== today) {
    await ctx.database.set('chatModelUsage', { userId }, {
      dailyCount: 0,
      lastResetDate: today
    })
    return true
  }
  
  // 返回是否未超过限制
  return record.dailyCount < (config.usageLimit?.maxMessagesPerUser || 100)
}

// 检查使用限制
async function checkUsageLimit(ctx, userId, config) {
  const records = await ctx.database.get('chatModelUsage', { userId })
  
  if (!records || records.length === 0) {
    return true // 首次使用，允许
  }
  
  const record = records[0]
  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
  
  // 如果日期不同，重置计数
  if (record.lastResetDate !== today) {
    await ctx.database.set('chatModelUsage', { userId }, {
      dailyCount: 0,
      lastResetDate: today
    })
    return true
  }
  
  // 返回是否未超过限制
  return record.dailyCount < (config.usageLimit?.maxMessagesPerUser || 100)
}

// 更新使用计数
async function updateUsageCount(ctx, userId) {
  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
  const records = await ctx.database.get('chatModelUsage', { userId })
  
  if (!records || records.length === 0) {
    // 创建新记录
    await ctx.database.create('chatModelUsage', {
      userId,
      dailyCount: 1,
      lastResetDate: today
    })
  } else {
    // 更新现有记录
    const record = records[0]
    
    // 如果是新的一天，重置计数
    if (record.lastResetDate !== today) {
      await ctx.database.set('chatModelUsage', { userId }, {
        dailyCount: 1,
        lastResetDate: today
      })
    } else {
      // 增加计数
      await ctx.database.set('chatModelUsage', { userId }, {
        dailyCount: record.dailyCount + 1
      })
    }
  }
}

// 判断是否应该忽略消息
function shouldIgnoreMessage(session, config) {
  // 忽略自己发送的消息
  if (session.userId === session.selfId) {
    return true
  }
  
  // 根据配置决定是否处理私聊/群聊消息
  const isPrivate = session.channelId === session.userId
  if (isPrivate && !config.triggerPrivate) {
    return true
  }
  
  if (!isPrivate && !config.triggerGroup) {
    return true
  }
  
  return false
} 