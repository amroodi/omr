import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { SuperAdminOnly } from '../../common/rbac/decorators';
import { AiReviewQueue } from './ai-review.queue';
import { AiReviewSettings } from './ai-review.settings';

class AiSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @Length(0, 300) apiKey?: string;
  @IsOptional() @IsString() @Length(0, 80) model?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxConcurrency?: number;
  @IsOptional() @IsNumber() @Min(0.5) @Max(1) threshold?: number;
}
class OrgSwitchDto { @IsBoolean() enabled!: boolean }
class PromptDto { @IsString() @Length(0, 4000) prompt!: string }

/** «بررسی هوشمند مدارک» — super admin: switch, AvalAI key/model, per-org switches, pre-prompt per document type. */
@SuperAdminOnly()
@Controller('platform/ai-review')
export class AiReviewController {
  constructor(private readonly settings: AiReviewSettings, private readonly queue: AiReviewQueue) {}

  @Get()
  async get() {
    return { ...(await this.settings.settings()), queue: await this.queue.stats() };
  }

  @Put()
  save(@Body() dto: AiSettingsDto) {
    return this.settings.save(dto);
  }

  @Post('orgs/:id')
  setOrg(@Param('id') id: string, @Body() dto: OrgSwitchDto) {
    return this.settings.setOrg(id, dto.enabled);
  }

  @Get('credit')
  credit() {
    return this.settings.credit();
  }

  @Get('prompts')
  prompts() {
    return this.settings.prompts();
  }

  @Put('prompts/:code')
  setPrompt(@Param('code') code: string, @Body() dto: PromptDto) {
    return this.settings.setPrompt(code, dto.prompt);
  }
}
