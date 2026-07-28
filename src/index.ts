import { loadConfig } from "./config.ts";
import { runTradingCycle } from "./execution/tradingCycle.ts";
import {
  consumeExternalIntelligenceQueue,
  runExternalIntelligenceMinuteCycle,
  scheduledWorkKind,
} from "./intelligence/externalIntelligenceRuntime.ts";

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

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown error")
    .replace(/\s+/gu, " ")
    .slice(0, 300);
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
    const workKind = scheduledWorkKind(controller.cron);
    if (workKind === "external-intelligence-minute") {
      ctx.waitUntil(
        runExternalIntelligenceMinuteCycle(
          env,
          controller.scheduledTime,
        ).catch((error: unknown) => {
          console.error(
            JSON.stringify({
              event: "external-intelligence-minute-cycle-failed",
              message: safeError(error),
            }),
          );
          throw error;
        }),
      );
      return;
    }

    const config = loadConfig(env);
    ctx.waitUntil(
      runTradingCycle(env, config, {
        scheduledAtMs: controller.scheduledTime,
      }).catch((error: unknown) => {
        console.error(
          JSON.stringify({
            event: "trading-cycle-failed",
            message: safeError(error),
            mode: config.mode,
          }),
        );
        throw error;
      }),
    );
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const outcomes = await consumeExternalIntelligenceQueue(batch, env);
    console.log(
      JSON.stringify({
        event: "external-intelligence-queue-processed",
        queue: batch.queue,
        deliveries: outcomes.length,
        persisted: outcomes.filter((outcome) => outcome.status === "persisted")
          .length,
        retried: outcomes.filter((outcome) => outcome.status === "retry")
          .length,
      }),
    );
  },
} satisfies ExportedHandler<Env>;
