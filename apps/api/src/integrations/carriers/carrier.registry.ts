import { Injectable, NotFoundException } from '@nestjs/common';
import { AlborzAdapter } from './alborz.adapter';
import { CarrierAdapter } from './carrier-adapter';

/** Resolves a carrier adapter by key. Add new carriers by registering them here. */
@Injectable()
export class CarrierRegistry {
  private readonly adapters = new Map<string, CarrierAdapter>();

  constructor(alborz: AlborzAdapter) {
    this.register(alborz);
  }

  register(adapter: CarrierAdapter): void {
    this.adapters.set(adapter.key, adapter);
  }

  get(key: string): CarrierAdapter {
    const a = this.adapters.get(key.toLowerCase());
    if (!a) throw new NotFoundException(`No carrier adapter registered for "${key}"`);
    return a;
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }
}
