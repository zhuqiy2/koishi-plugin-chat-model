const fetch = require('node-fetch')
const AbortController = require('abort-controller')

class GeminiAdapter {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.apiKey = config.apiKey
    this.apiEndpoint = config.apiEndpoint || 'https://generativelanguage.googleapis.com/v1beta'
    
    // Gemini模型映射
    const modelMap = {
      'gemini-pro': 'gemini-pro',
      'gemini-1.5-pro': 'gemini-1.5-pro',
      'gemini-1.5-flash': 'gemini-1.5-flash'
    }
    
    this.modelName = modelMap[config.modelName] || config.modelName || 'gemini-pro'
    this.temperature = config.temperature ?? 0.7
    
    // 验证必要参数
    if (!this.apiKey) {
      ctx.logger.error('Gemini API密钥未设置')
      throw new Error('Gemini API密钥未设置')
    }
    
    ctx.logger.info(`Gemini适配器已初始化，使用模型: ${this.modelName}`)
  }
  
  /**
   * 将Koishi消息格式转换为Gemini格式
   * @param {Array} koishiMessages - Koishi格式的消息数组
   * @returns {Array} - Gemini API格式的消息数组
   */
  formatMessages(koishiMessages) {
    // 获取system message (如果有)
    const systemMessage = koishiMessages.find(msg => msg.role === 'system')?.content || ''
    
    // 将系统消息作为用户的第一条消息(Gemini不直接支持system role)
    let geminiMessages = []
    
    if (systemMessage) {
      geminiMessages.push({
        role: 'user',
        parts: [{ text: `系统指令: ${systemMessage}` }]
      })
      
      // 如果只有系统消息，添加一个模型回复，否则会报错
      geminiMessages.push({
        role: 'model',
        parts: [{ text: '我明白了，我会按照指示行动。有什么可以帮助你的吗？' }]
      })
    }
    
    // 添加用户和助手的消息
    for (let i = 0; i < koishiMessages.length; i++) {
      const msg = koishiMessages[i]
      
      // 跳过system消息，因为已经处理过了
      if (msg.role === 'system') continue
      
      geminiMessages.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      })
    }
    
    // 确保消息数组是以用户消息开始，并交替出现
    if (geminiMessages.length === 0 || geminiMessages[0].role !== 'user') {
      this.ctx.logger.warn('消息格式不正确，已调整为Gemini的要求')
      // 添加一个空的用户消息
      geminiMessages.unshift({
        role: 'user',
        parts: [{ text: '你好' }]
      })
    }
    
    return geminiMessages
  }
  
  /**
   * 生成回复
   * @param {Array} messages - 对话历史消息
   * @param {Object} session - Koishi会话对象
   * @returns {Promise<string>} - 生成的回复文本
   */
  async generateResponse(messages, session) {
    this.ctx.logger.debug(`向Gemini发送请求，消息数: ${messages.length}`)
    
    try {
      // 格式化消息为Gemini格式
      const geminiMessages = this.formatMessages(messages)
      
      // 设置超时
      const timeout = 60000 // 60秒超时
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)
      
      // 构建API请求URL
      const apiUrl = `${this.apiEndpoint}/models/${this.modelName}:generateContent?key=${this.apiKey}`
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: geminiMessages,
          generationConfig: {
            temperature: this.temperature,
            maxOutputTokens: 2048,
            topP: 0.95,
            topK: 40
          }
        }),
        signal: controller.signal
      })
      
      // 清除超时定时器
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        this.ctx.logger.error(`Gemini API请求失败: ${response.status} ${response.statusText}`, error)
        throw new Error(`API请求失败: ${response.status} ${response.statusText}${error.error ? ': ' + error.error.message : ''}`)
      }
      
      const data = await response.json()
      
      // 检查响应格式
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
        this.ctx.logger.error('Gemini返回了无效的响应格式', data)
        throw new Error('收到无效的API响应')
      }
      
      // 如果响应中包含屏蔽标记，返回相应提示
      if (data.candidates[0].finishReason === 'SAFETY') {
        return '抱歉，您的请求触发了内容安全策略，我无法提供相关内容。'
      }
      
      // 记录使用情况
      if (data.usageMetadata) {
        this.ctx.logger.debug(`使用了 ${data.usageMetadata.promptTokenCount} 提示令牌和 ${data.usageMetadata.candidatesTokenCount} 回复令牌`)
      }
      
      return data.candidates[0].content.parts[0].text.trim()
    } catch (error) {
      this.ctx.logger.error('Gemini请求失败:', error)
      if (error.name === 'AbortError') {
        throw new Error('请求超时，请稍后再试')
      } else if (error.message.includes('429')) {
        throw new Error('请求过于频繁，请稍后再试')
      } else if (error.message.includes('400') && error.message.includes('Invalid API key')) {
        throw new Error('API密钥无效')
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
    // Gemini适配器不需要特别的清理工作
    this.ctx.logger.debug('Gemini适配器资源已清理')
  }
}

module.exports = GeminiAdapter 