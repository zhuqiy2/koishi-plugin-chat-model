const fetch = require('node-fetch')
const AbortController = require('abort-controller')

class ClaudeAdapter {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.apiKey = config.apiKey
    this.apiEndpoint = config.apiEndpoint || 'https://api.anthropic.com/v1'
    // Claude模型名称映射
    const modelMap = {
      'claude-3-opus': 'claude-3-opus-20240229',
      'claude-3-sonnet': 'claude-3-sonnet-20240229',
      'claude-3-haiku': 'claude-3-haiku-20240307',
      'claude-2': 'claude-2.0',
      'claude-instant': 'claude-instant-1.2'
    }
    
    this.modelName = modelMap[config.modelName] || config.modelName || 'claude-3-sonnet-20240229'
    this.temperature = config.temperature ?? 0.7
    
    // 验证必要参数
    if (!this.apiKey) {
      ctx.logger.error('Claude API密钥未设置')
      throw new Error('Claude API密钥未设置')
    }
    
    ctx.logger.info(`Claude适配器已初始化，使用模型: ${this.modelName}`)
  }
  
  /**
   * 将Koishi消息格式转换为Claude格式
   * @param {Array} koishiMessages - Koishi格式的消息数组
   * @returns {Array} - Claude API格式的消息数组
   */
  formatMessages(koishiMessages) {
    // 获取system message (如果有)
    const systemMessage = koishiMessages.find(msg => msg.role === 'system')?.content || ''
    
    // 过滤掉system message，只保留user和assistant消息
    const conversationMessages = koishiMessages.filter(msg => msg.role !== 'system')
    
    const claudeMessages = conversationMessages.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    }))
    
    return {
      systemMessage,
      messages: claudeMessages
    }
  }
  
  /**
   * 生成回复
   * @param {Array} messages - 对话历史消息
   * @param {Object} session - Koishi会话对象
   * @returns {Promise<string>} - 生成的回复文本
   */
  async generateResponse(messages, session) {
    this.ctx.logger.debug(`向Claude发送请求，消息数: ${messages.length}`)
    
    try {
      // 格式化消息为Claude格式
      const { systemMessage, messages: claudeMessages } = this.formatMessages(messages)
      
      // 设置超时
      const timeout = 60000 // 60秒超时
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)
      
      // 构建API请求
      const response = await fetch(`${this.apiEndpoint}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: claudeMessages,
          system: systemMessage,
          temperature: this.temperature,
          max_tokens: 4000,
          metadata: {
            user_id: session.userId
          }
        }),
        signal: controller.signal
      })
      
      // 清除超时定时器
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        this.ctx.logger.error(`Claude API请求失败: ${response.status} ${response.statusText}`, error)
        throw new Error(`API请求失败: ${response.status} ${response.statusText}${error.error ? ': ' + error.error : ''}`)
      }
      
      const data = await response.json()
      
      // 检查响应格式
      if (!data.content || !data.content[0] || !data.content[0].text) {
        this.ctx.logger.error('Claude返回了无效的响应格式', data)
        throw new Error('收到无效的API响应')
      }
      
      // 记录使用情况
      if (data.usage) {
        this.ctx.logger.debug(`使用了 ${data.usage.input_tokens} 输入令牌和 ${data.usage.output_tokens} 输出令牌`)
      }
      
      return data.content[0].text.trim()
    } catch (error) {
      this.ctx.logger.error('Claude请求失败:', error)
      if (error.name === 'AbortError') {
        throw new Error('请求超时，请稍后再试')
      } else if (error.message.includes('429')) {
        throw new Error('请求过于频繁，请稍后再试')
      } else if (error.message.includes('401')) {
        throw new Error('API密钥无效或已过期')
      } else if (error.message.includes('quota')) {
        throw new Error('API配额已用尽')
      }
      throw error
    }
  }
  
  /**
   * 当插件卸载时清理资源
   */
  async dispose() {
    // Claude适配器不需要特别的清理工作
    this.ctx.logger.debug('Claude适配器资源已清理')
  }
}

module.exports = ClaudeAdapter 