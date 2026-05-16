import { Injectable } from '@nestjs/common';
import { Clock } from './clock';

@Injectable()
export class FakeClock implements Clock {
  private current = new Date();

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(date: Date): void {
    this.current = new Date(date.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
