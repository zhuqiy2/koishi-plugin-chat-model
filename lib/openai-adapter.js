const fetch = require('node-fetch')
const AbortController = require('abort-controller')

class OpenAIAdapter {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.apiKey = config.apiKey
    this.apiEndpoint = config.apiEndpoint || 'https://api.openai.com/v1'
    this.modelName = config.modelName || 'gpt-3.5-turbo'
    this.temperature = config.temperature ?? 0.7
    
    // 验证必要参数
    if (!this.apiKey) {
      ctx.logger.error('OpenAI API密钥未设置')
      throw new Error('OpenAI API密钥未设置')
    }
    
    ctx.logger.info(`OpenAI适配器已初始化，使用模型: ${this.modelName}`)
  }
  
  /**
   * 生成回复
   * @param {Array} messages - 对话历史消息
   * @param {Object} session - Koishi会话对象
   * @returns {Promise<string>} - 生成的回复文本
   */
  async generateResponse(messages, session) {
    this.ctx.logger.debug(`向OpenAI发送请求，消息数: ${messages.length}`)
    
    try {
      // 设置超时
      const timeout = 60000 // 60秒超时
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)
      
      // 构建API请求
      const response = await fetch(`${this.apiEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: messages,
          temperature: this.temperature,
          user: session.userId, // 传递用户ID以便OpenAI分析滥用情况
        }),
        signal: controller.signal
      })
      
      // 清除超时定时器
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        this.ctx.logger.error(`OpenAI API请求失败: ${response.status} ${response.statusText}`, error)
        throw new Error(`API请求失败: ${response.status} ${response.statusText}${error.error?.message ? ': ' + error.error.message : ''}`)
      }
      
      const data = await response.json()
      
      // 检查响应格式
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        this.ctx.logger.error('OpenAI返回了无效的响应格式', data)
        throw new Error('收到无效的API响应')
      }
      
      // 记录令牌使用情况
      if (data.usage) {
        this.ctx.logger.debug(`使用了 ${data.usage.total_tokens} 个令牌 (提示: ${data.usage.prompt_tokens}, 完成: ${data.usage.completion_tokens})`)
      }
      
      return data.choices[0].message.content.trim()
    } catch (error) {
      this.ctx.logger.error('OpenAI请求失败:', error)
      if (error.name === 'AbortError') {
        throw new Error('请求超时，请稍后再试')
      } else if (error.message.includes('429')) {
        throw new Error('请求过于频繁，请稍后再试')
      } else if (error.message.includes('401')) {
        throw new Error('API密钥无效或已过期')
      } else if (error.message.includes('insufficient_quota')) {
        throw new Error('API配额已用尽')
      }
      throw error
    }
  }
  
  /**
   * 当插件卸载时清理资源
   */
  async dispose() {
    // OpenAI适配器不需要特别的清理工作
    this.ctx.logger.debug('OpenAI适配器资源已清理')
  }
}

module.exports = OpenAIAdapter 