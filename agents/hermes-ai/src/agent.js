const http = require("node:http");
const { spawn } = require("node:child_process");

const agentName = process.env.AGENT_NAME || "hermes-ai";
const port = Number(process.env.PORT || 8080);
const gatewayPort = process.env.HERMES_GATEWAY_PORT || "19001";

console.log(`${agentName} agent starting Hermes Gateway on port ${gatewayPort}`);

let hermesAgentReady = false;
let hermesAgentExitCode = null;

const hermesAgent = spawn(
  "openclaw",
  ["gateway", "run", "--allow-unconfigured", "--bind", "auto", "--port", gatewayPort, "--force"],
  {
    stdio: "inherit",
    env: process.env,
  },
);

hermesAgent.on("spawn", () => {
  hermesAgentReady = true;
  console.log(`${agentName} Hermes runtime started`);
});

hermesAgent.on("error", (error) => {
  hermesAgentReady = false;
  console.error(`${agentName} failed to start Hermes runtime`, error);
  process.exit(1);
});

hermesAgent.on("exit", (code, signal) => {
  hermesAgentReady = false;
  hermesAgentExitCode = code ?? 1;
  console.error(`${agentName} Hermes runtime exited`, { code, signal });
  process.exit(hermesAgentExitCode);
});

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    const healthy = hermesAgentReady && hermesAgentExitCode === null;
    res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ agent: agentName, status: healthy ? "ok" : "starting" }));
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ agent: agentName, runtime: "hermes" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`${agentName} health endpoint listening on ${port}`);
});

process.on("SIGTERM", () => {
  server.close();
  hermesAgent.kill("SIGTERM");
});
