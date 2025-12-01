// src/app/core/services/donaciones.service.ts
// src/app/core/services/donaciones.service.ts
import { Injectable } from '@angular/core';
import ApiService from './api.service';

@Injectable({ providedIn: 'root' })
export class DonacionesService {
  constructor(private api: ApiService) {}

  crearDonacion(monto: number, userId?: number) {
    const body: any = { monto };
    if (userId) body.user_id = userId;

    return this.api.post<{
      donacion_id: number;
      buy_order: string;
      url: string;
      token: string;
      redirect_url: string;
    }>('/api/donaciones/crear/', body);
  }
}
