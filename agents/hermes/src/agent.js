const http = require("node:http");
const { spawn } = require("node:child_process");
const a2a = require("./a2a");

const agentName = process.env.AGENT_NAME || "hermes";
const port = Number(process.env.PORT || 8080);
const gatewayPort = process.env.HERMES_GATEWAY_PORT || "19001";
// When false, the openclaw runtime is not spawned — the agent still serves
// health + the full A2A surface. Useful for local/CI testing of A2A.
const runtimeEnabled = (process.env.AGENT_RUNTIME_ENABLED || "true").toLowerCase() !== "false";

let hermesAgentReady = false;
let hermesAgentExitCode = null;
let hermesAgent = null;

if (runtimeEnabled) {
  console.log(`${agentName} agent starting Hermes Gateway on port ${gatewayPort}`);
  hermesAgent = spawn(
    "openclaw",
    ["gateway", "run", "--allow-unconfigured", "--bind", "auto", "--port", gatewayPort, "--force"],
    { stdio: "inherit", env: process.env },
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
} else {
  hermesAgentReady = true;
  console.log(`${agentName} runtime disabled (AGENT_RUNTIME_ENABLED=false) — serving A2A/health only`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, `http://localhost:${port}`).pathname;

    // Liveness / readiness
    if (path === "/health" && req.method === "GET") {
      const healthy = hermesAgentReady && hermesAgentExitCode === null;
      return sendJson(res, healthy ? 200 : 503, {
        agent: agentName,
        status: healthy ? "ok" : "starting",
        runtimeEnabled,
      });
    }

    // A2A discovery — Agent Card
    if (path === "/.well-known/agent-card.json" && req.method === "GET") {
      return sendJson(res, 200, a2a.buildAgentCard());
    }

    // A2A peer introspection (debug)
    if (path === "/a2a/peers" && req.method === "GET") {
      return sendJson(res, 200, { agent: agentName, peers: a2a.getPeers() });
    }

    // A2A JSON-RPC endpoint (inbound messages from other agents)
    if (path === "/a2a" && req.method === "POST") {
      if (!a2a.checkAuth(req.headers)) {
        return sendJson(res, 401, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Unauthorized" } });
      }
      let rpc;
      try {
        rpc = JSON.parse(await readBody(req));
      } catch {
        return sendJson(res, 200, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      }
      return sendJson(res, 200, await a2a.handleRpc(rpc));
    }

    // Convenience: ask THIS agent to send a message to a peer agent.
    // POST /a2a/send  { "to": "analyst", "text": "hello", "contextId": "optional" }
    if (path === "/a2a/send" && req.method === "POST") {
      if (!a2a.checkAuth(req.headers)) {
        return sendJson(res, 401, { error: "Unauthorized" });
      }
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return sendJson(res, 400, { error: "Invalid JSON" });
      }
      if (!body.to || !body.text) {
        return sendJson(res, 400, { error: "Fields 'to' and 'text' are required" });
      }
      try {
        const response = await a2a.sendToPeer(body.to, body.text, { contextId: body.contextId });
        return sendJson(res, 200, { from: agentName, to: body.to, response });
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }

    // Default
    return sendJson(res, 200, {
      agent: agentName,
      runtime: "hermes",
      a2a: { card: "/.well-known/agent-card.json", endpoint: "/a2a", peers: "/a2a/peers", send: "/a2a/send" },
    });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`${agentName} listening on ${port} (A2A enabled, peers: ${Object.keys(a2a.getPeers()).join(", ") || "none"})`);
});

process.on("SIGTERM", () => {
  server.close();
  if (hermesAgent) hermesAgent.kill("SIGTERM");
});
