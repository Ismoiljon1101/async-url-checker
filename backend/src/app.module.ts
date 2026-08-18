import { Module } from '@nestjs/common';
import { JobsModule } from './modules/jobs/jobs.module';

/** Root module. Composes the feature modules of the app. */
@Module({
  imports: [JobsModule],
})
export class AppModule {}
