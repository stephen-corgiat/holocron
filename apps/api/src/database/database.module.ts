import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('POSTGRES_HOST') ?? 'localhost',
        port: Number(config.get<string>('POSTGRES_PORT') ?? 5432),
        username: config.get<string>('POSTGRES_USER') ?? 'holocron',
        password: config.get<string>('POSTGRES_PASSWORD') ?? 'holocron',
        database: config.get<string>('POSTGRES_DB') ?? 'holocron',
        autoLoadEntities: true,
        synchronize: false,
        logging: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
