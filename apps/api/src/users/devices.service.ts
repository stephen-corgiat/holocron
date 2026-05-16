import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeviceEntity } from './device.entity';
import { UserEntity } from './user.entity';

export interface DeviceInput {
  displayName: string;
  ipAddress: string | null;
  macAddress: string | null;
}

/**
 * Per-Trackee Device CRUD. Routes mount under `/users/:userId/devices`. A
 * Restrictable Trackee with zero IP-bearing Devices is valid — the router
 * enforcement adapter simply skips them.
 */
@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(DeviceEntity)
    private readonly devices: Repository<DeviceEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  async list(userId: string): Promise<DeviceEntity[]> {
    await this.requireUser(userId);
    return this.devices.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
  }

  async create(userId: string, input: DeviceInput): Promise<DeviceEntity> {
    await this.requireUser(userId);
    const normalized = this.normalize(input);
    const row = this.devices.create({
      userId,
      displayName: normalized.displayName,
      ipAddress: normalized.ipAddress,
      macAddress: normalized.macAddress,
    });
    return this.devices.save(row);
  }

  async update(
    userId: string,
    deviceId: string,
    input: Partial<DeviceInput>,
  ): Promise<DeviceEntity> {
    const row = await this.devices.findOne({
      where: { id: deviceId, userId },
    });
    if (!row) {
      throw new NotFoundException(
        `device ${deviceId} not found on user ${userId}`,
      );
    }
    const merged = this.normalize({
      displayName: input.displayName ?? row.displayName,
      ipAddress:
        input.ipAddress === undefined ? row.ipAddress : input.ipAddress,
      macAddress:
        input.macAddress === undefined ? row.macAddress : input.macAddress,
    });
    row.displayName = merged.displayName;
    row.ipAddress = merged.ipAddress;
    row.macAddress = merged.macAddress;
    return this.devices.save(row);
  }

  async remove(userId: string, deviceId: string): Promise<void> {
    const result = await this.devices.delete({ id: deviceId, userId });
    if (!result.affected) {
      throw new NotFoundException(
        `device ${deviceId} not found on user ${userId}`,
      );
    }
  }

  private normalize(input: DeviceInput): DeviceInput {
    const displayName = input.displayName.trim();
    if (!displayName) {
      throw new BadRequestException('display_name is required');
    }
    const ip = input.ipAddress?.trim() || null;
    const mac = input.macAddress?.trim() || null;
    if (!ip && !mac) {
      throw new BadRequestException(
        'at least one of ip_address or mac_address is required',
      );
    }
    return { displayName, ipAddress: ip, macAddress: mac };
  }

  private async requireUser(userId: string): Promise<UserEntity> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`user ${userId} not found`);
    }
    return user;
  }
}
