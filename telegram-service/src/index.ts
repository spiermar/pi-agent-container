import { Bot } from "grammy"
import axios from "axios"

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN || "")
const agentUrl = process.env.AGENT_API_URL || "http://localhost:8888"

const userSessions = new Map<number, string>()

bot.on("message:text", async (ctx) => {
  const userId = ctx.from?.id
  if (typeof userId !== 'number') return

  let sessionId = userSessions.get(userId)

  if (!sessionId) {
    const response = await axios.post<{ sessionId: string }>(`${agentUrl}/api/sessions`)
    sessionId = response.data.sessionId
    if (!sessionId) return
    userSessions.set(userId, sessionId)
  }

  const response = await axios.post(
    `${agentUrl}/api/sessions/${sessionId}/prompt`,
    { prompt: ctx.message.text }
  )

  await ctx.reply(response.data.result || "Done")
})

bot.start()