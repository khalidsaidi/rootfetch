// Smoke test: start the built server over stdio and call every tool once.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "quick-test", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/cli.js"], env: { ...process.env } }));
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
const calls = [
  ["lookup_tld", { tld: ".bond" }], ["lookup_tld", { tld: "shop.example.top" }],
  ["rank_tlds", { by: "fastest_growing", limit: 3 }], ["recent_jumps", { days: 30, limit: 3 }],
  ["compare_tlds", { tlds: [".xyz", "app"] }], ["tld_history", { tld: "lol" }], ["lookup_tld", { tld: ".uk" }],
];
for (const [name, args] of calls) {
  const r = await client.callTool({ name, arguments: args });
  console.log(`\n## ${name} ${JSON.stringify(args)}${r.isError ? " (error)" : ""}\n` + r.content[0].text.split("\n").slice(0, 4).join("\n"));
}
await client.close();
