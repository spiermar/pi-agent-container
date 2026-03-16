import axios from "axios"

const DEFAULT_TIMEOUT = 60000

export interface SessionInfo {
  sessionId: string
  createdAt: string
}

export interface PromptResponse {
  events: any[]
  status: string
  result?: string
}

export class AgentHttpClient {
  private baseUrl: string
  private timeout: number

  constructor(baseUrl: string, timeout = DEFAULT_TIMEOUT) {
    this.baseUrl = baseUrl
    this.timeout = timeout
  }

  async createSession(): Promise<SessionInfo> {
    const response = await axios.post(`${this.baseUrl}/api/sessions`, {}, { timeout: this.timeout })
    return response.data
  }

  async sendPrompt(sessionId: string, prompt: string): Promise<PromptResponse> {
    const response = await axios.post(
      `${this.baseUrl}/api/sessions/${sessionId}/prompt`,
      { prompt },
      { timeout: this.timeout }
    )
    return response.data
  }

  async deleteSession(sessionId: string): Promise<void> {
    await axios.delete(`${this.baseUrl}/api/sessions/${sessionId}`)
  }

  async getSession(sessionId: string): Promise<SessionInfo | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/sessions/${sessionId}`)
      return response.data
    } catch (err: any) {
      if (err.response?.status === 404) return null
      throw err
    }
  }
}