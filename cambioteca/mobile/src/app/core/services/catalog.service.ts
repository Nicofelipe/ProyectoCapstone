// src/app/core/services/catalog.service.ts

import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import ApiService from './api.service';

export interface Region { id_region: number; nombre: string }
export interface Comuna { id_comuna: number; nombre: string; id_region?: number }

@Injectable({ providedIn: 'root' })
export class CatalogService {
  constructor(private api: ApiService) {}

  async regiones(): Promise<Region[]> {
    return await firstValueFrom(this.api.get<Region[]>('/api/catalog/regiones/'));
  }

  async comunas(idRegion?: number): Promise<Comuna[]> {
    const url = idRegion
      ? `/api/catalog/comunas/?region=${idRegion}`
      : '/api/catalog/comunas/';
    return await firstValueFrom(this.api.get<Comuna[]>(url));
  }
}
