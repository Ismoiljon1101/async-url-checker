import { Controller, Get } from '@nestjs/common';

/** Liveness endpoint for Docker/orchestrator health checks. */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok'; uptime: number } {
    return { status: 'ok', uptime: process.uptime() };
  }
}
