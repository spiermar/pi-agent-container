import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple, Type, Static } from "@mariozechner/pi-ai";
import * as fs from "fs";
import * as readline from "readline";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";

const readFileParams = Type.Object({
  path: Type.String({ description: "Path to the file" }),
});

type ReadFileParams = Static<typeof readFileParams>;

const readFileTool: AgentTool<typeof readFileParams> = {
  name: "read_file",
  label: "Read File",
  description: "Read the contents of a file",
  parameters: readFileParams,
  execute: async (_id, params: ReadFileParams) => {
    try {
      const content = fs.readFileSync(params.path, "utf-8");
      return { content: [{ type: "text", text: content }], details: {} };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], details: {} };
    }
  },
};

const listFilesParams = Type.Object({
  path: Type.String({ description: "Directory path", default: "." }),
});

type ListFilesParams = Static<typeof listFilesParams>;

const listFilesTool: AgentTool<typeof listFilesParams> = {
  name: "list_files",
  label: "List Files",
  description: "List files in a directory",
  parameters: listFilesParams,
  execute: async (_id, params: ListFilesParams) => {
    try {
      const files = fs.readdirSync(params.path);
      return { content: [{ type: "text", text: files.join("\n") }], details: { count: files.length } };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], details: {} };
    }
  },
};

function validateEnv(): void {
  const required = ["LLM_BASE_URL", "LLM_MODEL"];
  const missing = required.filter((key) => !process.env[key]);
  
  if (missing.length > 0) {
    console.error(`Error: Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
}

function createModel(): Model<"openai-completions"> {
  const baseUrl = process.env.LLM_BASE_URL!;
  const modelId = process.env.LLM_MODEL!;

  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "custom",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  };
}

async function createAgent(): Promise<Agent> {
  const model = createModel();
  
  const agent = new Agent({
    initialState: {
      systemPrompt: "You are a helpful assistant with access to file tools. Be concise.",
      model,
      tools: [readFileTool, listFilesTool],
      thinkingLevel: "off",
    },
    streamFn: streamSimple,
  });

  agent.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
    if (event.type === "tool_execution_start") {
      console.log(`\n[${event.toolName}] ${JSON.stringify(event.args)}`);
    }
    if (event.type === "tool_execution_end") {
      console.log(`Result: ${event.isError ? "ERROR" : "OK"}`);
    }
    if (event.type === "agent_end") {
      console.log("\nAgent finished");
    }
  });

  return agent;
}

async function runPrompt(prompt: string): Promise<void> {
  const agent = await createAgent();
  await agent.prompt(prompt);
  console.log();
}

async function runRepl(): Promise<void> {
  const agent = await createAgent();
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("PI Agent REPL (type 'exit' to quit)\n");

  const ask = () => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();
      if (trimmed === "exit") {
        rl.close();
        return;
      }
      if (!trimmed) {
        ask();
        return;
      }
      try {
        await agent.prompt(trimmed);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
      }
      console.log();
      ask();
    });
  };

  ask();
}

async function main() {
  validateEnv();

  const prompt = process.env.AGENT_PROMPT;
  
  if (prompt) {
    await runPrompt(prompt);
  } else {
    await runRepl();
  }
}

main();