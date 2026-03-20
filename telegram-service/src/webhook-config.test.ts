import assert from 'node:assert/strict'
import test from 'node:test'
import { registerWebhook } from './webhook-config.js'

test('registerWebhook initializes bot before setting webhook with secret', async () => {
  const calls: string[] = []
  let receivedPath = ''
  let receivedSecret: string | undefined

  const bot = {
    async init() {
      calls.push('init')
    },
    api: {
      async setWebhook(path: string, options?: { secret_token?: string }) {
        calls.push('setWebhook')
        receivedPath = path
        receivedSecret = options?.secret_token
      }
    }
  }

  await registerWebhook(bot, 'https://example.com/webhook', 'secret-value')

  assert.deepEqual(calls, ['init', 'setWebhook'])
  assert.equal(receivedPath, 'https://example.com/webhook')
  assert.equal(receivedSecret, 'secret-value')
})

test('registerWebhook initializes bot before setting webhook without secret', async () => {
  const calls: string[] = []
  let receivedSecret: string | undefined

  const bot = {
    async init() {
      calls.push('init')
    },
    api: {
      async setWebhook(_path: string, options?: { secret_token?: string }) {
        calls.push('setWebhook')
        receivedSecret = options?.secret_token
      }
    }
  }

  await registerWebhook(bot, 'https://example.com/webhook')

  assert.deepEqual(calls, ['init', 'setWebhook'])
  assert.equal(receivedSecret, undefined)
})
