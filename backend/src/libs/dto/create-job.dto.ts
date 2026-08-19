import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
} from 'class-validator';

/**
 * Request schema for POST /api/jobs. Validated by the global ValidationPipe
 * before the controller runs, so the service only ever sees well-formed input.
 */
export class CreateJobDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Provide at least one URL' })
  @ArrayMaxSize(1000, { message: 'A job is capped at 1000 URLs' })
  @IsString({ each: true })
  @IsNotEmpty({ each: true, message: 'URLs must not be blank' })
  urls!: string[];
}
