import OpenAI from "openai";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type ChatMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
};

const DEFAULT_MCP_URL =
  "https://mcp.aci.dev/gateway/mcp?bundle_key=7JgO2Y0MthSHMRwXWaFjzee4jC7TpHMJvmdV";

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MCP_URL = process.env.MCP_SERVER_URL ?? DEFAULT_MCP_URL;

if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const mcpClient = new McpClient({
  name: "gpt5-mcp-bridge",
  version: "1.0.0",
});

const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));

let mcpReady: Promise<void> | null = null;

const ensureMcpConnected = () => {
  if (!mcpReady) {
    mcpReady = mcpClient.connect(transport);
  }
  return mcpReady;
};

const buildOpenAITools = async () => {
  const { tools } = await mcpClient.listTools();

  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description ?? tool.metadata?.description ?? "",
      parameters:
        tool.inputSchema ??
        ({
          type: "object",
          properties: {},
        } as const),
    },
  }));
};

export const askGPT5WithMCP = async (prompt: string) => {
  await ensureMcpConnected();

  const tools = await buildOpenAITools();
  const messages: ChatMessage[] = [{ role: "user", content: prompt }];

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages,
    tools,
  });

  const message = completion.choices[0]?.message;
  if (!message) {
    throw new Error("OpenAI did not return a message");
  }

  const toolCall = message.tool_calls?.[0];

  if (!toolCall) {
    return message.content;
  }

  const args = toolCall.function.arguments
    ? JSON.parse(toolCall.function.arguments)
    : {};

  const toolResult = await mcpClient.callTool({
    name: toolCall.function.name,
    arguments: args,
  });

  const followUpMessages: ChatMessage[] = [
    ...messages,
    {
      role: "assistant",
      content: message.content ?? "",
    },
    {
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(toolResult),
    },
  ];

  const finalCompletion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: followUpMessages,
  });

  const finalMessage = finalCompletion.choices[0]?.message;
  return finalMessage?.content ?? null;
};

const main = async () => {
  const question =
    process.argv.slice(2).join(" ") ||
    "Find and describe the most relevant capability in the AI_HACK_RESTR MCP server.";

  const answer = await askGPT5WithMCP(question);
  console.log(`✅ GPT-5 reply:\n${answer ?? "[no content]"}`);
};

if (import.meta.main) {
  main()
    .catch((error) => {
      console.error("❌ Failed to run GPT-5 MCP demo", error);
      process.exit(1);
    })
    .finally(async () => {
      await mcpClient.close();
    });
}
