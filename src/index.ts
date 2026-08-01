import { loadConfig } from "./config.ts";
import { runTradingCycle } from "./execution/tradingCycle.ts";

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      const config = loadConfig(env);
      return json({
        ok: true,
        environment: config.appEnv,
        mode: config.mode,
        liveTradingEnabled: config.liveTradingEnabled,
      });
    }
    return json({ error: "Not found" }, 404);
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const config = loadConfig(env);
    ctx.waitUntil(
      runTradingCycle(env, config, {
        scheduledAtMs: controller.scheduledTime,
      }).catch((error: unknown) => {
        console.error(
          JSON.stringify({
            event: "trading-cycle-failed",
            message: error instanceof Error ? error.message : "Unknown error",
            mode: config.mode,
          }),
        );
        throw error;
      }),
    );
  },
} satisfies ExportedHandler<Env>;
