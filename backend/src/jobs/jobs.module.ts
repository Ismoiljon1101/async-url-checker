import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsRepository } from './jobs.repository';
import { JobsService } from './jobs.service';
import { UrlCheckerService } from './url-checker.service';

/**
 * The jobs feature module. Nest's DI wires the controller to its providers:
 * JobsController → JobsService → { JobsRepository, UrlCheckerService }.
 */
@Module({
  controllers: [JobsController],
  providers: [JobsService, UrlCheckerService, JobsRepository],
  exports: [JobsService],
})
export class JobsModule {}
