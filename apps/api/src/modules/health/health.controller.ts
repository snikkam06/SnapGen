import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private healthService: HealthService) {}

  @Get('health')
  @ApiOperation({ summary: 'Service health and dependency status' })
  async getHealth(@Res({ passthrough: true }) res: Response) {
    const report = await this.healthService.getReport();
    if (report.status !== 'ok') {
      res.status(503);
    }
    return report;
  }
}
