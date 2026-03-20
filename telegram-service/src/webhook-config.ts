type WebhookOptions = {
  secret_token?: string
}

type WebhookBot = {
  init: () => Promise<void>
  api: {
    setWebhook: (path: string, options?: WebhookOptions) => Promise<unknown>
  }
}

export async function registerWebhook(bot: WebhookBot, webhookPath: string, webhookSecret?: string) {
  await bot.init()

  if (webhookSecret) {
    await bot.api.setWebhook(webhookPath, {
      secret_token: webhookSecret
    })
    return
  }

  await bot.api.setWebhook(webhookPath)
}
