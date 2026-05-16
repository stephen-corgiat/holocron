import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true, where: 'username IS NOT NULL' })
  @Column({ name: 'username', type: 'text', nullable: true })
  username!: string | null;

  @Column({ name: 'display_name', type: 'text' })
  displayName!: string;

  @Column({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash!: string | null;

  @Column({ name: 'is_admin', type: 'boolean', default: false })
  isAdmin!: boolean;

  @Column({ name: 'is_restrictable', type: 'boolean', default: false })
  isRestrictable!: boolean;

  @Column({ name: 'router_id', type: 'text', nullable: true })
  routerId!: string | null;

  @Column({ name: 'avatar', type: 'text', nullable: true })
  avatar!: string | null;

  @Column({ name: 'color', type: 'text', nullable: true })
  color!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'deactivated_at', type: 'timestamptz', nullable: true })
  deactivatedAt!: Date | null;
}
