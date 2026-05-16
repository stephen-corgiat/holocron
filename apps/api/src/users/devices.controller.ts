import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { DevicesService } from './devices.service';
import { DeviceDto } from './dto';
import { DeviceEntity } from './device.entity';

interface DeviceView {
  id: string;
  user_id: string;
  display_name: string;
  ip_address: string | null;
  mac_address: string | null;
  created_at: string;
}

function toView(row: DeviceEntity): DeviceView {
  return {
    id: row.id,
    user_id: row.userId,
    display_name: row.displayName,
    ip_address: row.ipAddress,
    mac_address: row.macAddress,
    created_at: row.createdAt.toISOString(),
  };
}

@Controller('users/:userId/devices')
@UseGuards(JwtAuthGuard, AdminGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  async list(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ devices: DeviceView[] }> {
    const rows = await this.devices.list(userId);
    return { devices: rows.map(toView) };
  }

  @Post()
  async create(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: DeviceDto,
  ): Promise<DeviceView> {
    const row = await this.devices.create(userId, {
      displayName: dto.display_name,
      ipAddress: dto.ip_address ?? null,
      macAddress: dto.mac_address ?? null,
    });
    return toView(row);
  }

  @Patch(':deviceId')
  async update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: DeviceDto,
  ): Promise<DeviceView> {
    const row = await this.devices.update(userId, deviceId, {
      displayName: dto.display_name,
      ipAddress: dto.ip_address ?? null,
      macAddress: dto.mac_address ?? null,
    });
    return toView(row);
  }

  @Delete(':deviceId')
  @HttpCode(204)
  async remove(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ): Promise<void> {
    await this.devices.remove(userId, deviceId);
  }
}
