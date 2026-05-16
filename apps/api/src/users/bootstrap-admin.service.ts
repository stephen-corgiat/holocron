import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';

@Injectable()
export class BootstrapAdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger('BootstrapAdmin');

  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const username = this.config.get<string>('BOOTSTRAP_ADMIN_USERNAME');
    const password = this.config.get<string>('BOOTSTRAP_ADMIN_PASSWORD');
    const displayName =
      this.config.get<string>('BOOTSTRAP_ADMIN_DISPLAY_NAME') ?? 'Admin';

    if (!username || !password) return;

    const adminCount = await this.users.countAdmins();
    if (adminCount > 0) return;

    await this.users.createUser({
      username,
      displayName,
      password,
      isAdmin: true,
      isRestrictable: false,
    });
    this.logger.log(
      `Bootstrapped initial admin user "${username}" (BOOTSTRAP_ADMIN_USERNAME).`,
    );
  }
}
