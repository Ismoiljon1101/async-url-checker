import { Module } from '@nestjs/common';
import { HealthModule } from './components/health/health.module';
import { JobsModule } from './components/jobs/jobs.module';

/** Root module. Composes the feature modules of the app. */
@Module({
  imports: [JobsModule, HealthModule],
})
export class AppModule {}
