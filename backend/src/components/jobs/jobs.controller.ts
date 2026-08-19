import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { CreateJobDto } from '../../libs/dto/create-job.dto';
import { JobDetail, JobSummary } from '../../libs/types';
import { JobsService } from './jobs.service';

/**
 * The MVC controller for jobs: it maps HTTP routes to service calls. GET routes
 * add ETag / If-None-Match handling so a poll that finds nothing new gets a 304
 * and the server never serializes the response.
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
  list(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): JobSummary[] | undefined {
    const etag = this.jobsService.listEtag();
    res.setHeader('ETag', etag);
    if (ifNoneMatch === etag) {
      res.status(304);
      return undefined;
    }
    return this.jobsService.list();
  }

  @Get(':id')
  detail(
    @Param('id') id: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): JobDetail | undefined {
    const etag = this.jobsService.detailEtag(id); // throws 404 if unknown
    res.setHeader('ETag', etag);
    if (ifNoneMatch === etag) {
      res.status(304);
      return undefined;
    }
    return this.jobsService.detail(id);
  }

  @Delete(':id')
  cancel(@Param('id') id: string): JobSummary {
    return this.jobsService.cancel(id);
  }
}
