import { spawn } from 'node:child_process';
import { createServer, Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
const WORKDIR = process.cwd();
const TEST_TIMEOUT = 30_000;
const DEFAULT_WAIT_TIMEOUT = 10_000;
const WEBSOCKET_STABILITY_TIMEOUT = 1_000;
const LOG_SNIPPET_LENGTH = 2_000;
const runtimeProcesses = new Set();
const blockingServers = new Set();
const websocketClients = new Set();
afterEach(async () => {
    for (const ws of websocketClients) {
        await closeWebSocket(ws);
    }
    websocketClients.clear();
    for (const server of blockingServers) {
        await closeServer(server);
    }
    blockingServers.clear();
    for (const runtime of runtimeProcesses) {
        await stopRuntime(runtime, 'SIGTERM');
    }
    runtimeProcesses.clear();
});
describe('dual runtime startup and shutdown', () => {
    it('starts HTTP and WebSocket listeners on every launch', async () => {
        const httpPort = await getFreePort();
        const websocketPort = await getFreePort();
        const runtime = spawnRuntime({ httpPort, websocketPort });
        await waitForPortOpen(httpPort, DEFAULT_WAIT_TIMEOUT, runtime);
        await waitForPortOpen(websocketPort, DEFAULT_WAIT_TIMEOUT, runtime);
        const httpStatus = await httpRequest('GET', httpPort, '/api/sessions/not-found');
        expect(httpStatus.status).toBe(404);
        const ws = await connectWebSocket(websocketPort);
        expect(ws.readyState).toBe(WebSocket.OPEN);
    }, TEST_TIMEOUT);
    it('ignores HTTP_MODE and WEBSOCKET_MODE flags', async () => {
        const envVariants = [
            { HTTP_MODE: 'true' },
            { WEBSOCKET_MODE: 'true' },
            { HTTP_MODE: 'true', WEBSOCKET_MODE: 'true' },
        ];
        for (const extraEnv of envVariants) {
            const httpPort = await getFreePort();
            const websocketPort = await getFreePort();
            const runtime = spawnRuntime({ httpPort, websocketPort, extraEnv });
            await waitForPortOpen(httpPort, DEFAULT_WAIT_TIMEOUT, runtime);
            await waitForPortOpen(websocketPort, DEFAULT_WAIT_TIMEOUT, runtime);
            const exitPromise = waitForExit(runtime);
            await stopRuntime(runtime, 'SIGTERM');
            await exitPromise;
        }
    }, TEST_TIMEOUT);
    it('exits non-zero when one listener cannot bind', async () => {
        const httpPort = await getFreePort();
        const websocketPort = await getFreePort();
        const blocker = await createBlockingServer(websocketPort);
        blockingServers.add(blocker);
        const runtime = spawnRuntime({ httpPort, websocketPort });
        const result = await waitForExit(runtime);
        expect(result.code).not.toBe(0);
        expect(result.signal).toBeNull();
    }, TEST_TIMEOUT);
    it('shuts down both listeners on SIGTERM', async () => {
        const httpPort = await getFreePort();
        const websocketPort = await getFreePort();
        const runtime = spawnRuntime({ httpPort, websocketPort });
        await waitForPortOpen(httpPort, DEFAULT_WAIT_TIMEOUT, runtime);
        await waitForPortOpen(websocketPort, DEFAULT_WAIT_TIMEOUT, runtime);
        const result = await stopRuntime(runtime, 'SIGTERM');
        expect(result.code).toBe(0);
        await waitForPortClosed(httpPort);
        await waitForPortClosed(websocketPort);
    }, TEST_TIMEOUT);
    it('cleans up WebSocket listener when HTTP bind fails', async () => {
        const httpPort = await getFreePort();
        const websocketPort = await getFreePort();
        const blocker = await createBlockingServer(httpPort);
        blockingServers.add(blocker);
        const runtime = spawnRuntime({ httpPort, websocketPort });
        const result = await waitForExit(runtime);
        expect(result.code).not.toBe(0);
        await waitForPortClosed(websocketPort, DEFAULT_WAIT_TIMEOUT, runtime);
    }, TEST_TIMEOUT);
    it('proves HTTP and WebSocket lifecycle independence in both directions', async () => {
        const httpPort = await getFreePort();
        const websocketPort = await getFreePort();
        const runtime = spawnRuntime({ httpPort, websocketPort });
        await waitForPortOpen(httpPort, DEFAULT_WAIT_TIMEOUT, runtime);
        await waitForPortOpen(websocketPort, DEFAULT_WAIT_TIMEOUT, runtime);
        const firstCreateResponse = await httpRequest('POST', httpPort, '/api/sessions', {});
        expect(firstCreateResponse.status).toBe(200);
        const firstSessionId = String(firstCreateResponse.body.sessionId);
        expect(firstSessionId.length).toBeGreaterThan(0);
        const firstGetBeforeWebSocket = await httpRequest('GET', httpPort, `/api/sessions/${firstSessionId}`);
        expect(firstGetBeforeWebSocket.status).toBe(200);
        const ws = await connectWebSocket(websocketPort);
        await assertWebSocketRemainsOpen(ws);
        const deleteFirstSessionResponse = await httpRequest('DELETE', httpPort, `/api/sessions/${firstSessionId}`);
        expect(deleteFirstSessionResponse.status).toBe(200);
        expect(deleteFirstSessionResponse.body.success).toBe(true);
        const deletedFirstSessionResponse = await httpRequest('GET', httpPort, `/api/sessions/${firstSessionId}`);
        expect(deletedFirstSessionResponse.status).toBe(404);
        await assertWebSocketRemainsOpen(ws);
        ws.close();
        await waitForWebSocketClose(ws);
        expect(ws.readyState).toBe(WebSocket.CLOSED);
        const secondCreateResponse = await httpRequest('POST', httpPort, '/api/sessions', {});
        expect(secondCreateResponse.status).toBe(200);
        const secondSessionId = String(secondCreateResponse.body.sessionId);
        expect(secondSessionId.length).toBeGreaterThan(0);
        const firstGetAfterSecondCreate = await httpRequest('GET', httpPort, `/api/sessions/${firstSessionId}`);
        expect(firstGetAfterSecondCreate.status).toBe(404);
        const secondGetAfterWebSocketClose = await httpRequest('GET', httpPort, `/api/sessions/${secondSessionId}`);
        expect(secondGetAfterWebSocketClose.status).toBe(200);
        const deleteSecondSessionResponse = await httpRequest('DELETE', httpPort, `/api/sessions/${secondSessionId}`);
        expect(deleteSecondSessionResponse.status).toBe(200);
        expect(deleteSecondSessionResponse.body.success).toBe(true);
        const deletedSecondSessionResponse = await httpRequest('GET', httpPort, `/api/sessions/${secondSessionId}`);
        expect(deletedSecondSessionResponse.status).toBe(404);
    }, TEST_TIMEOUT);
});
async function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Failed to resolve an ephemeral port')));
                return;
            }
            server.close((err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(address.port);
            });
        });
    });
}
function spawnRuntime({ httpPort, websocketPort, extraEnv = {}, }) {
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/agent.ts'], {
        cwd: WORKDIR,
        env: {
            ...process.env,
            LLM_BASE_URL: process.env.LLM_BASE_URL ?? 'http://127.0.0.1:1/v1',
            LLM_MODEL: process.env.LLM_MODEL ?? 'test-model',
            LLM_API: process.env.LLM_API ?? 'openai-completions',
            HTTP_PORT: String(httpPort),
            WEBSOCKET_PORT: String(websocketPort),
            ...extraEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });
    const runtime = {
        child,
        stdout: () => stdout,
        stderr: () => stderr,
    };
    runtimeProcesses.add(runtime);
    return runtime;
}
async function stopRuntime(runtime, signal) {
    if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) {
        return {
            code: runtime.child.exitCode,
            signal: runtime.child.signalCode,
        };
    }
    runtime.child.kill(signal);
    try {
        return await waitForExit(runtime);
    }
    catch {
        runtime.child.kill('SIGKILL');
        return await waitForExit(runtime);
    }
}
async function waitForExit(runtime, timeoutMs = DEFAULT_WAIT_TIMEOUT) {
    if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) {
        return {
            code: runtime.child.exitCode,
            signal: runtime.child.signalCode,
        };
    }
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Process did not exit within ${timeoutMs}ms\nSTDOUT:\n${runtime.stdout()}\nSTDERR:\n${runtime.stderr()}`));
        }, timeoutMs);
        runtime.child.once('exit', (code, signal) => {
            clearTimeout(timeout);
            resolve({
                code,
                signal,
            });
        });
    });
}
async function createBlockingServer(port) {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            resolve(server);
        });
    });
}
async function closeServer(server) {
    await new Promise((resolve) => {
        if (!server.listening) {
            resolve();
            return;
        }
        server.close(() => resolve());
    });
}
async function httpRequest(method, port, path, body) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const parsed = text.length > 0 ? JSON.parse(text) : null;
    return {
        status: response.status,
        body: parsed,
    };
}
async function connectWebSocket(port) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    websocketClients.add(ws);
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`WebSocket did not connect on port ${port}`));
        }, DEFAULT_WAIT_TIMEOUT);
        ws.once('open', () => {
            clearTimeout(timeout);
            resolve();
        });
        ws.once('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
    return ws;
}
async function waitForWebSocketClose(ws, timeoutMs = DEFAULT_WAIT_TIMEOUT) {
    if (ws.readyState === WebSocket.CLOSED) {
        return;
    }
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`WebSocket did not close within ${timeoutMs}ms`));
        }, timeoutMs);
        ws.once('close', () => {
            clearTimeout(timeout);
            resolve();
        });
        ws.once('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}
async function assertWebSocketRemainsOpen(ws, stabilityTimeoutMs = WEBSOCKET_STABILITY_TIMEOUT) {
    expect(ws.readyState).toBe(WebSocket.OPEN);
    await raceWebSocketFailureAgainstTimeout(ws, stabilityTimeoutMs);
    expect(ws.readyState).toBe(WebSocket.OPEN);
}
async function raceWebSocketFailureAgainstTimeout(ws, timeoutMs) {
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            resolve();
        }, timeoutMs);
        const onClose = () => {
            cleanup();
            reject(new Error('WebSocket closed unexpectedly while asserting independence'));
        };
        const onError = (err) => {
            cleanup();
            reject(err);
        };
        const cleanup = () => {
            clearTimeout(timeout);
            ws.off('close', onClose);
            ws.off('error', onError);
        };
        ws.once('close', onClose);
        ws.once('error', onError);
    });
}
async function closeWebSocket(ws) {
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        return;
    }
    ws.close();
    try {
        await waitForWebSocketClose(ws, 2_000);
    }
    catch {
        ws.terminate();
    }
}
async function waitForPortOpen(port, timeoutMs = DEFAULT_WAIT_TIMEOUT, runtime) {
    await waitForPortState(port, true, timeoutMs, runtime);
}
async function waitForPortClosed(port, timeoutMs = DEFAULT_WAIT_TIMEOUT, runtime) {
    await waitForPortState(port, false, timeoutMs, runtime);
}
async function waitForPortState(port, shouldBeOpen, timeoutMs, runtime) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const open = await canConnect(port);
        if (open === shouldBeOpen) {
            return;
        }
        await delay(100);
    }
    const expectation = shouldBeOpen ? 'open' : 'closed';
    const diagnostics = runtime !== undefined ? buildRuntimeDiagnostics(runtime) : '';
    throw new Error(`Timed out waiting for port ${port} to become ${expectation}${diagnostics}`);
}
function buildRuntimeDiagnostics(runtime) {
    const stdout = formatOutputSnippet(runtime.stdout());
    const stderr = formatOutputSnippet(runtime.stderr());
    const exitCode = runtime.child.exitCode;
    const signalCode = runtime.child.signalCode;
    return [
        '',
        `Process state: exitCode=${exitCode ?? 'null'} signal=${signalCode ?? 'null'}`,
        `STDOUT (tail ${LOG_SNIPPET_LENGTH} chars):\n${stdout}`,
        `STDERR (tail ${LOG_SNIPPET_LENGTH} chars):\n${stderr}`,
    ].join('\n');
}
function formatOutputSnippet(output) {
    if (output.length === 0) {
        return '[empty]';
    }
    if (output.length <= LOG_SNIPPET_LENGTH) {
        return output;
    }
    return `...${output.slice(-LOG_SNIPPET_LENGTH)}`;
}
async function canConnect(port) {
    return new Promise((resolve) => {
        const socket = new Socket();
        socket.setTimeout(300);
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.once('error', () => {
            socket.destroy();
            resolve(false);
        });
        socket.connect(port, '127.0.0.1');
    });
}
