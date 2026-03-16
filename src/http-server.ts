import express, { Request, Response } from "express"

const app = express()
app.use(express.json())

const sessions = new Map<string, { dispose: () => void; createdAt: Date }>()

app.post("/api/sessions", (req: Request, res: Response) => {
  const sessionId = Math.random().toString(36).slice(2, 11)
  sessions.set(sessionId, { dispose: () => {}, createdAt: new Date() })
  res.json({ sessionId, createdAt: new Date().toISOString() })
})

app.post("/api/sessions/:id/prompt", async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
  const { prompt } = req.body
  
  const session = sessions.get(id)
  if (!session) {
    return res.status(404).json({ error: "Session not found" })
  }
  
  res.json({ status: "completed", events: [] })
})

app.get("/api/sessions/:id", (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
  const session = sessions.get(id)
  if (!session) {
    return res.status(404).json({ error: "Session not found" })
  }
  res.json({ sessionId: id, createdAt: session.createdAt })
})

app.delete("/api/sessions/:id", (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
  const session = sessions.get(id)
  if (session) {
    session.dispose()
    sessions.delete(id)
  }
  res.json({ success: true })
})

export function startHttpServer(port: number): void {
  app.listen(port, () => {
    console.log(`HTTP API server listening on port ${port}`)
  })
}