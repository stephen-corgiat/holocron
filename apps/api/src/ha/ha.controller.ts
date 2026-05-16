import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { HaProxyService } from './ha-proxy.service';
import { HaSnapshot } from './ha-snapshot';
import { BooleanDto, ClimateNudgeDto, FanDto, ToggleDto } from './dto';

/**
 * Narrow, whitelist-constrained HA surface, guarded like the rest of the API
 * (usable by any tablet session, still JWT-gated). Reachable only when
 * the module is wired (HA configured) — otherwise these routes do not exist,
 * which is how the FE detects the disabled state (snapshot → 404 → null).
 */
@Controller('ha')
@UseGuards(JwtAuthGuard)
export class HaController {
  constructor(private readonly proxy: HaProxyService) {}

  @Get('snapshot')
  snapshot(): Promise<HaSnapshot> {
    return this.proxy.snapshot();
  }

  @Post('toggle')
  @HttpCode(204)
  async toggle(@Body() body: ToggleDto): Promise<void> {
    await this.proxy.toggle(body.entityId, body.on);
  }

  /** Thermostat ±: tablet sends a direction, server clamps + writes back. */
  @Post('climate/nudge')
  @HttpCode(204)
  async nudgeClimate(@Body() body: ClimateNudgeDto): Promise<void> {
    await this.proxy.nudgeClimate(body.entityId, body.dir);
  }

  /** House fan Off/Low/High via the config-driven state→service map. */
  @Post('fan')
  @HttpCode(204)
  async setFan(@Body() body: FanDto): Promise<void> {
    await this.proxy.setFan(body.entityId, body.state);
  }

  /** Momentary scene action — `button.press`, fire-and-forget (Clean Kitchen). */
  @Post('button/:id/press')
  @HttpCode(204)
  async pressButton(@Param('id') id: string): Promise<void> {
    await this.proxy.pressButton(id);
  }

  /** Stateful scene toggle — input_boolean on/off (Night Mode). */
  @Post('boolean/:id')
  @HttpCode(204)
  async setBoolean(
    @Param('id') id: string,
    @Body() body: BooleanDto,
  ): Promise<void> {
    await this.proxy.setBoolean(id, body.on);
  }
}
