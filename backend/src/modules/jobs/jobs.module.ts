import { Module } from '@nestjs/common';
import { JobsController } from './controllers/jobs.controller';
import { JobsRepository } from './repositories/jobs.repository';
import { JobsService } from './services/jobs.service';
import { UrlCheckerService } from './services/url-checker.service';

/**
 * Feature module. Wires the controller to its providers via Nest's DI:
 * JobsController → JobsService → { JobsRepository, UrlCheckerService }.
 */
@Module({
  controllers: [JobsController],
  providers: [JobsService, UrlCheckerService, JobsRepository],
  exports: [JobsService],
})
export class JobsModule {}
