import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { CreateJobDto } from '../../libs/dto/create-job.dto';
import { JobsService } from './jobs.service';
import { JobDetail, JobSummary } from '../../libs/types';

/**
 * The MVC controller for jobs: it maps HTTP routes to service calls and nothing
 * more. No business logic lives here.
 */
@Controller('api/jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateJobDto): JobSummary {
    return this.jobsService.create(dto.urls);
  }

  @Get()
  list(): JobSummary[] {
    return this.jobsService.list();
  }

  @Get(':id')
  detail(@Param('id') id: string): JobDetail {
    return this.jobsService.detail(id);
  }

  @Delete(':id')
  cancel(@Param('id') id: string): JobSummary {
    return this.jobsService.cancel(id);
  }
}
